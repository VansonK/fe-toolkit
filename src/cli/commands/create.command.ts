import * as path from 'path';
import { loadConfig } from '../../core/config';
import { logger } from '../../core/logger';
import { handleError } from '../../core/errors';
import { toKebabCase, generateFeatureStructure } from '../../core/generator';

export function runCreateCommand(args: string[]): void {
    const type = args[0];
    const name = args[1];

    if (type !== 'feature') {
        handleError('Invalid creation type. Currently only supports: fe-toolkit create feature <feature-name>');
    }

    if (!name) {
        handleError('Feature name is required. Example: fe-toolkit create feature user-management');
    }

    const config = loadConfig();
    const kebabName = toKebabCase(name);
    
    if (name !== kebabName) {
        logger.warning(`Input name '${name}' was converted to kebab-case: '${kebabName}'`);
    }

    const parentDirectory = path.join(process.cwd(), 'src/features');
    const absoluteTargetPath = path.join(parentDirectory, kebabName);

    console.log(`\nScaffolding feature: ${kebabName}...\n`);

    try {
        const outputLogs = generateFeatureStructure(absoluteTargetPath, kebabName, config.includeTests);

        outputLogs.forEach(log => {
            if (log.startsWith('✓')) {
                logger.info(log);
            } else {
                logger.warning(log);
            }
        });

        console.log('');
        logger.success(`Feature scaffolding completed at src/features/${kebabName}\n`);
    } catch (error) {
        handleError(error as Error);
    }
}