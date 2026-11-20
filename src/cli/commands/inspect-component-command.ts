import { analyzeBasicComponent } from '../../analyzer/basic-analyzer.js';
import { parseTsxFile } from '../../analyzer/tsx-parser.js';
import type { ComponentModel } from '../../model/component-model.js';

export function runInspectComponent(componentPath: string): {
  exitCode: number;
  model?: ComponentModel;
  output: string;
} {
  const parsed = parseTsxFile(componentPath);
  if (!parsed.sourceFile) {
    const msg = parsed.diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n');
    return { exitCode: 1, output: msg };
  }

  const model = analyzeBasicComponent(parsed.sourceFile);
  return {
    exitCode: 0,
    model,
    output: JSON.stringify(model, null, 2),
  };
}