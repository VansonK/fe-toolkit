import ts from 'typescript';
import { createDiagnostic, type Diagnostic } from '../model/diagnostic.js';

export function validateGeneratedTestSource(sourceCode: string, fileName: string): Diagnostic[] {
  const result = ts.transpileModule(sourceCode, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });

  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((err) =>
      createDiagnostic(
        'error',
        'GENERATED_SOURCE_INVALID',
        ts.flattenDiagnosticMessageText(err.messageText, '\n')
      )
    );
}