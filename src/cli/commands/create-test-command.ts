import { analyzeBasicComponent } from '../../analyzer/basic-analyzer.js';
import { analyzeIntermediateComponent } from '../../analyzer/intermediate-analyzer.js';
import { parseTsxFile } from '../../analyzer/tsx-parser.js';
import {
  MODE_PROFILES,
  type ModeName,
  type TestType,
} from '../../model/component-model.js';
import { resolveComponentImportPath } from '../../renderer/import-path.js';
import { renderVitestFile } from '../../renderer/vitest-renderer.js';
import { planBasicScenarios } from '../../scenarios/basic-scenarios.js';
import { planIntermediateScenarios } from '../../scenarios/intermediate-scenario.js';
import { validateGeneratedTestSource } from '../../validation/generated-source-validation.js';
import { resolveOutputTestPath } from '../../writer/output-path.js';
import { safeWriteTestFile } from '../../writer/safe-write.js';

export interface CreateTestOptions {
  componentPath: string;
  mode?: ModeName;
  type?: TestType;
  output?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface CreateTestResult {
  exitCode: number;
  output: string;
  generatedCode?: string;
  outputPath?: string;
}

export function parseCreateTestArgs(args: string[]): CreateTestOptions | { error: string } {
  const componentPath = args[0];
  if (!componentPath || componentPath.startsWith('--')) {
    return {
      error:
        'Component path is required.\nUsage: fe-toolkit create test <component-path> [--mode <basic|intermediate|advanced>] [--type <unit|integration>] [--output <path>] [--dry-run] [--force]',
    };
  }

  const options: CreateTestOptions = { componentPath };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    const [flag, inlineValue] = arg.split('=');

    const readValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        i++;
        return next;
      }
      return undefined;
    };

    switch (flag) {
      case '--mode': {
        const val = readValue();
        if (!val) return { error: 'Missing value for --mode.' };
        options.mode = val as ModeName;
        break;
      }
      case '--type': {
        const val = readValue();
        if (!val) return { error: 'Missing value for --type.' };
        options.type = val as TestType;
        break;
      }
      case '--output': {
        const val = readValue();
        if (!val) return { error: 'Missing value for --output.' };
        options.output = val;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      default:
        return { error: `Unknown option "${arg}" for "create test".` };
    }
  }

  return options;
}

export function runCreateTest(options: CreateTestOptions): CreateTestResult {
  const mode: ModeName = options.mode ?? 'basic';
  const type: TestType = options.type ?? 'unit';

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

  if (!profile.allowedTestTypes.includes(type)) {
    return {
      exitCode: 1,
      output: `Invalid combination: --mode ${mode} does not support --type ${type}. Allowed test types for ${mode}: ${profile.allowedTestTypes.join(', ')}.`,
    };
  }

  const parsed = parseTsxFile(options.componentPath);
  if (!parsed.sourceFile) {
    return {
      exitCode: 1,
      output: parsed.diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n'),
    };
  }

  const componentModel =
    mode === 'intermediate'
      ? analyzeIntermediateComponent(parsed.sourceFile)
      : analyzeBasicComponent(parsed.sourceFile);

  const outputPath = resolveOutputTestPath(parsed.resolvedPath, options.output);
  const importPath = resolveComponentImportPath(outputPath, parsed.resolvedPath);

  const plan =
    mode === 'intermediate'
      ? planIntermediateScenarios(componentModel, importPath)
      : planBasicScenarios(componentModel, importPath);

  if (!plan.testFileModel) {
    const modeLabel = mode === 'intermediate' ? 'Intermediate' : 'Basic';
    const reasons = plan.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `- ${d.message}`)
      .join('\n');

    return {
      exitCode: 1,
      output: [
        `Analyzing ${componentModel.name}...`,
        '',
        `Component contains unsupported dependencies or patterns for ${modeLabel} mode.`,
        'Automatic test generation was skipped.',
        reasons,
      ].join('\n'),
    };
  }

  const generatedCode = renderVitestFile(plan.testFileModel);
  const validationErrors = validateGeneratedTestSource(generatedCode, outputPath);
  if (validationErrors.length > 0) {
    return {
      exitCode: 1,
      output: `Generated source failed validation:\n${validationErrors.map((e) => e.message).join('\n')}`,
    };
  }

  const writeResult = safeWriteTestFile({
    outputPath,
    content: generatedCode,
    dryRun: options.dryRun,
    force: options.force,
  });

  if (!writeResult.written && !options.dryRun) {
    return {
      exitCode: 1,
      output: writeResult.reason ?? 'Failed to write output file.',
    };
  }

  const scenarioSummary = plan.testFileModel.scenarios
    .map((s) => `✓ ${s.title}`)
    .join('\n');

  const lines = [
    `Analyzing ${componentModel.name}...`,
    '',
    'Generated scenarios:',
    scenarioSummary,
    '',
    options.dryRun ? `Dry run preview (${outputPath}):` : 'Created:',
    options.dryRun ? generatedCode : outputPath,
  ];

  return {
    exitCode: 0,
    output: lines.join('\n'),
    generatedCode,
    outputPath,
  };
}