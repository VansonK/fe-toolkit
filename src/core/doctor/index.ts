// doctor/index.ts
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';

export interface DoctorStats {
    passed: number;
    warnings: number;
    failures: number;
}

// --- Utilities ---

// Simple regex to remove comments from JSON (useful for tsconfig.json)
export function stripJsonComments(jsonString: string): string {
    return jsonString.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => g ? "" : m);
}

// Checks if semver/dependency format looks suspicious
export function isSuspiciousDependencyVersion(version: string): boolean {
    // Allows standard formats like ^1.0.0, ~2.1.x, >=1.0.0, workspace:*, file:, etc.
    // If empty, contains only spaces, or other weird formats, mark as suspicious.
    if (!version || version.trim() === '') return true;
    return false; // Can be expanded with stricter semver regex if needed
}

// --- Health Checks ---

export function checkProjectConfig(cwd: string, stats: DoctorStats) {
    console.log('\nProject & Configuration');
    
    console.log(`   [✓] Project root detected: ${cwd}`);
    stats.passed++;

    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        logger.warning('package.json not found. Is this the correct root directory?');
        stats.failures++;
        return null;
    }

    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        console.log('   [✓] package.json is available and valid JSON.');
        stats.passed++;
    } catch (e) {
        logger.warning('package.json found but JSON format is invalid!');
        stats.failures++;
        return null;
    }

    // Package Manager Detection
    const lockfiles: Record<string, string> = {
        'package-lock.json': 'npm',
        'yarn.lock': 'yarn',
        'pnpm-lock.yaml': 'pnpm',
        'bun.lockb': 'bun'
    };

    const foundLockfiles: { file: string, pm: string }[] = [];

    // Collect all lockfiles in the directory
    for (const [file, pmName] of Object.entries(lockfiles)) {
        if (fs.existsSync(path.join(cwd, file))) {
            foundLockfiles.push({ file, pm: pmName });
        }
    }

    let detectedPm = 'Unknown';
    let detectedLockfile = null;

    if (foundLockfiles.length > 0) {
        // Save to variable for safe access
        const primaryLockfile = foundLockfiles[0];

        if (primaryLockfile) {
            detectedPm = primaryLockfile.pm;
            detectedLockfile = primaryLockfile.file;

            if (foundLockfiles.length === 1) {
                console.log(`   [✓] Package manager detected: ${detectedPm} (via ${detectedLockfile})`);
                stats.passed++;
            } else {
                // Show warning if more than one lockfile is present
                const lockfileNames = foundLockfiles.map(l => l.file).join(', ');
                logger.warning(`MULTIPLE LOCKFILES DETECTED: ${lockfileNames}. Ignore if intended.`);
                stats.warnings++;
                console.log(`   [i] fe-toolkit is using ${detectedLockfile} as the reference for current checks.`);
            }
        }
    } else {
        logger.warning('Lockfile not detected. Package manager cannot be determined (npm/yarn/pnpm/bun).');
        stats.warnings++;
    }

    return { pkg, detectedPm, detectedLockfile };
}

export function checkDependencyHealth(pkg: any, lockfileName: string | null, stats: DoctorStats) {
    console.log('\nDependency Health');
    
    if (!pkg) {
        console.log('   [-] Skipping dependency checks due to package.json issues.');
        return;
    }

    const deps = pkg.dependencies || {};
    const devDeps = pkg.devDependencies || {};

    console.log(`   [i] Found ${Object.keys(deps).length} dependencies and ${Object.keys(devDeps).length} devDependencies.`);

    let hasInvalidVersions = false;
    const allDeps = { ...deps, ...devDeps };
    
    for (const [name, version] of Object.entries(allDeps)) {
        if (isSuspiciousDependencyVersion(version as string)) {
            logger.warning(`Dependency '${name}' has a suspicious or invalid version: "${version}"`);
            stats.warnings++;
            hasInvalidVersions = true;
        }
    }

    if (!hasInvalidVersions) {
        console.log('   [✓] All dependency version formats appear valid.');
        stats.passed++;
    }

    if (lockfileName) {
        console.log(`   [✓] Lockfile sync: ${lockfileName} is available.`);
        stats.passed++;
        // Note: Checking diff reliably between package.json and lockfile without calling
        // native package manager commands (like `npm ci` or complex YAML/JSON parsing) is risky.
        console.log(`   [i] Precise metadata diffing skipped (requires native lockfile parser).`);
    } else {
        logger.warning('No lockfile present. Make sure you have run the install command.');
        stats.warnings++;
    }
}

export function checkTypeScriptHealth(cwd: string, stats: DoctorStats) {
    console.log('\nTypeScript Health');

    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (!fs.existsSync(tsConfigPath)) {
        console.log('   [i] tsconfig.json not found. Assuming this is a pure JavaScript project.');
        return;
    }

    try {
        const rawTsConfig = fs.readFileSync(tsConfigPath, 'utf-8');
        const cleanTsConfig = stripJsonComments(rawTsConfig);
        const tsConfig = JSON.parse(cleanTsConfig);

        console.log('   [✓] tsconfig.json successfully read and validated.');
        stats.passed++;

        // Check compilerOptions
        const options = tsConfig.compilerOptions || {};
        
        // Strict mode check
        if (options.strict === true) {
            console.log('   [✓] compilerOptions.strict is ENABLED.');
            stats.passed++;
        } else if (options.strict === false) {
            logger.warning('compilerOptions.strict is DISABLED. It is highly recommended to enable it.');
            stats.warnings++;
        } else {
            console.log('   [!] compilerOptions.strict is not explicitly set.');
            stats.warnings++;
        }

        // Check path aliases
        if (options.baseUrl || options.paths) {
            console.log('   [✓] Alias paths / baseUrl detected in configuration.');
            stats.passed++;
        } else {
            console.log('   [i] No custom alias paths configured.');
        }

    } catch (e) {
        logger.warning('tsconfig.json found, but its format is invalid or cannot be parsed.');
        stats.failures++;
    }
}

export function checkFrameworkAndTooling(pkg: any, stats: DoctorStats) {
    console.log('\nFramework & Tooling');
    
    if (!pkg) {
        console.log('   [-] Skipping tooling checks due to package.json issues.');
        return;
    }

    // Merge dependencies and devDependencies for searching
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};

    // Framework Detection
    const frameworks = ['react', 'vue', '@angular/core', 'next', 'nuxt', 'vite'];
    const foundFrameworks = frameworks.filter(f => deps[f] !== undefined);
    
    if (foundFrameworks.length > 0) {
        console.log(`   [✓] Framework / Build Tool detected: ${foundFrameworks.join(', ')}`);
        stats.passed++;
    } else {
        console.log('   [i] No standard UI framework (React/Vue/Angular/Next/Nuxt/Vite) detected.');
    }

    // Tooling Detection
    if (deps['typescript']) {
        console.log('   [✓] TypeScript installed (Dependency).');
        stats.passed++;
    }
    if (deps['eslint']) {
        console.log('   [✓] Linter (ESLint) installed.');
        stats.passed++;
    }
    if (deps['prettier']) {
        console.log('   [✓] Formatter (Prettier) installed.');
        stats.passed++;
    }

    // Testing Framework Detection
    const testingTools = ['jest', 'vitest', 'mocha', 'cypress', 'playwright'];
    const foundTests = testingTools.filter(t => deps[t] !== undefined);
    
    if (foundTests.length > 0) {
        console.log(`   [✓] Testing framework detected: ${foundTests.join(', ')}`);
        stats.passed++;
    } else {
        console.log('   [i] No standard testing framework detected.');
    }

    // Check npm scripts
    console.log('   --- NPM Scripts ---');
    ['build', 'test', 'lint'].forEach(scriptName => {
        if (scripts[scriptName]) {
            console.log(`   [✓] Script '${scriptName}' is available.`);
            stats.passed++;
        } else {
            logger.warning(`Script '${scriptName}' not found in package.json.`);
            stats.warnings++;
        }
    });
}

export function checkProjectStructure(cwd: string, config: any | null, stats: DoctorStats) {
    console.log('\nProject Structure');

    // Detect src folder
    if (fs.existsSync(path.join(cwd, 'src'))) {
        console.log('   [✓] Source folder (src/) detected.');
        stats.passed++;
    } else {
        console.log('   [i] src/ folder not found. (Project might be using root structure).');
    }

    // Detect testing folder (various naming conventions)
    const testFolders = ['test', 'tests', '__tests__', 'src/__tests__'];
    const foundTestFolder = testFolders.find(folder => fs.existsSync(path.join(cwd, folder)));
    
    if (foundTestFolder) {
        console.log(`   [✓] Testing folder detected: ${foundTestFolder}/`);
        stats.passed++;
    } else {
        console.log('   [i] Dedicated testing folder not found.');
    }

    // Validate based on fe-toolkit configuration (if available)
    // if (config) {
    //     console.log('   --- fe-toolkit rules ---');
        
    //     // Check features directory
    //     const featuresDir = config.featuresDirectory || 'src/features';
    //     if (fs.existsSync(path.join(cwd, featuresDir))) {
    //         console.log(`   [✓] Features folder (${featuresDir}) according to configuration is available.`);
    //         stats.passed++;
    //     } else {
    //         console.log(`   [i] Features folder (${featuresDir}) does not exist yet. (Use 'fe-toolkit create' to generate it).`);
    //     }

    //     // Check custom required directories if set in fe-toolkit.json
    //     if (Array.isArray(config.requiredDirectories)) {
    //         config.requiredDirectories.forEach((dir: string) => {
    //             if (fs.existsSync(path.join(cwd, dir))) {
    //                 console.log(`   [✓] Required folder (${dir}) is available.`);
    //                 stats.passed++;
    //             } else {
    //                 logger.warning(`Required folder (${dir}) not found!`);
    //                 stats.failures++;
    //             }
    //         });
    //     }
    // }
}

export function checkRenovateSetup(cwd: string, stats: DoctorStats) {
    console.log('\nRenovate Setup & Readiness');

    // List of commonly used Renovate configuration locations
    const possibleLocations = [
        'renovate.json',
        'renovate.json5',
        '.github/renovate.json',
        '.renovaterc',
        '.renovaterc.json'
    ];

    let foundConfigPath: string | null = null;
    let relativeConfigPath: string = '';

    // Look for the first available configuration file
    for (const loc of possibleLocations) {
        const fullPath = path.join(cwd, loc);
        if (fs.existsSync(fullPath)) {
            foundConfigPath = fullPath;
            relativeConfigPath = loc;
            break; 
        }
    }

    if (foundConfigPath) {
        console.log(`   [✓] Renovate configuration detected at: ${relativeConfigPath}`);
        stats.passed++;

        if (foundConfigPath.endsWith('.json') || foundConfigPath.includes('renovaterc')) {
            try {
                const rawContent = fs.readFileSync(foundConfigPath, 'utf-8');
                // Use the stripJsonComments utility created earlier to tolerate comments
                const cleanContent = stripJsonComments(rawContent);
                JSON.parse(cleanContent);
                
                console.log('   [✓] Configuration file format is valid JSON syntax.');
                stats.passed++;
                logger.info('Note: This check only ensures valid JSON syntax, not the semantic validity of Renovate schema rules.');
            } catch (e) {
                logger.warning(`File ${relativeConfigPath} found, but JSON format is invalid.`);
                stats.failures++;
            }
        } else if (foundConfigPath.endsWith('.json5')) {
            console.log('   [i] JSON5 file detected. Syntax validation skipped as it requires an external parser (JSON5).');
            logger.info('Note: Check does not cover semantic validity of Renovate schema rules.');
        }
    } else {
        logger.warning('Renovate configuration not found.');
        stats.warnings++;
        console.log('   [i] Recommendation: Create a renovate.json file at the project root to enable structured automatic dependency updates.');
    }
}

export function checkRuntimeEnv(cwd: string, pkg: any, stats: DoctorStats) {
    console.log('\nRuntime & Developer Experience');

    // 1. Display Current Node.js version
    const currentNodeVersion = process.version;
    const currentMajor = process.versions.node.split('.')[0];
    console.log(`   [✓] Current Node.js version: ${currentNodeVersion}`);
    stats.passed++;

    // 2. Compare with engines.node if defined
    if (pkg && pkg.engines && pkg.engines.node) {
        const engineNode = pkg.engines.node;
        console.log(`   [i] package.json engines.node expects: ${engineNode}`);
        
        // Basic check to see if the current major version is present in the engine string
        const hasMatchingMajor = engineNode.includes(currentMajor);
        
        if (hasMatchingMajor || engineNode === '*') {
            console.log(`   [✓] Current Node.js major version (v${currentMajor}) appears compatible with engines.node.`);
            stats.passed++;
        } else {
            logger.warning(`Current Node.js (v${currentMajor}) might not match engines.node (${engineNode}).`);
            console.log(`   [i] Recommendation: Use nvm or fnm to switch to the required Node version.`);
            stats.warnings++;
        }
    } else {
        console.log('   [i] engines.node is not defined in package.json.');
        console.log('   [i] Recommendation: Define "engines": { "node": ">=18.0.0" } in package.json to ensure team consistency.');
    }

    // 3. Check for .nvmrc or .node-version
    const hasNvmrc = fs.existsSync(path.join(cwd, '.nvmrc'));
    const hasNodeVersion = fs.existsSync(path.join(cwd, '.node-version'));

    if (hasNvmrc || hasNodeVersion) {
        const fileUsed = hasNvmrc ? '.nvmrc' : '.node-version';
        try {
            const versionContent = fs.readFileSync(path.join(cwd, fileUsed), 'utf-8').trim();
            console.log(`   [✓] Node version manager file (${fileUsed}) detected: ${versionContent}`);
            stats.passed++;
        } catch {
            logger.warning(`Found ${fileUsed} but could not read its contents.`);
            stats.warnings++;
        }
    } else {
        logger.warning('No .nvmrc or .node-version file found.');
        console.log('   [i] Recommendation: Create a .nvmrc or .node-version file so developers automatically use the correct Node version.');
        stats.warnings++;
    }
}