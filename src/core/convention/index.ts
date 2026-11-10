// src/commands/convention/check-convention.command.ts
import * as fs from 'fs';
import * as path from 'path';


export type RuleSeverity = 'warning' | 'error' | 'off';

export type RuleResult = {
    rule: string;
    file: string;
    severity: 'warning' | 'error';
    message: string;
};

// 8 Modular Rules matching the convention specification
export const DEFAULT_RULES: Record<string, RuleSeverity> = {
    // 1. Folders / Directories
    'folder-naming-kebab-case': 'error',
    // 2. Component Files
    'component-file-kebab-case': 'error',
    // 3. Hook Files
    'hook-file-kebab-case': 'error',
    // 4. Utils / API Files
    'util-api-file-kebab-case': 'error',
    // 5. Style Files
    'style-file-kebab-case': 'error',
    
    // 6. React Components (Content Check)
    'react-component-pascal-case': 'error',
    // 7. Variables / Functions (Content Check)
    'variable-function-camel-case': 'warning', // Set to warning as regex parsing can be noisy
    // 8. Constants / Enums (Content Check)
    'constant-enum-upper-snake-case': 'warning'
};

export const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'];

// --- Casing Utilities ---
const isKebabCase = (str: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str);
const isPascalCase = (str: string) => /^[A-Z][a-zA-Z0-9]*$/.test(str);
const isCamelCase = (str: string) => /^[a-z][a-zA-Z0-9]*$/.test(str);
const isUpperSnakeCase = (str: string) => /^[A-Z0-9_]+$/.test(str);
const getBaseName = (filename: string): string => filename.split('.')[0] ?? '';

// --- Content Scanner (For Rules 6, 7, 8) ---
export function scanFileContent(filePath: string, relativePath: string, rulesConfig: Record<string, RuleSeverity>, results: RuleResult[]) {
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx') && !filePath.endsWith('.js') && !filePath.endsWith('.jsx')) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Rule 6: React Components (PascalCase)
    if (rulesConfig['react-component-pascal-case'] !== 'off') {
        const componentRegex = /export\s+(?:default\s+)?(?:function|const)\s+([A-Za-z0-9_]+)\s*(?:=|\()/g;
        let match;
        while ((match = componentRegex.exec(content)) !== null) {
            const name = match[1];
            if (!name) continue;
            // Naive check: React components usually start with an uppercase letter
            if (name[0] && name[0] === name[0].toUpperCase() && !isPascalCase(name) && !isUpperSnakeCase(name)) {
                results.push({
                    rule: 'react-component-pascal-case', file: relativePath, severity: rulesConfig['react-component-pascal-case'] as 'warning' | 'error',
                    message: `Component "${name}" should be PascalCase.`
                });
            }
        }
    }

    // Rule 7: Variables / Functions (camelCase)
    if (rulesConfig['variable-function-camel-case'] !== 'off') {
        const varFuncRegex = /export\s+(?:default\s+)?(?:function|const|let|var)\s+([a-zA-Z0-9_]+)\s*(?:=|\()/g;
        let match;
        while ((match = varFuncRegex.exec(content)) !== null) {
            const name = match[1];
            if (!name) continue;
            // Exclude React Components (Starts with uppercase) and Constants (UPPER_SNAKE_CASE)
            if (name[0] && name[0] === name[0].toUpperCase() && !isUpperSnakeCase(name) && !isCamelCase(name)) {
                results.push({
                    rule: 'variable-function-camel-case', file: relativePath, severity: rulesConfig['variable-function-camel-case'] as 'warning' | 'error',
                    message: `Variable/Function "${name}" should be camelCase.`
                });
            }
        }
    }

    // Rule 8: Constants / Enums (UPPER_SNAKE_CASE)
    if (rulesConfig['constant-enum-upper-snake-case'] !== 'off') {
        const constantRegex = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:[A-Z0-9_]+|'[A-Z0-9_]+'|"[A-Z0-9_]+"|[0-9]+)/g;
        let match;
        while ((match = constantRegex.exec(content)) !== null) {
            const name = match[1];
            if (!name) continue;
            if (!isUpperSnakeCase(name)) {
                results.push({
                    rule: 'constant-enum-upper-snake-case', file: relativePath, severity: rulesConfig['constant-enum-upper-snake-case'] as 'warning' | 'error',
                    message: `Constant "${name}" should be UPPER_SNAKE_CASE.`
                });
            }
        }
    }
}

// --- Recursive File & Folder Scanner ---
export function scanDirectory(dir: string, rulesConfig: Record<string, RuleSeverity>, results: RuleResult[], stats: { scanned: number }) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        if (IGNORE_DIRS.includes(item.name)) continue;

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(process.cwd(), fullPath);
        stats.scanned++;

        const baseName = getBaseName(item.name);

        if (item.isDirectory()) {
            // Rule 1: Folders
            if (rulesConfig['folder-naming-kebab-case'] !== 'off' && !isKebabCase(item.name)) {
                results.push({ rule: 'folder-naming-kebab-case', file: relativePath, severity: rulesConfig['folder-naming-kebab-case'] as 'warning' | 'error', message: `Folder "${item.name}" should be kebab-case.` });
            }
            scanDirectory(fullPath, rulesConfig, results, stats);
        } else {
            // Extract booleans to allow independent evaluation (removing 'else if' chains)
            const isComponentFile = item.name.endsWith('.tsx') || item.name.endsWith('.jsx');
            const isHookFile = item.name.startsWith('use');
            const isStyleFile = item.name.endsWith('.css') || item.name.endsWith('.scss');
            const isTsJsFile = item.name.endsWith('.ts') || item.name.endsWith('.js');

            // Rule 2: Components
            if (isComponentFile && rulesConfig['component-file-kebab-case'] !== 'off' && !isKebabCase(baseName)) {
                results.push({ rule: 'component-file-kebab-case', file: relativePath, severity: rulesConfig['component-file-kebab-case'] as 'warning' | 'error', message: `Component file "${item.name}" should be kebab-case.` });
            } 
            
            // Rule 3: Hooks
            if (isHookFile && rulesConfig['hook-file-kebab-case'] !== 'off' && !isKebabCase(baseName)) {
                results.push({ rule: 'hook-file-kebab-case', file: relativePath, severity: rulesConfig['hook-file-kebab-case'] as 'warning' | 'error', message: `Hook file "${item.name}" should be kebab-case.` });
            } 
            
            // Rule 5: Styles
            if (isStyleFile && rulesConfig['style-file-kebab-case'] !== 'off' && !isKebabCase(baseName)) {
                results.push({ rule: 'style-file-kebab-case', file: relativePath, severity: rulesConfig['style-file-kebab-case'] as 'warning' | 'error', message: `Style file "${item.name}" should be kebab-case.` });
            } 
            
            // Rule 4: Utils/API (Ensure it doesn't double-count config files or react components)
            if (isTsJsFile && !isComponentFile && !item.name.includes('.config.') && rulesConfig['util-api-file-kebab-case'] !== 'off' && !isKebabCase(baseName)) {
                // If it's a hook, it's already caught by Rule 3, but we allow both rules to flag it if desired, 
                // or you can add `&& !isHookFile` to strictly separate them.
                if (!isHookFile) {
                    results.push({ rule: 'util-api-file-kebab-case', file: relativePath, severity: rulesConfig['util-api-file-kebab-case'] as 'warning' | 'error', message: `Util/API file "${item.name}" should be kebab-case.` });
                }
            }

            // Run content checks for all code-level rules on this file
            scanFileContent(fullPath, relativePath, rulesConfig, results);
        }
    }
}

