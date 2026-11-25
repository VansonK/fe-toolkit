#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { runInfoCommand } from './commands/info.command';
import { runConfigCommand } from './commands/config.command';
import { runCreateCommand } from './commands/create.command';
import { runRenovateCommand } from './commands/renovate.command';
import { runDoctorCommand } from './commands/doctor.command';
import { runCreateTest, parseCreateTestArgs} from './commands/create-test-command';
import { runInspectComponent, parseInspectComponentArgs } from './commands/inspect-component-command';
import { showHelp } from './help';
import { handleError } from '../core/errors';
import { runConventionCheckCommand } from './commands/check-convention.command';

function getVersion(): string {
    try {
        const pkgPath = path.join(__dirname, '../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version;
    } catch (err) {
        return 'unknown';
    }
}

function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const subCommand = args[1];

    // Handle empty command atau --help
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        showHelp();
        process.exit(0);
    }

    // Handle --version
    if (command === '--version' || command === '-v') {
        console.log(`fe-toolkit v${getVersion()}`);
        process.exit(0);
    }

    // Command Routing
    switch (command) {
        case 'info':
            runInfoCommand();
            break;
        case 'config':
            runConfigCommand();
            break;
        case 'create':
            if (subCommand === 'feature') {
                runCreateCommand(args.slice(1));
                break;
            }

            if (subCommand === 'test') {
                const parsed = parseCreateTestArgs(args.slice(2));
                if ('error' in parsed) {
                console.error(parsed.error);
                process.exit(1);
                }
                const result = runCreateTest(parsed);
                console.log(result.output);
                process.exit(result.exitCode);
            }

            console.error(
                'Invalid creation target. Supported targets:\n' +
                '  fe-toolkit create feature <feature-name>\n' +
                '  fe-toolkit create test <component-path> [options]'
            );
            process.exit(1);
        case 'inspect':
            if (subCommand === 'component') {
                const parsed = parseInspectComponentArgs(args.slice(2));
                if ('error' in parsed) {
                    console.error(parsed.error);
                    process.exit(1);
                }
                const result = runInspectComponent(parsed);
                console.log(result.output);
                process.exit(result.exitCode);
            }

            console.error(
                'Invalid inspect target. Usage: fe-toolkit inspect component <component-path> [--mode <basic|intermediate|advanced>] [--out <file-path>]'
            );
            process.exit(1);       
        case 'renovate':
            runRenovateCommand(args.slice(1));
            break;
        case 'doctor':
            runDoctorCommand();
            break;
        case 'check':
            runConventionCheckCommand(args.slice(1));
            break;
        default:
            handleError(`Unknown command '${command}'. Run 'fe-toolkit --help' for available commands.`);
    }
}

// Menangkap error global jika ada fungsi yang gagal (uncaught exception)
try {
    main();
} catch (error) {
    handleError(error as Error);
}