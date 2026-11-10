import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    nodeVersion: string;
    platform: string;
    currentDir: string;
    hasPackageJson: boolean;
}

export function getProjectInfo(): ProjectInfo {
    const currentDir = process.cwd();
    const packageJsonPath = path.join(currentDir, 'package.json');
    
    return {
        nodeVersion: process.version,
        platform: process.platform,
        currentDir,
        hasPackageJson: fs.existsSync(packageJsonPath)
    };
}