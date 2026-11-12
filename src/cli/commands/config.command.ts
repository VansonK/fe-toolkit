import { loadConfig } from '../../core/config';
import { handleError } from '../../core/errors';
import { logger } from '../../core/logger';

export function runConfigCommand(): void {
    try {
        const config = loadConfig();

        console.log('\nConfiguration\n');
        
        // console.log('Naming'.padEnd(20) + config.naming);
        // console.log('Feature Directory'.padEnd(20) + config.featuresDirectory);
        console.log('Include Tests'.padEnd(20) + config.includeTests);
        if (config.renovateProvider) {
            console.log('Renovate Provider'.padEnd(20) + config.renovateProvider);
        }
        if (config.renovateRepoUrl) {
            console.log('Renovate URL'.padEnd(20) + config.renovateRepoUrl);
        }

        console.log('');
        
        logger.success('Project config retrieved successfully.');
        

    } catch (error) {
        handleError(error as Error);
    }
}