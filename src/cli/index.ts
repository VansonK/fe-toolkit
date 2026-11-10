#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { runInfoCommand } from './commands/info.command';
import { runConfigCommand } from './commands/config.command';
import { runCreateCommand } from './commands/create.command';
import { runRenovateCommand } from './commands/renovate.command';
import { runDoctorCommand } from './commands/doctor.command';
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
            runCreateCommand(args.slice(1));
            break;
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