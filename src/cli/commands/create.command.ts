import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from '../../core/config';
import { logger } from '../../core/logger';
import { handleError } from '../../core/errors';
import { isValidFeatureName, formatName, generateFeatureStructure } from '../../core/generator';

export function runCreateCommand(args: string[]): void {
    const type = args[0];
    const name = args[1];

    if (type !== 'feature') {
        handleError('Invalid creation type. Currently only supports: fe-toolkit create feature <feature-name>');
    }

    if (!name) {
        handleError('Feature name is required. Example: fe-toolkit create feature user-management');
    }

    if (!isValidFeatureName(name)) {
        handleError(`Invalid input name '${name}'. Please use kebab-case for the CLI input (e.g., user-management).`);
    }

    const config = loadConfig();
    
    // Format nama target sesuai "naming" di fe-toolkit.json
    const formattedName = formatName(name, config.naming);
    
    const parentDirectory = path.join(process.cwd(), config.featuresDirectory);
    const absoluteTargetPath = path.join(parentDirectory, formattedName);

    if (fs.existsSync(parentDirectory)) {
        const existingEntries = fs.readdirSync(parentDirectory);
        const lowerFormattedName = formattedName.toLowerCase();
        
        const conflictingFolder = existingEntries.find(
            entry => entry.toLowerCase() === lowerFormattedName
        );

        if (conflictingFolder) {
            if (conflictingFolder === formattedName) {
                logger.warning(`Feature directory already exists at '${path.join(config.featuresDirectory, formattedName)}'. Aborting creation to prevent overwrite.`);
            } else {
                logger.warning(`A feature named '${conflictingFolder}' already exists. On this operating system, you cannot create both '${conflictingFolder}' and '${formattedName}' in the same directory. Aborting.`);
            }
            return; 
        }
    }

    console.log('\nCreating feature...\n');

    try {
        const createdItems = generateFeatureStructure(absoluteTargetPath, name, formattedName);

        createdItems.forEach(item => {
            console.log(`✓ ${item}`);
        });

        console.log('');
        logger.success(`Feature created: ${path.join(config.featuresDirectory, formattedName)}\n`);
    } catch (error) {
        handleError(error as Error);
    }
}