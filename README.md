# FE Toolkit CLI

A simple Command Line Interface (CLI) built with Node.js and TypeScript.

## Prerequisites
- Node.js installed
- Git installed

## Setup & Installation
1. Install package:
   ```bash
   npm install --save-dev git+https://github.com/VansonK/fe-toolkit.git#main
   ```
2. Update package:
   ```bash
   npm update fe-toolkit
   ```
   If npm caches aggressively, you can force a fresh install:
   ```bash
   install --save-dev git+https://github.com/yourcompany/fe-toolkit.git#main --force
   ```

*Note: The CLI will automatically compile itself upon installation via the `prepare` script.*

## Usage
Because the toolkit is installed locally to your project, you cannot run `fe-toolkit` directly in your terminal. You must use `npx` or add it to your project's npm scripts.

**Method 1: Using npx**
```bash
npx fe-toolkit <command>
```

**Method 2: npm Scripts**
Add a shortcut to your frontend project's `package.json`:
```json
"scripts": {
  "fe": "fe-toolkit"
}
```
Now you can run commands like: `npm run fe info`


## List of Commands

### General
- `fe-toolkit help`, `--help`, `-h` : Show help menu
- `fe-toolkit --version`, `-v` : Show toolkit version
- `fe-toolkit info` : Show system and environment info
- `fe-toolkit config` : Show current project configuration

### Generators
- `fe-toolkit create feature {feature_name}` : Scaffold a new feature directory

### Renovate Tools for Dependency Management
- `fe-toolkit renovate init` : Initialize Renovate configuration for the project
- `fe-toolkit renovate check` : Setup renovate to target repo or check for dependency updates
- `fe-toolkit renovate automate` : Push Jenkinsfile to target repo for automation
- `fe-toolkit renovate info` : Display Renovate-specific configuration info

### Code Health & Standards
- `fe-toolkit doctor` : Run a health check on the current project setup
- `fe-toolkit check convention` : Validate project architecture and naming conventions based on rules
  - `--json` : Output convention check results in JSON format


## Project Configuration
You can customize the CLI behavior for your specific project by creating a \`fe-toolkit.json\` file in the root directory of your project. If this file is missing, the CLI will safely fall back to its default values. You can also generate the config file by running `fe-toolkit renovate init`.
### Default Values:
```json
{
  "naming": "kebab-case",
  "featuresDirectory": "src/features",
  "includeTests": true
}
```
Supported naming strategies: kebab-case, camelCase, PascalCase, snake_case.

To configure rules' in `fe-toolkit check convention`, add this block in \`fe-toolkit.json\` file:
```json
"rules": {
    "folder-naming-kebab-case": "error",
    "folder-naming-pascal-case": "off",
    "folder-naming-camel-case": "off",
    "folder-naming-snake-case": "off",
    "component-file-kebab-case": "error",
    "component-file-pascal-case": "off",
    "component-file-camel-case": "off",
    "component-file-snake-case": "off",
    "hook-file-kebab-case": "error",
    "hook-file-pascal-case": "off",
    "hook-file-camel-case": "off",
    "hook-file-snake-case": "off",
    "util-api-file-kebab-case": "error",
    "util-api-file-pascal-case": "off",
    "util-api-file-camel-case": "off",
    "util-api-file-snake-case": "off",
    "style-file-kebab-case": "error",
    "style-file-pascal-case": "off",
    "style-file-camel-case": "off",
    "style-file-snake-case": "off",
    "react-component-pascal-case": "error",
    "react-component-kebab-case": "off",
    "react-component-camel-case": "off",
    "react-component-snake-case": "off",
    "variable-function-camel-case": "warning",
    "variable-function-pascal-case": "off",
    "variable-function-kebab-case": "off",
    "variable-function-snake-case": "off",
    "constant-enum-upper-snake-case": "warning"
  }
```
Each rule can be configured to: *error*, *warning*, or *off*

## Feature Generator
Scaffolds a new feature directory with a predefined structure.

**Input Rule**: The <feature-name> argument in the terminal must be written in kebab-case (e.g., user-management). The CLI will automatically convert this name to your preferred casing based on your `fe-toolkit.json` settings.

**Safety Rule**: The generator is non-destructive. If a file or folder already exists, the CLI will abort and will not overwrite your existing code.

### Generator Blueprint
The structure of generated features is completely data-driven. To add new files, folders, or nested directories, edit the `src/core/generator/generator-config.json` file in the CLI source code.

**Key Features**
- `__name__` Placeholder: Use `__name__` in file/folder names. The CLI will dynamically replace it with the generated feature name.
- Nested Structures: Use the "children" array to create folders inside folders.
- File-Specific Naming (Override): You can force a specific file to use a different casing (e.g., React components using PascalCase) by adding the "naming" property, overriding the global project config. **Tentative**

## Jenkins Automation for Renovate
To set up continuous dependency updates using the `renovate automate` command, follow these steps to configure your Jenkins environment:

**Step 1: Set Up the Credential**
1. Open your Jenkins Dashboard and go to Manage Jenkins > Credentials.
2. Click System > Global credentials (unrestricted) > Add Credentials.
3. Set Kind to Secret text.
4. In the Secret field, paste your Personal Access Token (from GitHub, Gitea, or GitLab).
5. In the ID field, type exactly: renovate-token-id.
6. Click Create.

**Step 2: Create the Pipeline Job**
1. Go back to the Jenkins Dashboard and click New Item.
2. Enter a name (e.g., renovate-pipeline-test), select Pipeline, and click OK.
3. Scroll down to the Pipeline section at the bottom of the configuration page.
4. Change the Definition dropdown to Pipeline script from SCM.
5. Change the SCM dropdown to Git.
6. Enter your Repository URL. If your repository is private, select your Git credentials in the Credentials dropdown (this is for cloning the repo, separate from the Renovate token).
7. Under Branches to build, change */master to */chore/jenkins-renovate (this allows you to test the pipeline before merging the Pull Request).
8. Change the Script Path to exactly Jenkinsfile.renovate.
9. Click Save.

**Step 3: Run and Verify the Cron Trigger**
1. In Jenkins, a pipeline must run at least once for it to read the Jenkinsfile and register the triggers block. Click Build Now manually on the left menu.
2. Click the #1 build history item and select Console Output.
3. Verify that Jenkins successfully masks the token, logs into the provider, and executes npx --yes renovate your-repo/target.
4. Refresh the Jenkins page to confirm that build #2 triggers automatically based on your configured schedule.

*Note: The default trigger is everyday at 23:59 PM. Modify Jenkinsfile to change trigger.*

## Contributing to the Toolkit

If you are developing the toolkit locally:
1. Clone the repository and run `npm install`.
2. Run `npm run build` to compile TypeScript and copy JSON assets.
3. Test locally by running `npm link` in the toolkit folder, and run the toolkit in a test project. 
*(Remember to unlink and clear `node_modules` before testing the Git installation process again).*