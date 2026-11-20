import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCreateTest } from '../cli/commands/create-test-command.js';

describe('Basic Mode Vertical Slice', () => {
  it('generates runnable Vitest scenarios for a valid presentational Hero component', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-toolkit-basic-'));
    const componentPath = path.join(tmpDir, 'hero.tsx');

    fs.writeFileSync(
      componentPath,
      `
      interface HeroProps {
        title: string;
        description?: string;
        disabled?: boolean;
        onGetStarted: () => void;
      }

      export function Hero({ title, description, disabled, onGetStarted }: HeroProps) {
        return (
          <div>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
            <button disabled={disabled} onClick={onGetStarted}>
              Get Started
            </button>
          </div>
        );
      }
      `,
      'utf-8'
    );

    const res = runCreateTest({ componentPath, mode: 'basic', type: 'unit' });
    expect(res.exitCode).toBe(0);
    expect(res.generatedCode).toContain(`import { Hero } from './hero';`);
    expect(res.generatedCode).toContain(`it('renders title'`);
    expect(res.generatedCode).toContain(`it('renders description when provided'`);
    expect(res.generatedCode).toContain(`it('hides description when absent'`);
    expect(res.generatedCode).toContain(`it('calls onGetStarted when clicked'`);
    expect(res.generatedCode).toContain(`it('disables the button when disabled'`);

    // Verify overwrite protection by default
    const secondRun = runCreateTest({ componentPath, mode: 'basic', type: 'unit' });
    expect(secondRun.exitCode).toBe(1);
    expect(secondRun.output).toContain('already exists');
  });

  it('safely rejects stateful components in Basic mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-toolkit-reject-'));
    const counterPath = path.join(tmpDir, 'counter.tsx');

    fs.writeFileSync(
      counterPath,
      `
      import { useState } from 'react';

      export function Counter() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }
      `,
      'utf-8'
    );

    const res = runCreateTest({ componentPath: counterPath, mode: 'basic' });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('Automatic test generation was skipped');
    expect(fs.existsSync(path.join(tmpDir, 'counter.spec.tsx'))).toBe(false);
  });

  it('rejects invalid mode and type combinations', () => {
    const res = runCreateTest({
      componentPath: 'src/components/hero.tsx',
      mode: 'basic',
      type: 'integration',
    });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('does not support --type integration');
  });
});