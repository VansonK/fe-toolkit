#!/usr/bin/env node
// DEPRECATED - WEEK 1

import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const command = args[0];

function showHelp(): void {
    console.log(`
Usage: fe-toolkit <command>

Commands:
  info    Show system information (Node version, platform, current directory, package.json status)
  help    Show this help message
`);
}

function showInfo(): void {
    const currentDir = process.cwd();
    const packageJsonPath = path.join(currentDir, 'package.json');
    const exists = fs.existsSync(packageJsonPath);

    console.log('Frontend Engineering Toolkit\n');
    console.log(`Node         : ${process.version}`);
    console.log(`Platform     : ${process.platform}`);
    console.log(`Directory    : ${currentDir}`);
    console.log(`Project      : ${exists ? 'Node.js project detected' : 'Node.js project not detected'}`);
}

// Routing command
if (!command || command === 'help') {
    showHelp();
    process.exit(0); 
} else if (command === 'info') {
    showInfo();
    process.exit(0);
} else {
    console.error(`\nError: Unknown command '${command}'.`);
    console.log(`Run 'fe-toolkit help' or just 'fe-toolkit' to see available commands.\n`);
    process.exit(1); 
}