import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeBasicComponent } from '../../analyzer/basic-analyzer.js';
import { analyzeIntermediateComponent } from '../../analyzer/intermediate-analyzer.js';
import { parseTsxFile } from '../../analyzer/tsx-parser.js';
import {
  MODE_PROFILES,
  type ComponentModel,
  type ModeName,
} from '../../model/component-model.js';

export interface InspectComponentOptions {
  componentPath: string;
  mode?: ModeName;
  out?: string;
}

export interface InspectComponentResult {
  exitCode: number;
  model?: ComponentModel;
  output: string;
  outputPath?: string;
}

export function parseInspectComponentArgs(
  args: string[]
): InspectComponentOptions | { error: string } {
  let componentPath: string | undefined;
  let mode: ModeName | undefined;
  let out: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--mode' || arg === '-m') {
      const value = args[++i];
      if (!value) return { error: 'Missing value for --mode.' };
      mode = value as ModeName;
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length) as ModeName;
    } else if (arg === '--out' || arg === '-o') {
      const value = args[++i];
      if (!value) return { error: 'Missing value for --out.' };
      out = value;
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option "${arg}" for inspect component.` };
    } else if (!componentPath) {
      componentPath = arg;
    } else {
      return { error: `Unexpected positional argument "${arg}".` };
    }
  }

  if (!componentPath) {
    return {
      error:
        'Component path is required.\n' +
        'Usage: fe-toolkit inspect component <component-path> [--mode <basic|intermediate|advanced>] [--out <file-path>]',
    };
  }

  return { componentPath, mode, out };
}

export function runInspectComponent(
  input: string | InspectComponentOptions
): InspectComponentResult {
  const options: InspectComponentOptions =
    typeof input === 'string' ? { componentPath: input } : input;

  const mode: ModeName = options.mode ?? 'basic';
  const profile = MODE_PROFILES[mode];

  if (!profile) {
    return {
      exitCode: 1,
      output: `Invalid mode "${mode}". Supported modes: basic, intermediate, advanced.`,
    };
  }

  if (mode === 'advanced') {
    return {
      exitCode: 1,
      output: 'Mode "advanced" is not yet implemented. Use --mode basic or --mode intermediate.',
    };
  }

  const parsed = parseTsxFile(options.componentPath);
  if (!parsed.sourceFile) {
    const msg = parsed.diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n');
    return { exitCode: 1, output: msg };
  }

  const model =
    mode === 'intermediate'
      ? analyzeIntermediateComponent(parsed.sourceFile)
      : analyzeBasicComponent(parsed.sourceFile);

  const jsonOutput = JSON.stringify(model, null, 2);

  if (options.out) {
    const resolvedOut = path.resolve(options.out);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, `${jsonOutput}\n`, 'utf-8');

    return {
      exitCode: 0,
      model,
      outputPath: resolvedOut,
      output: `Exported ${model.name} ComponentModel (${mode} mode) to ${resolvedOut}`,
    };
  }

  return {
    exitCode: 0,
    model,
    output: jsonOutput,
  };
}