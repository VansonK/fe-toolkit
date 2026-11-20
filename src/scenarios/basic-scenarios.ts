import type { ComponentModel, PropModel } from '../model/component-model.js';
import type { Diagnostic } from '../model/diagnostic.js';
import type {
  GeneratedPropValue,
  TestFileModel,
  TestScenarioModel,
} from '../model/test-model.js';

function defaultTextForProp(propName: string): string {
  return `Test ${propName}`;
}

export interface ScenarioPlanResult {
  testFileModel: TestFileModel | null;
  diagnostics: Diagnostic[];
}

export function planBasicScenarios(
  component: ComponentModel,
  componentImportPath: string
): ScenarioPlanResult {
  const errors = component.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    return {
      testFileModel: null,
      diagnostics: component.diagnostics,
    };
  }

  const baseProps = buildDefaultProps(component.props, { omitOptional: true });
  const scenarios: TestScenarioModel[] = [];

  // Scenario 1: Required displayed string/number props render supplied values
  const boundProps = Array.from(
    new Set(
      component.elements
        .map((el) => el.boundProp)
        .filter((propName): propName is string => Boolean(propName))
    )
  );

  const renderedBoundProps = boundProps.filter((propName) =>
    baseProps.some((p) => p.name === propName)
  );

  if (renderedBoundProps.length > 0) {
    for (const displayedProp of renderedBoundProps) {
      const propMeta = component.props.find((p) => p.name === displayedProp);
      const expectedText =
        propMeta?.type === 'number' ? '1' : defaultTextForProp(displayedProp);
      scenarios.push({
        title: `renders ${displayedProp}`,
        props: baseProps,
        arrangement: [],
        actions: [],
        assertions: [{ kind: 'visible-text', target: expectedText }],
      });
    }
  } else if (component.elements.some((el) => el.textContent)) {
    const firstStatic = component.elements.find((el) => el.textContent)!;
    scenarios.push({
      title: `renders ${component.name}`,
      props: baseProps,
      arrangement: [],
      actions: [],
      assertions: [{ kind: 'visible-text', target: firstStatic.textContent! }],
    });
  }

  // Scenario 2 & 3: Optional conditional content (&&) shown when provided, omitted when absent
  for (const cond of component.conditions) {
    const condProp = component.props.find((p) => p.name === cond.conditionProp);
    if (!condProp) continue;

    const fallbackText = defaultTextForProp(cond.conditionProp);
    const shownValue =
      condProp.type === 'boolean'
        ? 'true'
        : condProp.type === 'number'
          ? '1'
          : JSON.stringify(fallbackText);
    const expectedContent =
      cond.renderedText ?? (condProp.type === 'number' ? '1' : fallbackText);

    const withConditionProps = buildDefaultProps(component.props, {
      omitOptional: true,
      overrides: { [cond.conditionProp]: shownValue },
    });

    scenarios.push({
      title: `renders ${cond.conditionProp} when provided`,
      props: withConditionProps,
      arrangement: [],
      actions: [],
      assertions: [{ kind: 'visible-text', target: expectedContent }],
    });

    const withoutConditionProps = buildDefaultProps(component.props, {
      omitOptional: true,
      overrides: { [cond.conditionProp]: 'undefined' },
    }).filter((p) => p.expression !== 'undefined');

    scenarios.push({
      title: `hides ${cond.conditionProp} when absent`,
      props: withoutConditionProps,
      arrangement: [],
      actions: [],
      assertions: [{ kind: 'absent-text', target: expectedContent }],
    });
  }

  // Scenario 4: Button with callback prop calls callback on click
  for (const interaction of component.interactions) {
    if (interaction.event !== 'onClick' || !interaction.handlerProp) continue;
    const enabledProps = buildDefaultProps(component.props, {
      omitOptional: true,
      overrides: { [interaction.handlerProp]: 'vi.fn()' },
    });

    // Ensure disabled prop is false during click test if present
    const disabledProp = component.elements.find((el) => el.disabledProp)?.disabledProp;
    if (disabledProp) {
      const idx = enabledProps.findIndex((p) => p.name === disabledProp);
      if (idx >= 0) enabledProps[idx] = { name: disabledProp, expression: 'false' };
      else enabledProps.push({ name: disabledProp, expression: 'false' });
    }

    const buttonLabel = interaction.elementText ?? 'button';
    scenarios.push({
      title: `calls ${interaction.handlerProp} when clicked`,
      props: enabledProps,
      arrangement: [],
      actions: [{ kind: 'click', targetQuery: buttonLabel }],
      assertions: [{ kind: 'called', target: interaction.handlerProp }],
    });
  }

  // Scenario 5: Boolean disabled behavior applies disabled state
  for (const el of component.elements) {
    if (el.tag === 'button' && el.disabledProp) {
      const disabledProps = buildDefaultProps(component.props, {
        omitOptional: true,
        overrides: { [el.disabledProp]: 'true' },
      });
      scenarios.push({
        title: `disables the button when ${el.disabledProp}`,
        props: disabledProps,
        arrangement: [],
        actions: [],
        assertions: [{ kind: 'disabled', target: el.textContent ?? 'button' }],
      });
    }
  }

  const componentImport =
    component.exportKind === 'default'
      ? { from: componentImportPath, defaultImport: component.name }
      : { from: componentImportPath, named: [component.name] };

  return {
    testFileModel: {
      componentName: component.name,
      componentImportPath,
      testType: 'unit',
      imports: [
        { from: 'vitest', named: ['describe', 'it', 'expect', 'vi'] },
        { from: '@testing-library/react', named: ['render', 'screen'] },
        { from: '@testing-library/user-event', defaultImport: 'userEvent' },
        componentImport,
      ],
      setup: [],
      scenarios,
      diagnostics: component.diagnostics,
    },
    diagnostics: component.diagnostics,
  };
}

function buildDefaultProps(
  props: PropModel[],
  options: { omitOptional: boolean; overrides?: Record<string, string> }
): GeneratedPropValue[] {
  const result: GeneratedPropValue[] = [];

  for (const prop of props) {
    const override = options.overrides?.[prop.name];
    if (override !== undefined) {
      result.push({
        name: prop.name,
        expression: override,
        isMockFn: override === 'vi.fn()',
      });
      continue;
    }

    if (!prop.required && options.omitOptional) {
      continue;
    }

    result.push({
      name: prop.name,
      expression: defaultExpressionForProp(prop),
      isMockFn: prop.kind === 'function',
    });
  }

  return result;
}

function defaultExpressionForProp(prop: PropModel): string {
  if (prop.kind === 'function') return 'vi.fn()';
  if (prop.type === 'number') return '1';
  if (prop.type === 'boolean') return 'true';
  return JSON.stringify(defaultTextForProp(prop.name));
}