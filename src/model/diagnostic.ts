export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  sourceLocation?: string;
}

export function createDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  sourceLocation?: string
): Diagnostic {
  return { severity, code, message, sourceLocation };
}