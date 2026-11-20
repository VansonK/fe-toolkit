import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { createDiagnostic, type Diagnostic } from '../model/diagnostic.js';

export interface ParsedTsxResult {
  sourceFile?: ts.SourceFile;
  resolvedPath: string;
  diagnostics: Diagnostic[];
}

export function parseTsxFile(inputPath: string): ParsedTsxResult {
  const resolvedPath = path.resolve(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      resolvedPath,
      diagnostics: [
        createDiagnostic('error', 'INPUT_NOT_FOUND', `Source file not found: ${inputPath}`),
      ],
    };
  }

  if (path.extname(resolvedPath) !== '.tsx') {
    return {
      resolvedPath,
      diagnostics: [
        createDiagnostic(
          'error',
          'NON_TSX_INPUT',
          `Expected a .tsx component file, received: ${path.basename(resolvedPath)}`
        ),
      ],
    };
  }

  const sourceText = fs.readFileSync(resolvedPath, 'utf-8');
  const transpileResult = ts.transpileModule(sourceText, {
    fileName: resolvedPath,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const syntaxErrors = (transpileResult.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );

  if (syntaxErrors.length > 0) {
    return {
      resolvedPath,
      diagnostics: syntaxErrors.map((err) =>
        createDiagnostic(
          'error',
          'INVALID_TSX',
          ts.flattenDiagnosticMessageText(err.messageText, '\n')
        )
      ),
    };
  }

  const sourceFile = ts.createSourceFile(
    resolvedPath,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX
  );

  return { sourceFile, resolvedPath, diagnostics: [] };
}