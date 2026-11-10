export function showHelp(): void {
    console.log(`
Usage: fe-toolkit [command] [options]

Commands:
  info                          Show system and project information
  config                        Show system and project configuration
  create feature <name>         Generate a new feature structure
Options:
  -h, --help    Show this help message
  -v, --version Show CLI version
`);
}