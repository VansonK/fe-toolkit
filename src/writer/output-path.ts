// src/writer/output-path.ts
import * as path from 'node:path';

export function resolveOutputTestPath(componentPath: string, explicitOutput?: string): string {
  if (explicitOutput) {
    return path.resolve(explicitOutput);
  }
  const dir = path.dirname(path.resolve(componentPath));
  const base = path.basename(componentPath, path.extname(componentPath));
  return path.join(dir, `${base}.spec.tsx`);
}
