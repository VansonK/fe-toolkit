import type {
  AssertionModel,
  ImportModel,
  MockBehaviorOverride,
  ModuleMockModel,
  TestFileModel,
  TestScenarioModel,
  UserActionModel,
} from '../model/test-model.js';

const FRAMEWORK_MODULES = new Set([
  'vitest',
  '@testing-library/react',
  '@testing-library/user-event',
]);

function singleQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function renderVitestFile(model: TestFileModel): string {
  const lines: string[] = [];

  // 1. Runner & testing library imports (deduplicated)
  lines.push(...renderHeaderImports(model));

  // 2. Component & mocked module imports
  for (const imp of model.imports) {
    if (FRAMEWORK_MODULES.has(imp.from)) continue;
    lines.push(renderImportStatement(imp));
  }

  // 3. Top-level hoisted vi.mock(...) declarations (Intermediate+)
  if (model.moduleMocks.length > 0) {
    lines.push('');
    for (const mock of model.moduleMocks) {
      lines.push(...renderModuleMock(mock));
    }
  }

  lines.push('');
  lines.push(`describe(${singleQuote(model.componentName)}, () => {`);

  // 4. Shared setup block
  if (model.setup.length > 0) {
    lines.push('  beforeEach(() => {');
    for (const item of model.setup) {
      lines.push(`    ${item.statement}`);
    }
    lines.push('  });');
    lines.push('');
  }

  // 5. Render each test scenario
  model.scenarios.forEach((scenario, index) => {
    lines.push(...renderScenario(model.componentName, scenario));
    if (index < model.scenarios.length - 1) {
      lines.push('');
    }
  });

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

export const renderVitestTestFile = renderVitestFile;

function renderHeaderImports(model: TestFileModel): string[] {
  const vitestImports = new Set<string>(['describe', 'it', 'expect']);
  for (const imp of model.imports) {
    if (imp.from === 'vitest' && imp.named) {
      for (const name of imp.named) vitestImports.add(name);
    }
  }

  const needsVi =
    model.moduleMocks.length > 0 ||
    model.setup.some((s) => s.statement.includes('vi.')) ||
    model.scenarios.some(
      (sc) =>
        (sc.mockOverrides && sc.mockOverrides.length > 0) ||
        sc.props.some((p) => p.isMockFn) ||
        sc.arrangement.some((a) => a.statement.includes('vi.')) ||
        sc.assertions.some((a) => a.kind === 'called' || a.kind === 'called-with')
    );

  if (needsVi) {
    vitestImports.add('vi');
  }
  if (model.setup.length > 0) {
    vitestImports.add('beforeEach');
  }

  const rtlImports = new Set<string>(['render', 'screen']);
  for (const imp of model.imports) {
    if (imp.from === '@testing-library/react' && imp.named) {
      for (const name of imp.named) rtlImports.add(name);
    }
  }

  const needsFireEvent = model.scenarios.some((sc) =>
    sc.actions.some((a) => a.kind === 'submit')
  );
  if (needsFireEvent) {
    rtlImports.add('fireEvent');
  }

  const needsUserEvent =
    model.imports.some((imp) => imp.from === '@testing-library/user-event') ||
    model.scenarios.some((sc) => sc.actions.some((a) => a.kind !== 'submit'));

  const header: string[] = [
    `import { ${Array.from(vitestImports).join(', ')} } from 'vitest';`,
    `import { ${Array.from(rtlImports).join(', ')} } from '@testing-library/react';`,
  ];

  if (needsUserEvent) {
    header.push(`import userEvent from '@testing-library/user-event';`);
  }

  return header;
}

function renderImportStatement(imp: ImportModel): string {
  const parts: string[] = [];
  if (imp.defaultImport) {
    parts.push(imp.defaultImport);
  }
  if (imp.named && imp.named.length > 0) {
    parts.push(`{ ${imp.named.join(', ')} }`);
  }
  return `import ${parts.join(', ')} from ${singleQuote(imp.from)};`;
}

function renderModuleMock(mock: ModuleMockModel): string[] {
  const lines: string[] = [`vi.mock(${singleQuote(mock.modulePath)}, () => ({`];
  for (const exp of mock.namedExports) {
    const fnInit = exp.defaultReturnExpression
      ? `vi.fn(() => ${exp.defaultReturnExpression})`
      : 'vi.fn()';
    lines.push(`  ${exp.name}: ${fnInit},`);
  }
  lines.push('}));');
  return lines;
}

function renderScenario(componentName: string, scenario: TestScenarioModel): string[] {
  const isAsync =
    scenario.actions.length > 0 ||
    scenario.assertions.some((a) => a.kind === 'async-visible-text');

  const asyncPrefix = isAsync ? 'async ' : '';
  const lines: string[] = [`  it(${singleQuote(scenario.title)}, ${asyncPrefix}() => {`];

  // Arrange: per-test mock overrides
  if (scenario.mockOverrides && scenario.mockOverrides.length > 0) {
    for (const override of scenario.mockOverrides) {
      lines.push(`    ${renderMockOverride(override)}`);
    }
  }

  // Arrange: local spies / setup statements
  for (const setupItem of scenario.arrangement) {
    lines.push(`    ${setupItem.statement}`);
  }

  // Ensure any prop marked isMockFn has a named spy variable in scope
  for (const prop of scenario.props) {
    if (!prop.isMockFn) continue;
    const alreadyDeclared = scenario.arrangement.some((a) =>
      new RegExp(`\\bconst\\s+${prop.name}\\b`).test(a.statement)
    );
    if (!alreadyDeclared) {
      lines.push(`    const ${prop.name} = vi.fn();`);
    }
  }

  // Arrange: userEvent instance if interactive actions exist
  const needsUserEvent = scenario.actions.some((a) => a.kind !== 'submit');
  if (needsUserEvent) {
    lines.push('    const user = userEvent.setup();');
  }

  // Arrange: render component with props
  const jsxProps = scenario.props
    .map((prop) => `${prop.name}={${prop.isMockFn ? prop.name : prop.expression}}`)
    .join(' ');
  const jsxTag = jsxProps.length > 0 ? `<${componentName} ${jsxProps} />` : `<${componentName} />`;
  lines.push(`    render(${jsxTag});`);

  // Act: user interactions
  if (scenario.actions.length > 0) {
    lines.push('');
    for (const action of scenario.actions) {
      lines.push(`    ${renderAction(action)}`);
    }
  }

  // Assert: DOM & mock expectations
  if (scenario.assertions.length > 0) {
    lines.push('');
    for (const assertion of scenario.assertions) {
      lines.push(`    ${renderAssertion(assertion)}`);
    }
  }

  lines.push('  });');
  return lines;
}

function renderMockOverride(override: MockBehaviorOverride): string {
  switch (override.behavior) {
    case 'pending':
      return `vi.mocked(${override.exportName}).mockReturnValue(new Promise(() => {}));`;
    case 'resolve':
      return `vi.mocked(${override.exportName}).mockResolvedValue(${override.valueExpression ?? 'undefined'});`;
    case 'reject':
      return `vi.mocked(${override.exportName}).mockRejectedValue(${override.valueExpression ?? 'new Error("Request failed")'});`;
  }
}

function renderAction(action: UserActionModel): string {
  const queryExpr = buildTargetQueryExpression(action);

  switch (action.kind) {
    case 'click':
      return `await user.click(${queryExpr});`;
    case 'type':
      return `await user.type(${queryExpr}, ${JSON.stringify(action.value ?? '')});`;
    case 'clear':
      return `await user.clear(${queryExpr});`;
    case 'select':
      return `await user.selectOptions(${queryExpr}, ${JSON.stringify(action.value ?? '')});`;
    case 'submit':
      return `fireEvent.submit(${queryExpr});`;
  }
}

function buildTargetQueryExpression(action: UserActionModel): string {
  const target = JSON.stringify(action.targetQuery);
  switch (action.queryBy) {
    case 'label':
      return `screen.getByLabelText(${target})`;
    case 'placeholder':
      return `screen.getByPlaceholderText(${target})`;
    case 'text':
      return `screen.getByText(${target})`;
    case 'role':
    default:
      return `screen.getByRole('button', { name: ${target} })`;
  }
}

function renderAssertion(assertion: AssertionModel): string {
  const target = JSON.stringify(assertion.target);

  switch (assertion.kind) {
    case 'visible-text':
      return `expect(screen.getByText(${target})).toBeInTheDocument();`;
    case 'absent-text':
      return `expect(screen.queryByText(${target})).not.toBeInTheDocument();`;
    case 'async-visible-text':
      return `expect(await screen.findByText(${target})).toBeInTheDocument();`;
    case 'called':
      return `expect(${assertion.target}).toHaveBeenCalledTimes(1);`;
    case 'called-with':
      return `expect(${assertion.target}).toHaveBeenCalledWith(${(assertion.expectedArgs ?? []).join(', ')});`;
    case 'disabled':
      return `expect(screen.getByRole('button', { name: ${target} })).toBeDisabled();`;
    case 'enabled':
      return `expect(screen.getByRole('button', { name: ${target} })).toBeEnabled();`;
    case 'item-count':
      return `expect(screen.getAllByRole('listitem')).toHaveLength(${assertion.count ?? 0});`;
  }
}