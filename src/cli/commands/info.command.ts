import { getProjectInfo } from '../../core/project';
import { logger } from '../../core/logger';

export function runInfoCommand(): void {
    const info = getProjectInfo();

    console.log('Frontend Engineering Toolkit\n');
    console.log(`Node         : ${info.nodeVersion}`);
    console.log(`Platform     : ${info.platform}`);
    console.log(`Directory    : ${info.currentDir}`);
    console.log(`Project      : ${info.hasPackageJson ? 'Node.js project detected' : 'Node.js project not detected'}\n`);

    logger.success('Project info retrieved successfully.');
}