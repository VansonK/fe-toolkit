# FE Toolkit CLI

A simple Command Line Interface (CLI) built with Node.js and TypeScript.

## Prerequisites
- Node.js installed

## Setup & Installation
1. Install dependencies:
   `npm install`
2. Build the TypeScript code to JavaScript:
   `npm run build`
3. Link the package globally so you can use the \`fe-toolkit\` command anywhere on your local machine:
   `npm link`

## Usage
- **Show help:**
  `fe-toolkit`
- **Show system info:**
  `fe-toolkit info`
- **Show system version:**
  `fe-toolkit --version`
- **Show system config:**
  `fe-toolkit config`
- **Create feature:**
  `fe-toolkit create feature {feature-name}`

## Project Configuration
You can customize the CLI behavior for your specific project by creating a \`fe-toolkit.json\` file in the root directory of your project. If this file is missing, the CLI will safely fall back to its default values.
### Default Values:
{
  "naming": "kebab-case",
  "featuresDirectory": "src/features",
  "includeTests": true
}


Supported naming strategies: kebab-case, camelCase, PascalCase, snake_case.

## Feature Generator
Scaffolding a new feature directory with a predefined structure.\
**Input Rule**: The <feature-name> argument in the terminal must be written in kebab-case (e.g., user-management). The CLI will automatically convert this name to your preferred casing based on your `fe-toolkit.json` settings.

**Safety Rule**: The generator is non-destructive. If a file or folder already exists, the CLI will skip it and will not overwrite your existing code.

### Generator Blueprint
The structure of generated features is completely data-driven. To add new files, folders, or nested directories, edit the `src/core/generator/generator-config.json` file in the CLI source code.

**Key Features**
- `__name__` Placeholder: Use `__name__` in file/folder names. The CLI will dynamically replace it with the generated feature name.
- Nested Structures: Use the "children" array to create folders inside folders.
- File-Specific Naming (Override): You can force a specific file to use a different casing (e.g., React components using PascalCase) by adding the "naming" property, overriding the global project config.

## Development
To test changes, just run `npm run build` again. The global `fe-toolkit` command will automatically point to the updated `dist/cli.js` file.