import * as fs from 'fs';
import * as path from 'path';

// Load JSON config. Karena file ini dikompilasi ke dist/core/generator/index.js,
// kita mundur 3 folder (../../..) untuk kembali ke root project, lalu masuk ke src.
const generatorConfigPath = path.join(__dirname, '../../../src/core/generator/generator-config.json');
const generatorConfig = JSON.parse(fs.readFileSync(generatorConfigPath, 'utf-8'));

export interface StructureItem {
    name: string;
    type: 'folder' | 'file';
    children?: StructureItem[];
}

export function isValidFeatureName(name: string): boolean {
    return /^[a-z0-9-]+$/.test(name);
}

// Utilitas untuk mengubah kebab-case menjadi format dari config
export function formatName(name: string, naming: string): string {
    const parts = name.toLowerCase().split('-');
    
    switch (naming) {
        case 'camelCase':
            return parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        case 'PascalCase':
            return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        case 'snake_case':
            return parts.join('_');
        case 'kebab-case':
        default:
            return name;
    }
}

export function generateFeatureStructure(
    basePath: string, 
    featureKey: string, 
    formattedName: string
): string[] {
    const template: StructureItem[] = generatorConfig.features[featureKey];
    
    if (!template) {
        throw new Error(`Template structure for feature '${featureKey}' not found in generator-config.json`);
    }

    const createdItems: string[] = [];

    // Fungsi Recursive untuk membuat folder dan file bersarang
    function build(items: StructureItem[], currentPath: string, relativeDisplayPath: string) {
        for (const item of items) {
            // Jika template menggunakan placeholder "__name__", otomatis diubah ke casing yang benar
            const itemName = item.name.replace(/__name__/g, formattedName);
            
            const absoluteItemPath = path.join(currentPath, itemName);
            const displayPath = relativeDisplayPath ? `${relativeDisplayPath}/${itemName}` : itemName;

            if (item.type === 'folder') {
                fs.mkdirSync(absoluteItemPath, { recursive: true });
                createdItems.push(displayPath); // Catat untuk dicetak di terminal
                
                // Jika folder ini punya anak (nested), jalankan fungsi build lagi
                if (item.children && item.children.length > 0) {
                    build(item.children, absoluteItemPath, displayPath);
                }
            } else if (item.type === 'file') {
                fs.writeFileSync(absoluteItemPath, ''); // Buat file kosong
                createdItems.push(displayPath);
            }
        }
    }

    // 1. Buat direktori utama (Root folder yang sudah di-format casingnya)
    fs.mkdirSync(basePath, { recursive: true });
    
    // 2. Mulai proses build recursive dari root folder
    build(template, basePath, '');

    return createdItems;
}