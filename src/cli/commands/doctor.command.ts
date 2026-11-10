// doctor.command.ts
import * as fs from 'fs';
import * as path from 'path';
import { handleError } from '../../core/errors';
import { logger } from '../../core/logger';
import { checkProjectConfig, checkDependencyHealth, checkTypeScriptHealth, checkFrameworkAndTooling, checkProjectStructure, checkRenovateSetup, DoctorStats, checkRuntimeEnv } from '../../core/doctor';
// --- Main Command Entry ---

export function runDoctorCommand(): void {
    console.log('\nfe-toolkit doctor - Checking project health...\n');
    
    const cwd = process.cwd();
    const stats: DoctorStats = { passed: 0, warnings: 0, failures: 0 };

    // Try reading fe-toolkit.json safely
    let toolkitConfig = null;
    const configPath = path.join(cwd, 'fe-toolkit.json');
    if (fs.existsSync(configPath)) {
        try {
            toolkitConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            console.log('   [✓] fe-toolkit.json configuration loaded.\n');
            stats.passed++;
        } catch (e) {
            logger.warning('   [!] fe-toolkit.json found, but JSON format is invalid.\n');
            stats.failures++;
        }
    }

    try {
        // 1 & 2. Project, Configuration, Dependency
        const configContext = checkProjectConfig(cwd, stats);

        if (configContext) {
            checkRuntimeEnv(cwd, configContext.pkg, stats);
            
            checkDependencyHealth(configContext.pkg, configContext.detectedLockfile, stats);
            
            // 4. Framework & Tooling 
            checkFrameworkAndTooling(configContext.pkg, stats);
        }

        // 3. TypeScript Health
        checkTypeScriptHealth(cwd, stats);

        // 5. Project Structure 
        checkProjectStructure(cwd, toolkitConfig, stats);

        // 6. Renovate Setup
        checkRenovateSetup(cwd, stats);

        console.log('\nSummary');
        console.log(`  ${stats.passed} passed`);
        console.log(`  ${stats.warnings} warnings`);
        console.log(`  ${stats.failures} failures\n`);
    } catch (error) {
        handleError(error as Error);
    }
}