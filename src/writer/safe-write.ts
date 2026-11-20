// src/writer/safe-write.ts
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SafeWriteOptions {
  outputPath: string;
  content: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface SafeWriteResult {
  written: boolean;
  outputPath: string;
  reason?: string;
}

export function safeWriteTestFile(options: SafeWriteOptions): SafeWriteResult {
  const resolved = path.resolve(options.outputPath);

  if (options.dryRun) {
    return {
      written: false,
      outputPath: resolved,
      reason: 'Dry run enabled; file was not written to disk.',
    };
  }

  if (fs.existsSync(resolved) && !options.force) {
    return {
      written: false,
      outputPath: resolved,
      reason: `Output file already exists at ${resolved}. Pass --force to overwrite.`,
    };
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, options.content, 'utf-8');

  return {
    written: true,
    outputPath: resolved,
  };
}