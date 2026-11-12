import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

export type RuleSeverity = 'warning' | 'error' | 'off';

export type RuleResult = {
    rule: string;
    file: string;
    severity: 'warning' | 'error';
    message: string;
};

type CaseType = 'kebab-case' | 'PascalCase' | 'camelCase' | 'snake_case' | 'UPPER_SNAKE_CASE';

// 29 Modular Rules: 4 casing variants for rules 1-7 (28 rules) + 1 constant/enum rule
export const DEFAULT_RULES: Record<string, RuleSeverity> = {
    // 1. Folders / Directories
    'folder-naming-kebab-case': 'error',
    'folder-naming-pascal-case': 'off',
    'folder-naming-camel-case': 'off',
    'folder-naming-snake-case': 'off',

    // 2. Component Files
    'component-file-kebab-case': 'error',
    'component-file-pascal-case': 'off',
    'component-file-camel-case': 'off',
    'component-file-snake-case': 'off',

    // 3. Hook Files
    'hook-file-kebab-case': 'error',
    'hook-file-pascal-case': 'off',
    'hook-file-camel-case': 'off',
    'hook-file-snake-case': 'off',

    // 4. Utils / API Files
    'util-api-file-kebab-case': 'error',
    'util-api-file-pascal-case': 'off',
    'util-api-file-camel-case': 'off',
    'util-api-file-snake-case': 'off',

    // 5. Style Files
    'style-file-kebab-case': 'error',
    'style-file-pascal-case': 'off',
    'style-file-camel-case': 'off',
    'style-file-snake-case': 'off',

    // 6. React Components (AST Content Check)
    'react-component-pascal-case': 'error',
    'react-component-kebab-case': 'off',
    'react-component-camel-case': 'off',
    'react-component-snake-case': 'off',

    // 7. Variables / Functions (AST Content Check)
    'variable-function-camel-case': 'warning',
    'variable-function-pascal-case': 'off',
    'variable-function-kebab-case': 'off',
    'variable-function-snake-case': 'off',

    // 8. Constants / Enums (AST Content Check)
    'constant-enum-upper-snake-case': 'warning',
};

export const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'];

// --- Casing Utilities ---
const CASE_VALIDATORS: Record<CaseType, (str: string) => boolean> = {
    'kebab-case': (str: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(str),
    'PascalCase': (str: string) => /^[A-Z][a-zA-Z0-9]*$/.test(str),
    'camelCase': (str: string) => /^[a-z][a-zA-Z0-9]*$/.test(str),
    'snake_case': (str: string) => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(str),
    'UPPER_SNAKE_CASE': (str: string) => /^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(str),
};

// Framework-reserved routing tokens (TanStack Router, Next.js, etc.)
const isFrameworkRouteException = (name: string): boolean => {
    return (
        name === '__root.tsx' ||
        name.startsWith('_') ||
        name.startsWith('+') ||
        name.includes('$') ||
        /^\[.+\]$/.test(name) ||
        /^\(.+\)$/.test(name)
    );
};

// Extracts full name before final extension and validates lowercase suffixes (e.g., user-profile.api.ts)
const parseFileNameParts = (filename: string): { baseName: string; hasUpperSuffix: boolean } => {
    const parts = filename.split('.');
    if (parts.length <= 1) return { baseName: filename, hasUpperSuffix: false };

    const baseName = parts[0] ?? '';
    // Check middle extensions like `.API.` in `user-profile.API.ts`
    const middleExtensions = parts.slice(1, -1);
    const hasUpperSuffix = middleExtensions.some((ext) => ext !== ext.toLowerCase());

    return { baseName, hasUpperSuffix };
};

// Helper to evaluate a target string against all active rules for a given prefix
function evaluateRuleGroup(
    prefix: string,
    targetString: string,
    filePath: string,
    label: string,
    rulesConfig: Record<string, RuleSeverity>,
    results: RuleResult[]
) {
    const cases: { suffix: string; type: CaseType }[] = [
        { suffix: 'kebab-case', type: 'kebab-case' },
        { suffix: 'pascal-case', type: 'PascalCase' },
        { suffix: 'camel-case', type: 'camelCase' },
        { suffix: 'snake-case', type: 'snake_case' },
    ];

    for (const { suffix, type } of cases) {
        const ruleName = `${prefix}-${suffix}`;
        const severity = rulesConfig[ruleName];
        if (severity && severity !== 'off') {
            if (!CASE_VALIDATORS[type](targetString)) {
                results.push({
                    rule: ruleName,
                    file: filePath,
                    severity,
                    message: `${label} "${targetString}" should be ${type}.`,
                });
            }
        }
    }
}

// --- AST Content Scanner (Rules 6, 7, 8) ---
export function scanFileContent(
    filePath: string,
    relativePath: string,
    rulesConfig: Record<string, RuleSeverity>,
    results: RuleResult[]
) {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const scriptKind = filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);

    const hasExportModifier = (node: ts.Node): boolean => {
        if (!ts.canHaveModifiers(node)) return false;
        const modifiers = ts.getModifiers(node);
        return Boolean(modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    };

    // Recursively check if an AST node returns JSX (identifies React Components accurately)
    const containsJsxReturn = (node: ts.Node): boolean => {
        let foundJsx = false;
        const visit = (child: ts.Node) => {
            if (foundJsx) return;
            if (
                ts.isJsxElement(child) ||
                ts.isJsxSelfClosingElement(child) ||
                ts.isJsxFragment(child)
            ) {
                foundJsx = true;
                return;
            }
            ts.forEachChild(child, visit);
        };
        visit(node);
        return foundJsx;
    };

    // Check if an initializer represents a React wrapper (memo, forwardRef, lazy)
    const isReactComponentWrapper = (initializer?: ts.Expression): boolean => {
        if (!initializer) return false;
        if (ts.isCallExpression(initializer)) {
            const exprText = initializer.expression.getText(sourceFile);
            if (/^(React\.)?(memo|forwardRef|lazy)$/.test(exprText)) {
                return true;
            }
        }
        return containsJsxReturn(initializer);
    };

    // Check if a variable initializer is a static constant (Primitive, Array, or Object literal)
    const isConstantInitializer = (initializer?: ts.Expression): boolean => {
        if (!initializer) return false;
        return (
            ts.isStringLiteral(initializer) ||
            ts.isNumericLiteral(initializer) ||
            initializer.kind === ts.SyntaxKind.TrueKeyword ||
            initializer.kind === ts.SyntaxKind.FalseKeyword ||
            ts.isArrayLiteralExpression(initializer) ||
            ts.isObjectLiteralExpression(initializer) ||
            (ts.isAsExpression(initializer) && initializer.type.getText(sourceFile) === 'const')
        );
    };

    ts.forEachChild(sourceFile, (node) => {
        // 1. Exported Enums -> Rule 8 (Constants/Enums)
        if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
            const enumName = node.name.text;
            const severity = rulesConfig['constant-enum-upper-snake-case'];
            if (severity && severity !== 'off' && !CASE_VALIDATORS['UPPER_SNAKE_CASE'](enumName)) {
                results.push({
                    rule: 'constant-enum-upper-snake-case',
                    file: relativePath,
                    severity,
                    message: `Enum "${enumName}" should be UPPER_SNAKE_CASE.`,
                });
            }
        }

        // 2. Exported Functions -> Rule 6 (Component) or Rule 7 (Variable/Function)
        if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name) {
            const funcName = node.name.text;
            if (containsJsxReturn(node)) {
                evaluateRuleGroup('react-component', funcName, relativePath, 'Component', rulesConfig, results);
            } else {
                evaluateRuleGroup('variable-function', funcName, relativePath, 'Function', rulesConfig, results);
            }
        }

        // 3. Exported Variable Statements (const/let/var)
        if (ts.isVariableStatement(node) && hasExportModifier(node)) {
            const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

            for (const decl of node.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name)) continue;
                const varName = decl.name.text;
                const init = decl.initializer;

                // A. Arrow functions / Function expressions / React wrappers
                if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isCallExpression(init))) {
                    if (isReactComponentWrapper(init)) {
                        evaluateRuleGroup('react-component', varName, relativePath, 'Component', rulesConfig, results);
                    } else {
                        evaluateRuleGroup('variable-function', varName, relativePath, 'Function', rulesConfig, results);
                    }
                    continue;
                }

                // B. Static Constants (Primitives, Objects, Arrays declared with const)
                if (isConst && isConstantInitializer(init)) {
                    const severity = rulesConfig['constant-enum-upper-snake-case'];
                    // Allow camelCase/PascalCase if user explicitly enabled Rule 7 for variables, otherwise enforce UPPER_SNAKE_CASE
                    if (severity && severity !== 'off' && !CASE_VALIDATORS['UPPER_SNAKE_CASE'](varName)) {
                        results.push({
                            rule: 'constant-enum-upper-snake-case',
                            file: relativePath,
                            severity,
                            message: `Constant "${varName}" should be UPPER_SNAKE_CASE.`,
                        });
                    }
                    continue;
                }

                // C. Standard Variables (let, var, or dynamic const assignments)
                evaluateRuleGroup('variable-function', varName, relativePath, 'Variable', rulesConfig, results);
            }
        }
    });
}

// --- Recursive File & Folder Scanner ---
export function scanDirectory(
    dir: string,
    rulesConfig: Record<string, RuleSeverity>,
    results: RuleResult[],
    stats: { scanned: number }
) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        if (IGNORE_DIRS.includes(item.name)) continue;

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(process.cwd(), fullPath);
        stats.scanned++;

        if (item.isDirectory()) {
            // Rule 1: Folders (Skip framework routing folders like _protected or [id])
            if (!isFrameworkRouteException(item.name)) {
                evaluateRuleGroup('folder-naming', item.name, relativePath, 'Folder', rulesConfig, results);
            }
            scanDirectory(fullPath, rulesConfig, results, stats);
        } else {
            // Skip framework routing files like __root.tsx or edit.$id.tsx
            if (isFrameworkRouteException(item.name)) {
                scanFileContent(fullPath, relativePath, rulesConfig, results);
                continue;
            }

            const { baseName, hasUpperSuffix } = parseFileNameParts(item.name);

            const isComponentFile = item.name.endsWith('.tsx') || item.name.endsWith('.jsx');
            // Strict hook detection: matches `use-auth.ts` or `useAuth.ts`, ignores `user-api.ts`
            const isHookFile = /^use(-|[A-Z])/.test(item.name);
            // Expanded style detection: standard CSS/SCSS plus CSS-in-JS conventions
            const isStyleFile = /\.(css|scss|style\.ts|css\.ts)$/.test(item.name);
            const isTsJsFile = item.name.endsWith('.ts') || item.name.endsWith('.js');

            // Rule 2: Component Files
            if (isComponentFile) {
                evaluateRuleGroup('component-file', baseName, relativePath, 'Component file', rulesConfig, results);
            }

            // Rule 3: Hook Files
            if (isHookFile) {
                evaluateRuleGroup('hook-file', baseName, relativePath, 'Hook file', rulesConfig, results);
            }

            // Rule 5: Style Files
            if (isStyleFile) {
                evaluateRuleGroup('style-file', baseName, relativePath, 'Style file', rulesConfig, results);
            }

            // Rule 4: Utils / API Files
            if (isTsJsFile && !isComponentFile && !isHookFile && !isStyleFile && !item.name.includes('.config.')) {
                evaluateRuleGroup('util-api-file', baseName, relativePath, 'Util/API file', rulesConfig, results);

                // Flag uppercase middle suffixes (e.g. `user.API.ts`) if kebab-case is active
                if (hasUpperSuffix && rulesConfig['util-api-file-kebab-case'] !== 'off') {
                    results.push({
                        rule: 'util-api-file-kebab-case',
                        file: relativePath,
                        severity: rulesConfig['util-api-file-kebab-case'] as 'warning' | 'error',
                        message: `File suffix in "${item.name}" should be lowercase (e.g., .api.ts).`,
                    });
                }
            }

            // Rules 6, 7, 8: AST Content Checks
            scanFileContent(fullPath, relativePath, rulesConfig, results);
        }
    }
}