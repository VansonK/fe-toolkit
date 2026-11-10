import { handleError } from '../../core/errors';

export const WORKING_BRANCH = 'chore/jenkins-renovate';
const FILE_NAME = 'Jenkinsfile.renovate';

// Helper to generate the headers based on the provider
export function getAuthHeaders(provider: string, token: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (provider === 'github') {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Accept'] = 'application/vnd.github.v3+json';
    } else if (provider === 'gitea') {
        headers['Authorization'] = `token ${token}`;
    } else if (provider === 'gitlab') {
        headers['PRIVATE-TOKEN'] = token;
    }
    return headers;
}

// ==========================================
// PHASE 1: Target Branch Resolution
// ==========================================
export async function resolveDevBranch(provider: string, host: string, repoTarget: string, headers: Record<string, string>) {
    let url = '';
    const encodedRepo = encodeURIComponent(repoTarget);

    if (provider === 'github') url = `https://api.github.com/repos/${repoTarget}/branches`;
    else if (provider === 'gitea') url = `https://${host}/api/v1/repos/${repoTarget}/branches`;
    else if (provider === 'gitlab') url = `https://${host}/api/v4/projects/${encodedRepo}/repository/branches`;

    const response = await fetch(url, { headers });
    if (!response.ok) handleError(`Failed to fetch branches. Status: ${response.status}`);

    const branches: any[] = await response.json();
    const devRegex = /^dev/i;

    const devBranches = branches.filter(b => devRegex.test(b.name));
    if (devBranches.length === 0) {
        handleError("No development branch (dev, develop, development) found. This command requires a dev branch to target.");
    }

    // Priority: dev -> develop -> development -> anything else starting with 'dev'
    const selectedBranch = devBranches.find(b => b.name.toLowerCase() === 'dev') 
                        || devBranches.find(b => b.name.toLowerCase() === 'develop') 
                        || devBranches.find(b => b.name.toLowerCase() === 'development') 
                        || devBranches[0];

    // GitHub uses commit.sha, Gitea/GitLab use commit.id
    const sha = selectedBranch.commit.sha || selectedBranch.commit.id; 
    
    return { name: selectedBranch.name, sha };
}

// ==========================================
// PHASE 2: Idempotency & Conflict Checks
// ==========================================
export async function checkIdempotency(provider: string, host: string, repoTarget: string, devBranch: string, headers: Record<string, string>) {
    const encodedRepo = encodeURIComponent(repoTarget);
    const encodedFile = encodeURIComponent(FILE_NAME);
    
    let branchCheckUrl = '';
    let fileCheckUrl = '';

    if (provider === 'github') {
        branchCheckUrl = `https://api.github.com/repos/${repoTarget}/branches/${WORKING_BRANCH}`;
        fileCheckUrl = `https://api.github.com/repos/${repoTarget}/contents/${FILE_NAME}?ref=${devBranch}`;
    } else if (provider === 'gitea') {
        branchCheckUrl = `https://${host}/api/v1/repos/${repoTarget}/branches/${WORKING_BRANCH}`;
        fileCheckUrl = `https://${host}/api/v1/repos/${repoTarget}/contents/${FILE_NAME}?ref=${devBranch}`;
    } else if (provider === 'gitlab') {
        const encodedWorkingBranch = encodeURIComponent(WORKING_BRANCH);
        branchCheckUrl = `https://${host}/api/v4/projects/${encodedRepo}/repository/branches/${encodedWorkingBranch}`;
        fileCheckUrl = `https://${host}/api/v4/projects/${encodedRepo}/repository/files/${encodedFile}?ref=${devBranch}`;
    }

    // 1. Check if PR branch already exists
    const branchRes = await fetch(branchCheckUrl, { headers });
    if (branchRes.ok) {
        handleError(`Branch '${WORKING_BRANCH}' already exists. Please delete or merge it before running this command again.`);
    }

    // 2. Check if Jenkinsfile already exists on the dev branch
    const fileRes = await fetch(fileCheckUrl, { headers });
    if (fileRes.ok) {
        handleError(`'${FILE_NAME}' already exists on the '${devBranch}' branch. Automation setup is already complete.`);
    }
}

// ==========================================
// PHASE 3: Branch Creation
// ==========================================
export async function createBranch(provider: string, host: string, repoTarget: string, devBranch: string, devSha: string, headers: Record<string, string>) {
    const encodedRepo = encodeURIComponent(repoTarget);
    let url = '';
    let body: any = {};

    if (provider === 'github') {
        url = `https://api.github.com/repos/${repoTarget}/git/refs`;
        body = { ref: `refs/heads/${WORKING_BRANCH}`, sha: devSha };
    } else if (provider === 'gitea') {
        url = `https://${host}/api/v1/repos/${repoTarget}/branches`;
        body = { new_branch_name: WORKING_BRANCH, old_ref_name: devBranch };
    } else if (provider === 'gitlab') {
        url = `https://${host}/api/v4/projects/${encodedRepo}/repository/branches`;
        body = { branch: WORKING_BRANCH, ref: devBranch };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const err = await response.text();
        handleError(`Failed to create branch '${WORKING_BRANCH}'. Status: ${response.status}\nDetails: ${err}`);
    }
}

// ==========================================
// PHASE 4: Payload Generation & File Push
// ==========================================
export function generateJenkinsfile(provider: string, repoTarget: string, host: string, devBranchName: string): string {
    const giteaEndpoint = provider === 'gitea' ? `\n        RENOVATE_ENDPOINT = 'https://${host}/api/v1'` : '';
    return `pipeline {
    agent any
    triggers { cron('*/5 * * * *') }
    environment {
        RENOVATE_TOKEN = credentials('renovate-token-id')
        RENOVATE_PLATFORM = '${provider}'${giteaEndpoint}
        RENOVATE_BASE_BRANCHES = '${devBranchName}'
        LOG_LEVEL = 'debug'
    }
    stages {
        stage('Run Renovate') {
            steps { sh 'npx --yes renovate ${repoTarget}' }
        }
    }
}`;
}

export async function pushFileViaAPI(provider: string, host: string, repoTarget: string, content: string, headers: Record<string, string>) {
    const encodedRepo = encodeURIComponent(repoTarget);
    const encodedFile = encodeURIComponent(FILE_NAME);
    const base64Content = Buffer.from(content).toString('base64');
    
    let url = '';
    let method = provider === 'github' ? 'PUT' : 'POST';
    let body: any = { content: base64Content, message: 'chore: add Jenkinsfile for Renovate automation' };

    if (provider === 'github') {
        url = `https://api.github.com/repos/${repoTarget}/contents/${FILE_NAME}`;
        body.branch = WORKING_BRANCH;
    } else if (provider === 'gitea') {
        url = `https://${host}/api/v1/repos/${repoTarget}/contents/${FILE_NAME}`;
        body.branch = WORKING_BRANCH;
    } else if (provider === 'gitlab') {
        url = `https://${host}/api/v4/projects/${encodedRepo}/repository/files/${encodedFile}`;
        body.branch = WORKING_BRANCH;
        body.encoding = 'base64';
        body.commit_message = body.message;
    }

    const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const err = await response.text();
        handleError(`Failed to push file via API. Status: ${response.status}\nDetails: ${err}`);
    }
}

// ==========================================
// PHASE 5: Pull Request Automation
// ==========================================
export async function createPullRequest(provider: string, host: string, repoTarget: string, devBranch: string, headers: Record<string, string>): Promise<string> {
    const encodedRepo = encodeURIComponent(repoTarget);
    let url = '';
    let body: any = {
        title: 'chore: setup Renovate automation pipeline',
        description: 'Automated PR by fe-toolkit to configure Jenkins and Renovate.'
    };

    if (provider === 'github') {
        url = `https://api.github.com/repos/${repoTarget}/pulls`;
        body.head = WORKING_BRANCH;
        body.base = devBranch;
        body.body = body.description;
    } else if (provider === 'gitea') {
        url = `https://${host}/api/v1/repos/${repoTarget}/pulls`;
        body.head = WORKING_BRANCH;
        body.base = devBranch;
        body.body = body.description;
    } else if (provider === 'gitlab') {
        url = `https://${host}/api/v4/projects/${encodedRepo}/merge_requests`;
        body.source_branch = WORKING_BRANCH;
        body.target_branch = devBranch;
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        const err = await response.text();
        handleError(`Failed to create Pull Request. Status: ${response.status}\nDetails: ${err}`);
    }

    const data = await response.json();
    // GitHub/Gitea use html_url, GitLab uses web_url
    return data.html_url || data.web_url; 
}
