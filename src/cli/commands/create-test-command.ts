import { analyzeBasicComponent } from '../../analyzer/basic-analyzer.js';
import { parseTsxFile } from '../../analyzer/tsx-parser.js';
import {
  MODE_PROFILES,
  type ModeName,
  type TestType,
} from '../../model/component-model.js';
import { resolveComponentImportPath } from '../../renderer/import-path.js';
import { renderVitestFile } from '../../renderer/vitest-renderer.js';
import { planBasicScenarios } from '../../scenarios/basic-scenarios.js';
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

  if (!profile.allowedTestTypes.includes(type)) {
    return {
      exitCode: 1,
      output: `Invalid combination: --mode ${mode} does not support --type ${type}. Allowed test types for ${mode}: ${profile.allowedTestTypes.join(', ')}.`,
    };
  }

  if (mode !== 'basic') {
    return {
      exitCode: 1,
      output: `Mode "${mode}" is scheduled for the next implementation phase. Basic mode is currently active.`,
    };
  }

  const parsed = parseTsxFile(options.componentPath);
  if (!parsed.sourceFile) {
    return {
      exitCode: 1,
      output: parsed.diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n'),
    };
  }

  const componentModel = analyzeBasicComponent(parsed.sourceFile);
  const outputPath = resolveOutputTestPath(parsed.resolvedPath, options.output);
  const importPath = resolveComponentImportPath(outputPath, parsed.resolvedPath);

  const plan = planBasicScenarios(componentModel, importPath);
  if (!plan.testFileModel) {
    const reasons = plan.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `- ${d.message}`)
      .join('\n');

    return {
      exitCode: 1,
      output: [
        `Analyzing ${componentModel.name}...`,
        '',
        'Component contains unsupported dependencies or patterns for Basic mode.',
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