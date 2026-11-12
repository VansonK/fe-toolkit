import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface FeToolkitConfig {
    // naming: string;
    // featuresDirectory: string;
    includeTests: boolean;
    renovateProvider?: string;
    renovateRepoUrl?: string;
}

const defaultConfig: FeToolkitConfig = {
    // naming: 'kebab-case',
    // featuresDirectory: 'src/features',
    includeTests: true
};

export function loadConfig(): FeToolkitConfig {
    const configPath = path.join(process.cwd(), 'fe-toolkit.json');
    // const configPath = path.join(__dirname, '../../../fe-toolkit.json');

    if (!fs.existsSync(configPath)) {
        return { ...defaultConfig };
    }

    try {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(fileContent);
        
        const validatedConfig = { ...defaultConfig };

        if (typeof userConfig === 'object' && userConfig !== null) {
            // Validate 'naming'
            // if ('naming' in userConfig) {
            //     if (typeof userConfig.naming === 'string') {
            //         validatedConfig.naming = userConfig.naming;
            //     } else {
            //         logger.warning(`Invalid type for 'naming' in fe-toolkit.json. Expected string. Using default: '${defaultConfig.naming}'`);
            //     }
            // }

            // // Validate 'featuresDirectory'
            // if ('featuresDirectory' in userConfig) {
            //     if (typeof userConfig.featuresDirectory === 'string') {
            //         validatedConfig.featuresDirectory = userConfig.featuresDirectory;
            //     } else {
            //         logger.warning(`Invalid type for 'featuresDirectory' in fe-toolkit.json. Expected string. Using default: '${defaultConfig.featuresDirectory}'`);
            //     }
            // }

            // Validate 'includeTests'
            if ('includeTests' in userConfig) {
                if (typeof userConfig.includeTests === 'boolean') {
                    validatedConfig.includeTests = userConfig.includeTests;
                } else {
                    logger.warning(`Invalid type for 'includeTests' in fe-toolkit.json. Expected boolean. Using default: ${defaultConfig.includeTests}`);
                }
            }

            // Validate optional Renovate fields
            if ('renovateProvider' in userConfig && typeof userConfig.renovateProvider === 'string') {
                validatedConfig.renovateProvider = userConfig.renovateProvider;
            }
            if ('renovateRepoUrl' in userConfig && typeof userConfig.renovateRepoUrl === 'string') {
                validatedConfig.renovateRepoUrl = userConfig.renovateRepoUrl;
            }
        }

        return validatedConfig;

    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON format in fe-toolkit.json. Please check your syntax.\nDetails: ${error.message}`);
        }
        throw new Error(`Failed to read fe-toolkit.json: ${error}`);
    }
}

export function updateConfig(newValues: Partial<FeToolkitConfig>): void {
    const configPath = path.join(process.cwd(), 'fe-toolkit.json');
    const currentConfig = loadConfig();
    const updatedConfig = { ...currentConfig, ...newValues };
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
}