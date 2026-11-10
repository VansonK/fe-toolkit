import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { handleError } from '../../core/errors';
import { DEFAULT_RULES, RuleResult, scanDirectory } from '../../core/convention';

// --- Main Command Entry ---
export function runConventionCheckCommand(args: string[]): void {
    const subCommand = args[0];

    const isJson = args.includes('--json');

    if (subCommand !== 'convention') {
        if (isJson) {
            console.error(JSON.stringify({ error: 'Invalid check command. Currently only supports: fe-toolkit check convention' }));
            process.exit(1);
        } else {
            handleError('Invalid check command. Currently only supports: fe-toolkit check convention');
        }
    }

    if (!isJson) {
        console.log('\nfe-toolkit check convention - Scanning codebase...\n');
    }
    
    const cwd = process.cwd();
    let rulesConfig = { ...DEFAULT_RULES };

    const configPath = path.join(cwd, 'fe-toolkit.json');
    if (fs.existsSync(configPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.rules) rulesConfig = { ...rulesConfig, ...config.rules };
        } catch {
            if (!isJson) {
                logger.warning('Failed to parse fe-toolkit.json rules. Using default strict rules.');
            }
        }
    }

    const results: RuleResult[] = [];
    const stats = { scanned: 0 };

    try {
        const scanRoot = fs.existsSync(path.join(cwd, 'src')) ? path.join(cwd, 'src') : cwd;
        scanDirectory(scanRoot, rulesConfig, results, stats);

        const errors = results.filter(r => r.severity === 'error');
        const warnings = results.filter(r => r.severity === 'warning');
        
        // A file "passes" if it generated no warnings or errors across any active rules.
        const filesWithIssues = new Set(results.map(r => r.file));
        const passedCount = stats.scanned - filesWithIssues.size;

        if (isJson) {
            const report = {
                summary: {
                    scanned: stats.scanned,
                    passed: Math.max(0, passedCount),
                    warnings: warnings.length,
                    errors: errors.length
                },
                violations: results
            };
            console.log(JSON.stringify(report, null, 2));
        } else {
            // Standard Text Output
            if (results.length > 0) {
                results.forEach(res => {
                    const icon = res.severity === 'error' ? '✗' : '⚠';
                    console.log(` ${icon} [${res.rule}] ${res.file}`);
                    console.log(`   ${res.message}\n`);
                });
            }

            console.log(`${stats.scanned} files/folders scanned\n`);
            console.log(`✓ ${Math.max(0, passedCount)} passed`);
            console.log(`⚠ ${warnings.length} warning(s)`);
            console.log(`✗ ${errors.length} error(s)\n`);
        }

        if (errors.length > 0) process.exit(1);

    } catch (error) {
        // 5. Output crash errors as JSON if requested
        if (isJson) {
            console.error(JSON.stringify({ error: (error as Error).message }));
            process.exit(1);
        } else {
            handleError(error as Error);
        }
    }
}