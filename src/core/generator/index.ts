import * as fs from 'fs';
import * as path from 'path';

const generatorConfigPath = path.join(__dirname, 'generator-config.json');
const generatorConfig = JSON.parse(fs.readFileSync(generatorConfigPath, 'utf-8'));

export interface StructureItem {
    name: string;
    type: 'folder' | 'file';
    children?: StructureItem[];
}

export function toKebabCase(name: string): string {
    return name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
}

export function generateFeatureStructure(
    basePath: string, 
    featureName: string,
    includeTests: boolean
): string[] {
    const template: StructureItem[] = generatorConfig.features["default"];
    
    if (!template) {
        throw new Error(`Default template structure not found in generator-config.json`);
    }

    const outputLogs: string[] = [];
    const testableFolders = ['api', 'components', 'hooks', 'pages', 'utils'];

    function build(items: StructureItem[], currentPath: string, relativeDisplayPath: string) {
        for (const item of items) {
            const itemName = item.name.replace(/__name__/g, featureName);
            const absoluteItemPath = path.join(currentPath, itemName);
            const displayPath = relativeDisplayPath ? `${relativeDisplayPath}/${itemName}` : itemName;

            if (item.type === 'folder') {
                if (!fs.existsSync(absoluteItemPath)) {
                    fs.mkdirSync(absoluteItemPath, { recursive: true });
                    outputLogs.push(`✓ Created folder: ${displayPath}`);
                } else {
                    outputLogs.push(`! Skipped folder: ${displayPath} (Already exists)`);
                }

                if (item.children && item.children.length > 0) {
                    build(item.children, absoluteItemPath, displayPath);
                }
            } else if (item.type === 'file') {
                if (!fs.existsSync(absoluteItemPath)) {
                    fs.writeFileSync(absoluteItemPath, ''); 
                    outputLogs.push(`✓ Created file:   ${displayPath}`);
                } else {
                    outputLogs.push(`! Skipped file:   ${displayPath} (Already exists)`);
                }

                if (includeTests) {
                    const rootFolder = displayPath.split('/')[0] || '';
                    if (testableFolders.includes(rootFolder)) {
                        const extension = itemName.endsWith('.tsx') ? '.test.tsx' : '.test.ts';
                        const baseName = itemName.substring(0, itemName.lastIndexOf('.'));
                        const testFileName = `${baseName}${extension}`;
                        const absoluteTestFilePath = path.join(currentPath, testFileName);
                        const testDisplayPath = relativeDisplayPath ? `${relativeDisplayPath}/${testFileName}` : testFileName;

                        if (!fs.existsSync(absoluteTestFilePath)) {
                            fs.writeFileSync(absoluteTestFilePath, '');
                            outputLogs.push(`✓ Created test:   ${testDisplayPath}`);
                        } else {
                            outputLogs.push(`! Skipped test:   ${testDisplayPath} (Already exists)`);
                        }
                    }
                }
            }
        }
    }

    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
        outputLogs.push(`✓ Created base:   src/features/${featureName}`);
    } else {
        outputLogs.push(`! Target folder src/features/${featureName} already exists. Continuing generation...`);
    }
    
    build(template, basePath, '');
    return outputLogs;
}