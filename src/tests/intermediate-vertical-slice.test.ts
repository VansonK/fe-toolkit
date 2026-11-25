import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCreateTest } from '../cli/commands/create-test-command.js';
import {
  parseInspectComponentArgs,
  runInspectComponent,
} from '../cli/commands/inspect-component-command.js';

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-toolkit-intermediate-'));
  tempDirs.push(dir);

  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2
    ),
    'utf-8'
  );

  return dir;
}

function writeFixture(workspaceDir: string, relativePath: string, content: string): string {
  const fullPath = path.join(workspaceDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Intermediate Mode Vertical Slice', () => {
  it('generates a .spec.tsx test suite for stateful forms, object/array props, ternaries, and lists', () => {
    const workspace = createTempWorkspace();
    const componentPath = writeFixture(
      workspace,
      'src/components/TaskFormPanel.tsx',
      `
      import { useState, type FormEvent } from 'react';

      interface HeaderInfo {
        title: string;
      }

      interface TaskItem {
        id: string;
        label: string;
      }

      export interface TaskFormPanelProps {
        header: HeaderInfo;
        tasks: TaskItem[];
        isArchived: boolean;
        onSubmit: (value: string) => void;
      }

      export function TaskFormPanel({
        header,
        tasks,
        isArchived,
        onSubmit,
      }: TaskFormPanelProps) {
        const [draft, setDraft] = useState('');

        function handleFormSubmit(e: FormEvent) {
          e.preventDefault();
          onSubmit(draft);
        }

        return (
          <section>
            <h2>{header.title}</h2>
            {isArchived ? <span>Archived</span> : <span>Active</span>}
            <ul>
              {tasks.map((task) => (
                <li key={task.id}>{task.label}</li>
              ))}
            </ul>
            <form onSubmit={handleFormSubmit}>
              <label htmlFor="task-input">Task Name</label>
              <input
                id="task-input"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit">Add Task</button>
            </form>
          </section>
        );
      }
      `
    );

    // 1. Basic mode should reject this stateful/complex component safely
    const basicResult = runCreateTest({
      componentPath,
      mode: 'basic',
    });
    expect(basicResult.exitCode).toBe(1);
    expect(fs.existsSync(path.join(workspace, 'src/components/TaskFormPanel.spec.tsx'))).toBe(false);

    // 2. Intermediate mode should succeed and write TaskFormPanel.spec.tsx
    const result = runCreateTest({
      componentPath,
      mode: 'intermediate',
    });

    expect(result.exitCode).toBe(0);
    expect(result.outputPath).toBe(path.join(workspace, 'src/components/TaskFormPanel.spec.tsx'));
    expect(fs.existsSync(result.outputPath!)).toBe(true);

    const code = result.generatedCode ?? '';
    expect(code).toContain(`import { TaskFormPanel } from './TaskFormPanel';`);
    expect(code).toContain(`import userEvent from '@testing-library/user-event';`);
    expect(code).toContain(`expect(screen.getByText("Test title")).toBeInTheDocument();`);
    expect(code).toContain(`expect(screen.getByText("Archived")).toBeInTheDocument();`);
    expect(code).toContain(`expect(screen.queryByText("Active")).not.toBeInTheDocument();`);
    expect(code).toContain(`expect(screen.getByText("Test label")).toBeInTheDocument();`);
    expect(code).toContain(`expect(screen.getByText("Test label 2")).toBeInTheDocument();`);
    expect(code).toContain(`await user.type(screen.getByLabelText("Task Name"), "Test Task Name");`);
    expect(code).toContain(`expect(onSubmit).toHaveBeenCalledTimes(1);`);
  });

  it('hoists vi.mock and generates async flow assertions for local service dependencies', () => {
    const workspace = createTempWorkspace();
    writeFixture(
      workspace,
      'src/api/auth-api.ts',
      `export async function submitSignIn(email: string): Promise<void> {}`
    );

    const componentPath = writeFixture(
      workspace,
      'src/components/SignInCard.tsx',
      `
      import { useState, type FormEvent } from 'react';
      import { submitSignIn } from '../api/auth-api.js';

      export function SignInCard() {
        const [email, setEmail] = useState('');

        async function handleSubmit(e: FormEvent) {
          e.preventDefault();
          await submitSignIn(email);
        }

        return (
          <form onSubmit={handleSubmit}>
            <label htmlFor="email-field">Email</label>
            <input
              id="email-field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit">Sign In</button>
          </form>
        );
      }
      `
    );

    const result = runCreateTest({
      componentPath,
      mode: 'intermediate',
    });

    expect(result.exitCode).toBe(0);
    const code = result.generatedCode ?? '';
    expect(code).toContain(`vi.mock('../api/auth-api.js', () => ({`);
    expect(code).toContain(`submitSignIn: vi.fn(),`);
    expect(code).toContain(`beforeEach(() => {`);
    expect(code).toContain(`vi.clearAllMocks();`);
    expect(code).toContain(`vi.mocked(submitSignIn).mockResolvedValue(undefined);`);
    expect(code).toContain(`await user.type(screen.getByLabelText("Email"), "user@example.com");`);
    expect(code).toContain(`expect(submitSignIn).toHaveBeenCalledTimes(1);`);
  });

  it('safely rejects Advanced-only patterns (useContext, router, query stores) without writing files', () => {
    const workspace = createTempWorkspace();

    const contextComponent = writeFixture(
      workspace,
      'src/components/ThemedBanner.tsx',
      `
      import { createContext, useContext } from 'react';
      const ThemeContext = createContext('light');

      export function ThemedBanner() {
        const theme = useContext(ThemeContext);
        return <p>{theme}</p>;
      }
      `
    );

    const routerComponent = writeFixture(
      workspace,
      'src/components/NavButton.tsx',
      `
      import { useNavigate } from 'react-router-dom';

      export function NavButton() {
        const navigate = useNavigate();
        return <button onClick={() => navigate('/home')}>Go Home</button>;
      }
      `
    );

    const queryComponent = writeFixture(
      workspace,
      'src/components/UserProfile.tsx',
      `
      import { useQuery } from '@tanstack/react-query';

      export function UserProfile() {
        const { data } = useQuery({ queryKey: ['user'], queryFn: async () => 'Ada' });
        return <p>{data}</p>;
      }
      `
    );

    for (const filePath of [contextComponent, routerComponent, queryComponent]) {
      const result = runCreateTest({
        componentPath: filePath,
        mode: 'intermediate',
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('--mode advanced');

      const expectedSpec = filePath.replace(/\.tsx$/, '.spec.tsx');
      expect(fs.existsSync(expectedSpec)).toBe(false);
    }
  });

  it('rejects --mode intermediate with --type integration at CLI validation', () => {
    const workspace = createTempWorkspace();
    const componentPath = writeFixture(
      workspace,
      'src/components/SimpleBox.tsx',
      `export function SimpleBox() { return <p>Hello</p>; }`
    );

    const result = runCreateTest({
      componentPath,
      mode: 'intermediate',
      type: 'integration',
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('does not support --type integration');
    expect(fs.existsSync(path.join(workspace, 'src/components/SimpleBox.spec.tsx'))).toBe(false);
  });

  it('supports inspect component with --mode intermediate and exports JSON via --out', () => {
    const workspace = createTempWorkspace();
    const componentPath = writeFixture(
      workspace,
      'src/components/CounterCard.tsx',
      `
      import { useState } from 'react';

      export interface CounterCardProps {
        items: Array<{ id: string; name: string }>;
      }

      export function CounterCard({ items }: CounterCardProps) {
        const [locked, setLocked] = useState(false);

        return (
          <div>
            <ul>
              {items.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
            </ul>
            <button onClick={() => setLocked(!locked)}>Toggle</button>
            <button disabled={locked}>Submit</button>
          </div>
        );
      }
      `
    );

    const outJsonPath = path.join(workspace, '.artifacts/counter-card.model.json');
    const parsedArgs = parseInspectComponentArgs([
      componentPath,
      '--mode',
      'intermediate',
      '--out',
      outJsonPath,
    ]);

    expect('error' in parsedArgs).toBe(false);
    if ('error' in parsedArgs) return;

    const inspectResult = runInspectComponent(parsedArgs);
    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.outputPath).toBe(outJsonPath);
    expect(fs.existsSync(outJsonPath)).toBe(true);

    const exportedModel = JSON.parse(fs.readFileSync(outJsonPath, 'utf-8'));
    expect(exportedModel.name).toBe('CounterCard');
    expect(exportedModel.state).toHaveLength(1);
    expect(exportedModel.state[0].name).toBe('locked');
    expect(exportedModel.lists).toHaveLength(1);
    expect(exportedModel.lists[0].sourceName).toBe('items');
    expect(exportedModel.props[0].fields).toEqual([
      { name: 'id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
    ]);
  });
});