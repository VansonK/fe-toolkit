import type { TestFileModel, TestScenarioModel } from '../model/test-model.js';

export function renderVitestFile(model: TestFileModel): string {
  const lines: string[] = [];

  // Determine if userEvent is actually needed across scenarios
  const needsUserEvent = model.scenarios.some((s) => s.actions.length > 0);
  const needsVi = model.scenarios.some((s) => s.props.some((p) => p.isMockFn));

  for (const imp of model.imports) {
    if (imp.from === '@testing-library/user-event' && !needsUserEvent) continue;

    if (imp.from === 'vitest' && imp.named) {
      const filtered = imp.named.filter((n) => n !== 'vi' || needsVi);
      lines.push(`import { ${filtered.join(', ')} } from '${imp.from}';`);
      continue;
    }

    if (imp.defaultImport) {
      lines.push(`import ${imp.defaultImport} from '${imp.from}';`);
    } else if (imp.named && imp.named.length > 0) {
      lines.push(`import { ${imp.named.join(', ')} } from '${imp.from}';`);
    }
  }

  lines.push('');
  lines.push(`describe('${model.componentName}', () => {`);

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

function renderScenario(componentName: string, scenario: TestScenarioModel): string[] {
  const isAsync = scenario.actions.length > 0;
  const fnPrefix = isAsync ? 'async () =>' : '() =>';
  const lines: string[] = [`  it('${escapeSingleQuotes(scenario.title)}', ${fnPrefix} {`];

  if (isAsync) {
    lines.push('    const user = userEvent.setup();');
  }

  // Declare mock functions as named variables so assertions can reference them
  for (const prop of scenario.props) {
    if (prop.isMockFn) {
      lines.push(`    const ${prop.name} = vi.fn();`);
    }
  }

  const jsxProps = scenario.props
    .map((p) => (p.isMockFn ? `${p.name}={${p.name}}` : `${p.name}={${p.expression}}`))
    .join(' ');

  const renderedJsx = jsxProps ? `<${componentName} ${jsxProps} />` : `<${componentName} />`;
  lines.push(`    render(${renderedJsx});`);

  for (const action of scenario.actions) {
    if (action.kind === 'click') {
      lines.push(
        `    await user.click(screen.getByRole('button', { name: '${escapeSingleQuotes(action.targetQuery)}' }));`
      );
    }
  }

  for (const assertion of scenario.assertions) {
    switch (assertion.kind) {
      case 'visible-text':
        lines.push(`    expect(screen.getByText('${escapeSingleQuotes(assertion.target)}')).toBeInTheDocument();`);
        break;
      case 'absent-text':
        lines.push(`    expect(screen.queryByText('${escapeSingleQuotes(assertion.target)}')).not.toBeInTheDocument();`);
        break;
      case 'called':
        lines.push(`    expect(${assertion.target}).toHaveBeenCalledTimes(1);`);
        break;
      case 'disabled':
        lines.push(
          `    expect(screen.getByRole('button', { name: '${escapeSingleQuotes(assertion.target)}' })).toBeDisabled();`
        );
        break;
      case 'enabled':
        lines.push(
          `    expect(screen.getByRole('button', { name: '${escapeSingleQuotes(assertion.target)}' })).toBeEnabled();`
        );
        break;
    }
  }

  lines.push('  });');
  return lines;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "\\'");
}