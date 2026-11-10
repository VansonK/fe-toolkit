import * as fs from 'fs';
import * as path from 'path';
import { handleError } from '../errors';

export interface RenovateConfigOptions {
    autoPr: boolean;
    autoMerge: boolean;
    schedule?: string | null;
}

export function generateRenovateConfig(options: RenovateConfigOptions): boolean {
    const configPath = path.join(process.cwd(), 'renovate.json');
    
    const config: any = {
        "$schema": "https://docs.renovatebot.com/renovate-schema.json",
        "extends": [
            "config:base"
        ],
        "timezone": "Asia/Jakarta",
        "prCreation": options.autoPr ? "immediate" : "not-pending",
        "automerge": options.autoMerge,
        "dependencyDashboard": true
    };

    if (options.schedule) {
        config.schedule = [options.schedule];
    }

    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch {
        return false;
    }
}

export function validateRenovateConfig(): boolean {
    const configPath = path.join(process.cwd(), 'renovate.json');
    if (!fs.existsSync(configPath)) return false;
    
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Validasi struktur minimal
        return !!parsed.extends;
    } catch {
        return false;
    }
}

/**
 * Generates the Jenkinsfile string payload with hardcoded values
 */
// export function generateJenkinsfile(provider: string, repoTarget: string, host: string): string {
//     // If it is Gitea, we must explicitly provide the API endpoint
//     const giteaEndpoint = provider.toLowerCase() === 'gitea' 
//         ? `\n        RENOVATE_ENDPOINT = 'https://${host}/api/v1'` 
//         : '';

//     return `pipeline {
//     agent any
    
//     triggers {
//         cron('H * * * *') 
//     }
    
//     environment {
//         RENOVATE_TOKEN = credentials('renovate-token-id')
//         RENOVATE_PLATFORM = '${provider}'${giteaEndpoint}
//     }
    
//     stages {
//         stage('Run Renovate') {
//             steps {
//                 sh 'npx --yes renovate ${repoTarget}'
//             }
//         }
//     }
// }`;
// }

/**
 * Pushes a file via the provider's REST API
 */
// export async function pushFileViaAPI(
//     provider: string,
//     host: string,
//     repoTarget: string,
//     token: string,
//     filePath: string,
//     content: string,
//     commitMessage: string
// ): Promise<void> {
//     const base64Content = Buffer.from(content).toString('base64');
    
//     let url = '';
//     let method = 'POST';
//     let headers: Record<string, string> = {
//         'Content-Type': 'application/json',
//         'Accept': 'application/json'
//     };
//     let body: any = {};

//     switch (provider.toLowerCase()) {
//         case 'github':
//             // GitHub uses PUT for file creation
//             url = `https://api.github.com/repos/${repoTarget}/contents/${filePath}`;
//             method = 'PUT';
//             headers['Authorization'] = `Bearer ${token}`;
//             headers['Accept'] = 'application/vnd.github.v3+json';
//             body = {
//                 message: commitMessage,
//                 content: base64Content
//             };
//             break;

//         case 'gitea':
//             url = `https://${host}/api/v1/repos/${repoTarget}/contents/${filePath}`;
//             method = 'POST';
//             headers['Authorization'] = `token ${token}`;
//             body = {
//                 message: commitMessage,
//                 content: base64Content
//             };
//             break;

//         case 'gitlab':
//             // GitLab requires URL encoding for the repo target (namespace/project) and file path
//             const encodedRepo = encodeURIComponent(repoTarget);
//             const encodedPath = encodeURIComponent(filePath);
//             url = `https://${host}/api/v4/projects/${encodedRepo}/repository/files/${encodedPath}`;
//             method = 'POST';
//             headers['PRIVATE-TOKEN'] = token;
//             body = {
//                 branch: 'main', // Ensure this matches the repository's default branch
//                 commit_message: commitMessage,
//                 encoding: 'base64',
//                 content: base64Content
//             };
//             break;

//         default:
//             handleError(`Unsupported provider for API push: ${provider}`);
//     }

//     const response = await fetch(url, {
//         method,
//         headers,
//         body: JSON.stringify(body)
//     });

//     if (!response.ok) {
//         const errorData = await response.text();
//         handleError(`Failed to push file via ${provider} API. Status: ${response.status}\nDetails: ${errorData}`);
//     }
// }
