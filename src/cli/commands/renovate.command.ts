import * as fs from 'fs';
import * as path from 'path';
import prompts from 'prompts';
import { execSync } from 'child_process';
import { logger } from '../../core/logger';
import { handleError } from '../../core/errors';
import { updateConfig, loadConfig } from '../../core/config';
import { stripJsonComments } from '../../core/doctor'; 
import { getSecureToken, saveSecureToken, validateToken } from '../../core/credentials';
import { generateRenovateConfig, validateRenovateConfig } from '../../core/renovate';
import { WORKING_BRANCH, checkIdempotency, createBranch, createPullRequest, generateJenkinsfile, getAuthHeaders, pushFileViaAPI, resolveDevBranch, } from '../../core/automate'

export async function runRenovateCommand(args: string[]): Promise<void> {
    const subCommand = args[0];

    if (subCommand === 'init') {
        await handleInit(args);
    } else if (subCommand === 'check') {
        handleCheck();
    } else if (subCommand === 'automate') {
        handleJenkins();
    } else if (subCommand === 'info') {
        handleInfo();
    } else {
        handleError("Unknown renovate command. Try 'fe-toolkit renovate init' or 'fe-toolkit renovate check'");
    }
}

async function handleInit(args: string[]) {
    // 1. Ekstrak Provider dari flag jika ada
    let providerArg: string | undefined;
    const providerFlagIndex = args.indexOf('--provider');
    if (providerFlagIndex > -1) {
        const nextArg = args[providerFlagIndex + 1];
        if (nextArg) {
            providerArg = nextArg.toLowerCase();
        }
    }

    console.log(''); 

    // 2. Tanya Provider jika belum lewat flag
    let provider = providerArg;
    if (provider !== 'github' && provider !== 'gitea') {
        const provResponse = await prompts({
            type: 'select',
            name: 'provider',
            message: 'Select Git provider:',
            choices: [
                { title: 'GitHub', value: 'github' },
                { title: 'Gitea', value: 'gitea' },
                { title: 'GitLab', value: 'gitlab' }
            ]
        });
        provider = provResponse.provider;
        if (!provider) process.exit(1); // User CTRL+C
    }

    // 3. Tanya URL Repository
    const urlResponse = await prompts({
        type: 'text',
        name: 'repoUrl',
        message: 'Repository URL:'
    });
    const repoUrl = urlResponse.repoUrl;
    if (!repoUrl) process.exit(1);

    // Parse URL untuk mendapatkan host (dibutuhkan untuk validasi Gitea)
    const urlMatch = repoUrl.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/]+)/);
    const host = urlMatch ? urlMatch[1] : (provider === 'github' ? 'github.com' : '');

    // 4. Kredensial dan Validasi
    let token = getSecureToken(provider);
    let shouldConfigureToken = false;

    if (token) {
        console.log(`\n✓ ${provider} automation credential found.`);
        const changeCred = await prompts({
            type: 'confirm',
            name: 'change',
            message: 'Do you want to change the configured credential?',
            initial: false
        });
        if (changeCred.change === undefined) process.exit(1);
        shouldConfigureToken = changeCred.change;
    } else {
        console.log(`\n! ${provider} automation credential is not configured.\n`);
        const configCred = await prompts({
            type: 'confirm',
            name: 'configure',
            message: 'Configure credential now?',
            initial: true
        });
        if (configCred.configure === undefined) process.exit(1);
        shouldConfigureToken = configCred.configure;
    }

    if (shouldConfigureToken) {
        const tokenResponse = await prompts({
            type: 'password',
            name: 'token',
            message: `Enter ${provider} access token:`
        });
        token = tokenResponse.token;

        if (token) {
            // Validasi API
            const isValid = await validateToken(provider, token, host);
            if (isValid) {
                console.log('\n✓ Credential validated');
                const saved = saveSecureToken(provider, token);
                if (saved) {
                    logger.success('Credential stored securely');
                } else {
                    logger.error('Failed to store credential securely.');
                }
            } else {
                handleError('Credential validation failed. Please check your token and permissions.');
            }
        } else {
            console.log('Token configuration skipped.');
        }
    }

    console.log('');

    console.log(''); 

    // 5. Cek File Existing
    const configPath = path.join(process.cwd(), 'renovate.json');
    if (fs.existsSync(configPath)) {
        const overwrite = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: 'renovate.json already exists. Overwrite?',
            initial: false
        });
        if (!overwrite.confirm) {
            console.log('Aborted.');
            process.exit(0);
        }
    }

    const policies = await prompts([
        {
            type: 'confirm',
            name: 'autoPr',
            message: 'Enable automatic dependency update PRs?',
            initial: true
        },
        {
            type: 'confirm',
            name: 'autoMerge',
            message: 'Enable auto-merge?',
            initial: false
        },
        {
            type: 'confirm',
            name: 'useSchedule',
            message: 'Do you want to schedule Renovate? (If no, it can run anytime)',
            initial: false
        }
    ]);

    if (policies.autoPr === undefined) process.exit(1);

    let schedule = null;
    if (policies.useSchedule) {
        const schedulePrompt = await prompts({
            type: 'text',
            name: 'value',
            message: 'Enter schedule (e.g., "before 5am on monday"):',
            initial: 'before 5am on monday'
        });
        if (schedulePrompt.value === undefined) process.exit(1);
        schedule = schedulePrompt.value;
    }

    // Save repo context to fe-toolkit.json for the check command
    updateConfig({ renovateProvider: provider, renovateRepoUrl: repoUrl } as any);

    const isGenerated = generateRenovateConfig({ 
        autoPr: policies.autoPr, 
        autoMerge: policies.autoMerge, 
        schedule 
    });

    // 7. Generate & Validate
    if (isGenerated) {
        logger.success('Renovate configuration generated');
        const isValid = validateRenovateConfig();
        if (isValid) {
            logger.success('Configuration validation passed\n');
        } else {
            logger.error('Configuration validation failed.\n');
        }
    } else {
        handleError('Failed to generate renovate configuration.\n');
    }

    // 8. Petunjuk Manual (Kredensial lokal tidak otomatis masuk CI runner)
    console.log(`Next steps:
  1. Configure the automation credential in the selected
     CI/CD environment or Renovate runtime.
  2. Verify repository permissions and automation setup.
  3. Run the setup check to confirm readiness.\n`);
}

function handleCheck() {
    const config = loadConfig() as any;
    const provider = config.renovateProvider;
    const repoUrl = config.renovateRepoUrl;

    if (!provider || !repoUrl) {
        handleError("Renovate is not initialized. Run 'fe-toolkit renovate init' first.");
    }

    const token = getSecureToken(provider);
    if (!token) {
        handleError(`Local credential for ${provider} is missing. Please re-run init or configure it.`);
    }

    // Extract repository namespace/name for the Renovate CLI target
    const match = repoUrl.match(/https?:\/\/[^/]+\/([^/]+\/[^/]+)/);
    let repoTarget = match ? match[1] : null;

    if (repoTarget && repoTarget.endsWith('.git')) {
        repoTarget = repoTarget.slice(0, -4);
    }

    if (!repoTarget) {
        handleError("Invalid repository URL stored in config.");
    }

    console.log(`\nStarting Renovate check for ${repoTarget}...\n`);

    const hostMatch = repoUrl.match(/https?:\/\/([^/]+)/);
    const host = hostMatch ? hostMatch[1] : '';

    let onboardingConfigString = '{}';
    const localConfigPath = path.join(process.cwd(), 'renovate.json');
    if (fs.existsSync(localConfigPath)) {
        try {
            // Read the file the user just generated via init
            const localConfig = fs.readFileSync(localConfigPath, 'utf-8');
            
            // We parse and re-stringify it to ensure it's valid JSON and minify it for the env var
            const parsedConfig = JSON.parse(localConfig);
            onboardingConfigString = JSON.stringify(parsedConfig);
            
            console.log("Found local renovate.json, attaching to onboarding PR configuration...\n");
        } catch (e) {
            console.warn("Found renovate.json but failed to parse it. Proceeding with default onboarding config.");
        }
    }

    const envVariables: Record<string, string> = {
        ...process.env as Record<string, string>,
        RENOVATE_TOKEN: token,
        RENOVATE_PLATFORM: provider,
        RENOVATE_ONBOARDING_CONFIG: onboardingConfigString,
        LOG_LEVEL: 'debug'
    };

    // Renovate butuh tahu alamat API Gitea secara eksplisit
    if (provider === 'gitea' && host) {
        envVariables.RENOVATE_ENDPOINT = `https://${host}/api/v1`;
    }

    try {
        // Execute Renovate via npx, passing the local token as an environment variable
        execSync(`npx --yes renovate ${repoTarget}`, {
            stdio: 'inherit',
            env: envVariables
        });
        logger.success('Renovate check completed successfully.');
    } catch (error) {
        handleError("Renovate check failed. See the logs above for details.");
    }
}

export async function handleJenkins(): Promise<void> {
    const config = loadConfig();
    const provider = config.renovateProvider?.toLowerCase();
    const repoUrl = config.renovateRepoUrl;

    if (!provider || !repoUrl) handleError("Renovate is not initialized. Run 'fe-toolkit renovate init' first.");
    const token = getSecureToken(provider);
    if (!token) handleError(`Local credential for ${provider} is missing. Please re-run init or configure it.`);

    const match = repoUrl.match(/https?:\/\/([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (!match || !match[1] || !match[2]) {
        handleError("Invalid repository URL stored in config. Could not extract host and repo target.");
    }
    const host = match[1];
    const repoTarget = match[2];
    const headers = getAuthHeaders(provider, token);

    try {
        console.log(`\nResolving development branch...`);
        const targetDev = await resolveDevBranch(provider, host, repoTarget, headers);
        logger.success(`Resolved target branch: ${targetDev.name} (SHA: ${targetDev.sha.substring(0, 7)})`);

        console.log(`\nRunning idempotency & conflict checks...`);
        await checkIdempotency(provider, host, repoTarget, targetDev.name, headers);
        logger.success(`Checks passed. Clean environment confirmed.`);

        console.log(`\nCreating working branch '${WORKING_BRANCH}'...`);
        await createBranch(provider, host, repoTarget, targetDev.name, targetDev.sha, headers);
        logger.success(`Branch created successfully.`);

        console.log(`\nPushing Jenkinsfile.renovate to repository...`);
        const jenkinsfileContent = generateJenkinsfile(provider, repoTarget, host, targetDev.name);
        await pushFileViaAPI(provider, host, repoTarget, jenkinsfileContent, headers);
        logger.success(`File pushed successfully.`);

        console.log(`\nOpening Pull Request...`);
        const prUrl = await createPullRequest(provider, host, repoTarget, targetDev.name, headers);
        logger.success(`Pull Request created successfully!`);

        console.log('');
        console.log('AUTOMATION SETUP COMPLETE');
        console.log(`1. Review and merge the automated PR:\n    ${prUrl}\n`);
        console.log('2. Go to your Jenkins Dashboard -> Manage Jenkins -> Credentials');
        console.log('3. Add a new "Secret text" credential with the ID: renovate-token-id');
        console.log('4. Create a new "Pipeline from SCM" job pointing to Jenkinsfile.renovate\n');
        console.log('5. Build once to trigger the automation\n');
        
    } catch (error) {
        // If an explicit throw wasn't caught by handleError
        handleError((error as Error).message);
    }
}

export function handleInfo(): void {
    console.log('\nfe-toolkit renovate info - Reading Renovate configuration...\n');
    
    const cwd = process.cwd();
    
    // List of commonly used Renovate configuration locations
    const possibleLocations = [
        'renovate.json',
        'renovate.json5',
        '.github/renovate.json',
        '.renovaterc',
        '.renovaterc.json'
    ];

    let foundConfigPath: string | null = null;
    let relativeConfigPath: string = '';

    // Look for the first available configuration file
    for (const loc of possibleLocations) {
        const fullPath = path.join(cwd, loc);
        if (fs.existsSync(fullPath)) {
            foundConfigPath = fullPath;
            relativeConfigPath = loc;
            break; 
        }
    }

    if (!foundConfigPath) {
        logger.warning('No Renovate configuration found in this project.');
        console.log('   [i] Recommendation: Create a renovate.json file to manage dependency updates or run fe-toolkit renovate init.');
        return;
    }

    console.log(`   [✓] Configuration file found at: ${relativeConfigPath}\n`);

    if (foundConfigPath.endsWith('.json5')) {
        logger.warning('JSON5 format requires an external parser (e.g., json5 library). Info extraction is currently skipped for .json5 files.');
        return;
    }

    try {
        const rawContent = fs.readFileSync(foundConfigPath, 'utf-8');
        const cleanContent = stripJsonComments(rawContent);
        const config = JSON.parse(cleanContent);

        // --- Extract Information ---

        // 1. Target Repository (Bot configs use 'repositories', local configs implicitly target the current project)
        let targetRepo = 'Current Project (Local Configuration)';
        if (config.repositories && Array.isArray(config.repositories)) {
            targetRepo = config.repositories.join(', ');
        }

        // 2. Extends (Presets)
        const extendsConfig = config.extends || [];
        const extendsDisplay = extendsConfig.length > 0 ? extendsConfig.join(', ') : 'None';

        // 3. Schedule
        const schedule = config.schedule || ['Run at any time (Default)'];
        const scheduleDisplay = Array.isArray(schedule) ? schedule.join(', ') : schedule;

        // 4. Automerge
        const automerge = config.automerge === true ? 'Enabled' : 'Disabled';

        // 5. Credentials / Host Rules
        let credentialsConfigured = 'No';
        try {
            const activeProviders: string[] = [];
            
            if (getSecureToken('github')) activeProviders.push('GitHub');
            if (getSecureToken('gitea')) activeProviders.push('Gitea');
            if (getSecureToken('gitlab')) activeProviders.push('GitLab');

            if (activeProviders.length > 0) {
                credentialsConfigured = `Yes (Secured in system for: ${activeProviders.join(', ')})`;
            }
        } catch (error) {
            credentialsConfigured = 'Error reading local credentials';
            logger.warning('Could not verify secure token status.');
        }

        // 6. Package Rules (Granular dependency updates)
        const packageRules = config.packageRules || [];
        
        // 7. General Status (enabled property)
        const isEnabled = config.enabled !== false ? 'Yes' : 'No (Globally disabled)';

        // --- Display Information ---
        console.log('   --- Renovate Settings ---');
        console.log(`   Target Repository : ${targetRepo}`);
        console.log(`   Updates Enabled   : ${isEnabled}`);
        console.log(`   Extends Presets   : ${extendsDisplay}`);
        console.log(`   Schedule          : ${scheduleDisplay}`);
        console.log(`   Automerge         : ${automerge}`);
        console.log(`   Credentials Setup : ${credentialsConfigured}`);
        console.log(`   Package Rules     : ${packageRules.length} custom rule(s) applied`);

        console.log('\nInfo extraction complete.\n');

    } catch (error) {
        logger.warning(`Failed to parse ${relativeConfigPath}. Ensure it is valid JSON.`);
        handleError(error as Error);
    }
}