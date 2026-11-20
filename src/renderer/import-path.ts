import * as path from 'node:path';

export function resolveComponentImportPath(testFilePath: string, componentFilePath: string): string {
  const testDir = path.dirname(path.resolve(testFilePath));
  const resolvedComponent = path.resolve(componentFilePath);
  let rel = path.relative(testDir, resolvedComponent);

  // Normalize path separators to POSIX style for TS imports
  rel = rel.split(path.sep).join('/');

  // Strip .tsx / .ts extension
  rel = rel.replace(/\.(tsx|ts)$/, '');

  if (!rel.startsWith('.')) {
    rel = `./${rel}`;
  }

  return rel;
}