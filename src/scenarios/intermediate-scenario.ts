import type {
  AsyncFlowModel,
  ComponentModel,
  ConditionModel,
  PropModel,
  PropShapeField,
} from '../model/component-model.js';
import type { Diagnostic } from '../model/diagnostic.js';
import type {
  AssertionModel,
  GeneratedPropValue,
  ImportModel,
  MockBehaviorOverride,
  ModuleMockModel,
  SetupModel,
  TestFileModel,
  TestScenarioModel,
  UserActionModel,
} from '../model/test-model.js';

export interface IntermediateScenarioPlanResult {
  testFileModel: TestFileModel | null;
  diagnostics: Diagnostic[];
}

export function planIntermediateScenarios(
  component: ComponentModel,
  componentImportPath: string
): IntermediateScenarioPlanResult {
  const diagnostics: Diagnostic[] = [...component.diagnostics];

  // Safe Rejection: abort if analyzer emitted any blocking errors
  if (diagnostics.some((d) => d.severity === 'error')) {
    return {
      testFileModel: null,
      diagnostics,
    };
  }

  const moduleMocks = buildModuleMocks(component);
  const imports = buildFileImports(component, componentImportPath, moduleMocks);
  const setup: SetupModel[] =
    moduleMocks.length > 0 ? [{ statement: 'vi.clearAllMocks();' }] : [];

  const scenarios: TestScenarioModel[] = [];

  // 1. render-value: required displayed props (primitives, unions, object fields)
  addDisplayedPropScenarios(component, scenarios);

  // 2. conditional-and & ternary-branch: && and ? : branches
  addConditionalScenarios(component, scenarios);

  // 3. list-map: .map() array rendering
  addListRenderScenarios(component, scenarios);

  // 4. form-interaction: typing into controls & submitting forms
  addFormInteractionScenarios(component, scenarios);

  // 5. button click callbacks & boolean disabled props
  addButtonScenarios(component, scenarios);

  // 6. state-transition: local useState toggling button disabled state
  addStateTransitionScenarios(component, scenarios);

  // 7. mocked-dependency & async-states: loading, success, and error flows
  addAsyncFlowScenarios(component, moduleMocks, scenarios);

  // Baseline smoke scenario if no specific observable assertions were generated
  if (scenarios.length === 0) {
    const base = buildRequiredPropsAndArrangement(component.props);
    scenarios.push({
      title: `renders ${component.name}`,
      props: base.props,
      arrangement: base.arrangement,
      actions: [],
      assertions: [],
    });
  }

  return {
    testFileModel: {
      componentName: component.name,
      componentImportPath,
      testType: 'unit',
      imports,
      setup,
      scenarios,
      diagnostics,
      moduleMocks,
    },
    diagnostics,
  };
}

function buildFileImports(
  component: ComponentModel,
  componentImportPath: string,
  moduleMocks: ModuleMockModel[]
): ImportModel[] {
  const imports: ImportModel[] = [
    component.exportKind === 'default'
      ? { from: componentImportPath, defaultImport: component.name }
      : { from: componentImportPath, named: [component.name] },
  ];

  for (const mock of moduleMocks) {
    const names = mock.namedExports.map((e) => e.name);
    if (names.length > 0) {
      imports.push({ from: mock.modulePath, named: names });
    }
  }

  return imports;
}

function buildModuleMocks(component: ComponentModel): ModuleMockModel[] {
  const asyncDeps = new Set(
    component.asyncFlows
      .map((flow) => flow.sourceDependency)
      .filter((dep): dep is string => Boolean(dep))
  );

  return component.dependencies
    .filter((dep) => dep.specifiers.length > 0)
    .map((dep) => ({
      modulePath: dep.source,
      namedExports: dep.specifiers.map((specifier) => ({
        name: specifier,
        kind: asyncDeps.has(specifier)
          ? 'async-fn'
          : /^use[A-Z]/.test(specifier)
            ? 'hook'
            : 'fn',
      })),
    }));
}

function addDisplayedPropScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  const propByName = new Map(component.props.map((p) => [p.name, p]));
  const seenTargets = new Set<string>();

  for (const el of component.elements) {
    if (!el.boundProp) continue;

    // Direct prop binding (e.g. boundProp === 'title')
    if (propByName.has(el.boundProp)) {
      const prop = propByName.get(el.boundProp)!;
      if (!prop.required || prop.kind === 'function' || prop.type === 'boolean') continue;

      const expectedText = getExpectedDisplayTextForProp(prop, 1);
      if (!expectedText || seenTargets.has(el.boundProp)) continue;
      seenTargets.add(el.boundProp);

      const base = buildRequiredPropsAndArrangement(component.props);
      scenarios.push({
        title: `renders ${prop.name}`,
        props: base.props,
        arrangement: base.arrangement,
        actions: [],
        assertions: [{ kind: 'visible-text', target: expectedText }],
      });
      continue;
    }

    // Object property binding (e.g. boundProp === 'user.name')
    const [rootPropName, fieldName] = el.boundProp.split('.');
    if (rootPropName && fieldName && propByName.has(rootPropName)) {
      const rootProp = propByName.get(rootPropName)!;
      if (!rootProp.required || rootProp.kind !== 'object') continue;
      if (seenTargets.has(el.boundProp)) continue;
      seenTargets.add(el.boundProp);

      const field = rootProp.fields?.find((f) => f.name === fieldName);
      const expectedText = field
        ? getExpectedFieldDisplayText(field, 1)
        : `Test ${fieldName}`;

      const base = buildRequiredPropsAndArrangement(component.props);
      scenarios.push({
        title: `renders ${el.boundProp}`,
        props: base.props,
        arrangement: base.arrangement,
        actions: [],
        assertions: [{ kind: 'visible-text', target: expectedText }],
      });
    }
  }
}

function addConditionalScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  const propByName = new Map(component.props.map((p) => [p.name, p]));

  for (const cond of component.conditions) {
    const condProp = propByName.get(cond.conditionProp);
    if (!condProp) continue;

    if (cond.kind === 'logical-and') {
      const targetProp = cond.boundProp ? propByName.get(cond.boundProp) : condProp;
      const expectedText =
        cond.renderedText ??
        (targetProp ? getExpectedDisplayTextForProp(targetProp, 1) : `Test ${cond.conditionProp}`);

      if (!expectedText) continue;

      // Shown branch
      const shownOverrides: Record<string, GeneratedPropValue> = {
        [cond.conditionProp]: buildDefaultPropValue(condProp, 1),
      };
      if (cond.boundProp && targetProp && cond.boundProp !== cond.conditionProp) {
        shownOverrides[cond.boundProp] = buildDefaultPropValue(targetProp, 1);
      }
      const shownBase = buildRequiredPropsAndArrangement(component.props, shownOverrides);

      scenarios.push({
        title: `renders ${cond.conditionProp} when provided`,
        props: shownBase.props,
        arrangement: shownBase.arrangement,
        actions: [],
        assertions: [{ kind: 'visible-text', target: expectedText }],
      });

      // Hidden branch
      const hiddenBase = buildRequiredPropsAndArrangement(
        component.props,
        condProp.required
          ? { [cond.conditionProp]: { name: cond.conditionProp, expression: 'false' } }
          : {},
        condProp.required ? undefined : new Set([cond.conditionProp])
      );

      scenarios.push({
        title: `hides ${cond.conditionProp} when absent`,
        props: hiddenBase.props,
        arrangement: hiddenBase.arrangement,
        actions: [],
        assertions: [{ kind: 'absent-text', target: expectedText }],
      });
    } else if (cond.kind === 'ternary') {
      addTernaryScenarios(component, cond, condProp, scenarios);
    }
  }
}

function addTernaryScenarios(
  component: ComponentModel,
  cond: ConditionModel,
  condProp: PropModel,
  scenarios: TestScenarioModel[]
): void {
  const trueText = cond.renderedText;
  const falseText = cond.falseRenderedText;
  if (!trueText && !falseText) return;

  // Truthy branch
  const truthyExpr =
    condProp.type === 'boolean' ? 'true' : buildDefaultPropValue(condProp, 1).expression;
  const truthyBase = buildRequiredPropsAndArrangement(component.props, {
    [cond.conditionProp]: { name: cond.conditionProp, expression: truthyExpr },
  });

  const truthyAssertions: AssertionModel[] = [];
  if (trueText) truthyAssertions.push({ kind: 'visible-text', target: trueText });
  if (falseText) truthyAssertions.push({ kind: 'absent-text', target: falseText });

  scenarios.push({
    title: `renders truthy branch when ${cond.conditionProp} is true`,
    props: truthyBase.props,
    arrangement: truthyBase.arrangement,
    actions: [],
    assertions: truthyAssertions,
  });

  // Falsy branch
  const falsyExpr = condProp.type === 'boolean' ? 'false' : '""';
  const falsyBase = buildRequiredPropsAndArrangement(component.props, {
    [cond.conditionProp]: { name: cond.conditionProp, expression: falsyExpr },
  });

  const falsyAssertions: AssertionModel[] = [];
  if (falseText) falsyAssertions.push({ kind: 'visible-text', target: falseText });
  if (trueText) falsyAssertions.push({ kind: 'absent-text', target: trueText });

  scenarios.push({
    title: `renders falsy branch when ${cond.conditionProp} is false`,
    props: falsyBase.props,
    arrangement: falsyBase.arrangement,
    actions: [],
    assertions: falsyAssertions,
  });
}

function addListRenderScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  const propByName = new Map(component.props.map((p) => [p.name, p]));

  for (const list of component.lists) {
    if (list.sourceKind !== 'prop') continue;
    const arrayProp = propByName.get(list.sourceName);
    if (!arrayProp || arrayProp.kind !== 'array') continue;

    const assertions: AssertionModel[] = [];
    const displayFieldName = list.itemFields.find((f) => f !== 'id') ?? list.itemFields[0];

    if (displayFieldName && arrayProp.fields) {
      const field = arrayProp.fields.find((f) => f.name === displayFieldName);
      if (field) {
        assertions.push(
          { kind: 'visible-text', target: getExpectedFieldDisplayText(field, 1) },
          { kind: 'visible-text', target: getExpectedFieldDisplayText(field, 2) }
        );
      }
    } else if (!displayFieldName) {
      assertions.push(
        { kind: 'visible-text', target: `Test ${list.sourceName} 1` },
        { kind: 'visible-text', target: `Test ${list.sourceName} 2` }
      );
    }

    if (assertions.length === 0) continue;

    const base = buildRequiredPropsAndArrangement(component.props, {
      [arrayProp.name]: buildDefaultPropValue(arrayProp, 1),
    });

    scenarios.push({
      title: `renders items from ${list.sourceName}`,
      props: base.props,
      arrangement: base.arrangement,
      actions: [],
      assertions,
    });
  }
}

function addFormInteractionScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  const formControls = component.elements.filter(
    (el) => el.role === 'textbox' || el.role === 'combobox' || el.role === 'checkbox'
  );
  const submitInteraction = component.interactions.find(
    (i) => i.event === 'onSubmit' && i.handlerProp
  );

  if (!submitInteraction?.handlerProp) return;

  const actions: UserActionModel[] = [];
  for (const control of formControls) {
    const queryTarget = control.labelText ?? control.placeholder;
    if (!queryTarget) continue;
    const queryBy = control.labelText ? 'label' : 'placeholder';

    if (control.role === 'textbox') {
      const sampleValue =
        control.inputType === 'email'
          ? 'user@example.com'
          : control.inputType === 'password'
            ? 'Secret123!'
            : `Test ${queryTarget}`;
      actions.push({
        kind: 'type',
        targetQuery: queryTarget,
        queryBy,
        value: sampleValue,
      });
    } else if (control.role === 'checkbox') {
      actions.push({
        kind: 'click',
        targetQuery: queryTarget,
        queryBy,
      });
    }
  }

  const submitButton = component.elements.find((el) => el.role === 'button');
  if (submitButton) {
    const buttonName = submitButton.textContent ?? submitButton.labelText ?? 'Submit';
    actions.push({
      kind: 'click',
      targetQuery: buttonName,
      queryBy: 'role',
    });
  }

  if (actions.length === 0) return;

  const overrides: Record<string, GeneratedPropValue> = {};
  if (submitButton?.disabledProp) {
    overrides[submitButton.disabledProp] = {
      name: submitButton.disabledProp,
      expression: 'false',
    };
  }
  const base = buildRequiredPropsAndArrangement(component.props, overrides);

  scenarios.push({
    title: `submits form and calls ${submitInteraction.handlerProp}`,
    props: base.props,
    arrangement: base.arrangement,
    actions,
    assertions: [{ kind: 'called', target: submitInteraction.handlerProp }],
  });
}

function addButtonScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  const buttons = component.elements.filter((el) => el.role === 'button');
  const clickInteractions = component.interactions.filter(
    (i) => i.event === 'onClick' && i.handlerProp
  );

  for (const interaction of clickInteractions) {
    const matchingButton =
      buttons.find((b) => b.textContent === interaction.elementText) ?? buttons[0];
    const buttonName =
      interaction.elementText ?? matchingButton?.textContent ?? matchingButton?.labelText;
    if (!buttonName || !interaction.handlerProp) continue;

    const overrides: Record<string, GeneratedPropValue> = {};
    if (matchingButton?.disabledProp) {
      overrides[matchingButton.disabledProp] = {
        name: matchingButton.disabledProp,
        expression: 'false',
      };
    }
    const base = buildRequiredPropsAndArrangement(component.props, overrides);

    scenarios.push({
      title: `calls ${interaction.handlerProp} when clicked`,
      props: base.props,
      arrangement: base.arrangement,
      actions: [{ kind: 'click', targetQuery: buttonName, queryBy: 'role' }],
      assertions: [{ kind: 'called', target: interaction.handlerProp }],
    });
  }

  for (const button of buttons) {
    if (!button.disabledProp) continue;
    const buttonName = button.textContent ?? button.labelText;
    if (!buttonName) continue;

    const base = buildRequiredPropsAndArrangement(component.props, {
      [button.disabledProp]: { name: button.disabledProp, expression: 'true' },
    });

    scenarios.push({
      title: `disables button when ${button.disabledProp} is true`,
      props: base.props,
      arrangement: base.arrangement,
      actions: [],
      assertions: [{ kind: 'disabled', target: buttonName }],
    });
  }
}

function addStateTransitionScenarios(
  component: ComponentModel,
  scenarios: TestScenarioModel[]
): void {
  if (component.state.length === 0) return;

  const statefulDisabledButton = component.elements.find(
    (el) => el.role === 'button' && el.disabledState
  );
  if (!statefulDisabledButton) return;

  const targetName =
    statefulDisabledButton.textContent ?? statefulDisabledButton.labelText;

  // 1. Prefer a button that explicitly has an onClick interaction
  const clickInteraction = component.interactions.find(
    (i) =>
      i.event === 'onClick' &&
      i.elementText &&
      i.elementText !== targetName
  );

  // 2. Fallback to a non-submit button element
  const fallbackButton = component.elements.find(
    (el) =>
      el.role === 'button' &&
      el !== statefulDisabledButton &&
      !el.disabledState &&
      el.inputType !== 'submit' &&
      (el.textContent || el.labelText)
  );

  const triggerName =
    clickInteraction?.elementText ??
    fallbackButton?.textContent ??
    fallbackButton?.labelText;

  const stateItem = component.state.find(
    (s) => s.name === statefulDisabledButton.disabledState
  );

  if (targetName && triggerName && stateItem?.inferredType === 'boolean') {
    const startsDisabled = stateItem.initialValueExpression === 'true';
    const base = buildRequiredPropsAndArrangement(component.props);

    scenarios.push({
      title: `toggles ${targetName} state when ${triggerName} is clicked`,
      props: base.props,
      arrangement: base.arrangement,
      actions: [{ kind: 'click', targetQuery: triggerName, queryBy: 'role' }],
      assertions: [
        {
          kind: startsDisabled ? 'enabled' : 'disabled',
          target: targetName,
        },
      ],
    });
  }
}

function addAsyncFlowScenarios(
  component: ComponentModel,
  moduleMocks: ModuleMockModel[],
  scenarios: TestScenarioModel[]
): void {
  const flow = component.asyncFlows[0];
  if (!flow || moduleMocks.length === 0) return;

  const depName = flow.sourceDependency;
  if (!depName) return;

  const triggerActions = buildAsyncTriggerActions(component, flow);
  const base = buildRequiredPropsAndArrangement(component.props);

  // 1. Loading state
  if (flow.loadingText) {
    const loadingOverride: MockBehaviorOverride = {
      exportName: depName,
      behavior: 'pending',
    };
    scenarios.push({
      title: `shows loading state while ${depName} is pending`,
      props: base.props,
      arrangement: base.arrangement,
      mockOverrides: [loadingOverride],
      actions: triggerActions,
      assertions: [{ kind: 'visible-text', target: flow.loadingText }],
    });
  }

  // 2. Success state
  const successOverride: MockBehaviorOverride = {
    exportName: depName,
    behavior: 'resolve',
    valueExpression: 'undefined',
  };
  const successAssertions: AssertionModel[] = [{ kind: 'called', target: depName }];
  if (flow.successPropOrState) {
    successAssertions.push({
      kind: 'async-visible-text',
      target: flow.successPropOrState,
    });
  }

  scenarios.push({
    title: `calls ${depName} and completes async flow`,
    props: base.props,
    arrangement: base.arrangement,
    mockOverrides: [successOverride],
    actions: triggerActions,
    assertions: successAssertions,
  });

  // 3. Error state
  if (flow.errorText) {
    const errorOverride: MockBehaviorOverride = {
      exportName: depName,
      behavior: 'reject',
      valueExpression: 'new Error("Request failed")',
    };
    scenarios.push({
      title: `shows error message when ${depName} fails`,
      props: base.props,
      arrangement: base.arrangement,
      mockOverrides: [errorOverride],
      actions: triggerActions,
      assertions: [{ kind: 'async-visible-text', target: flow.errorText }],
    });
  }
}

function buildAsyncTriggerActions(
  component: ComponentModel,
  flow: AsyncFlowModel
): UserActionModel[] {
  if (flow.trigger === 'mount') {
    return [];
  }

  const actions: UserActionModel[] = [];
  if (flow.trigger === 'submit') {
    for (const control of component.elements) {
      if (control.role !== 'textbox') continue;
      const queryTarget = control.labelText ?? control.placeholder;
      if (!queryTarget) continue;
      actions.push({
        kind: 'type',
        targetQuery: queryTarget,
        queryBy: control.labelText ? 'label' : 'placeholder',
        value: control.inputType === 'email' ? 'user@example.com' : `Test ${queryTarget}`,
      });
    }
  }

  const button = component.elements.find((el) => el.role === 'button');
  if (button) {
    const buttonName = button.textContent ?? button.labelText ?? 'Submit';
    actions.push({
      kind: 'click',
      targetQuery: buttonName,
      queryBy: 'role',
    });
  }

  return actions;
}

function buildRequiredPropsAndArrangement(
  allProps: PropModel[],
  overrides: Record<string, GeneratedPropValue> = {},
  omitNames?: Set<string>
): { props: GeneratedPropValue[]; arrangement: SetupModel[] } {
  const generatedProps: GeneratedPropValue[] = [];
  const arrangement: SetupModel[] = [];
  const seen = new Set<string>();

  for (const prop of allProps) {
    if (omitNames?.has(prop.name)) continue;

    const overrideVal = overrides[prop.name];
    if (overrideVal) {
      generatedProps.push(overrideVal);
      seen.add(prop.name);
      if (overrideVal.isMockFn) {
        arrangement.push({ statement: `const ${overrideVal.expression} = vi.fn();` });
      }
      continue;
    }

    if (prop.required) {
      const val = buildDefaultPropValue(prop, 1);
      generatedProps.push(val);
      seen.add(prop.name);
      if (val.isMockFn) {
        arrangement.push({ statement: `const ${val.expression} = vi.fn();` });
      }
    }
  }

  for (const [name, val] of Object.entries(overrides)) {
    if (seen.has(name) || omitNames?.has(name)) continue;
    generatedProps.push(val);
    if (val.isMockFn) {
      arrangement.push({ statement: `const ${val.expression} = vi.fn();` });
    }
  }

  return { props: generatedProps, arrangement };
}

function buildDefaultPropValue(prop: PropModel, index: number): GeneratedPropValue {
  if (prop.kind === 'function') {
    return {
      name: prop.name,
      expression: prop.name,
      isMockFn: true,
    };
  }

  switch (prop.kind) {
    case 'primitive':
      if (prop.type === 'number') {
        return { name: prop.name, expression: String(index) };
      }
      if (prop.type === 'boolean') {
        return { name: prop.name, expression: 'true' };
      }
      return { name: prop.name, expression: JSON.stringify(`Test ${prop.name}`) };

    case 'union':
      return {
        name: prop.name,
        expression:
          prop.unionLiterals && prop.unionLiterals.length > 0
            ? JSON.stringify(prop.unionLiterals[0])
            : JSON.stringify(`Test ${prop.name}`),
      };

    case 'object':
      return {
        name: prop.name,
        expression: buildObjectLiteralExpression(prop.name, prop.fields, index),
      };

    case 'array':
      if (prop.fields && prop.fields.length > 0) {
        const item1 = buildObjectLiteralExpression(prop.name, prop.fields, 1);
        const item2 = buildObjectLiteralExpression(prop.name, prop.fields, 2);
        return { name: prop.name, expression: `[${item1}, ${item2}]` };
      }
      return {
        name: prop.name,
        expression: `[${JSON.stringify(`Test ${prop.name} 1`)}, ${JSON.stringify(`Test ${prop.name} 2`)}]`,
      };

    default:
      return { name: prop.name, expression: JSON.stringify(`Test ${prop.name}`) };
  }
}

function buildObjectLiteralExpression(
  propName: string,
  fields: PropShapeField[] | undefined,
  index: number
): string {
  if (!fields || fields.length === 0) {
    return `{ id: ${JSON.stringify(String(index))}, name: ${JSON.stringify(`Test ${propName} ${index}`)} }`;
  }

  const entries = fields
    .filter((f) => f.required)
    .map((field) => {
      if (field.name === 'id') {
        return `id: ${field.type === 'number' ? index : JSON.stringify(String(index))}`;
      }
      if (field.type === 'number') return `${field.name}: ${index}`;
      if (field.type === 'boolean') return `${field.name}: true`;
      const suffix = index > 1 ? ` ${index}` : '';
      return `${field.name}: ${JSON.stringify(`Test ${field.name}${suffix}`)}`;
    });

  return `{ ${entries.join(', ')} }`;
}

function getExpectedDisplayTextForProp(prop: PropModel, index: number): string | undefined {
  if (prop.kind === 'primitive') {
    if (prop.type === 'number') return String(index);
    if (prop.type === 'string') return `Test ${prop.name}`;
  }
  if (prop.kind === 'union' && prop.unionLiterals?.[0]) {
    return prop.unionLiterals[0];
  }
  return undefined;
}

function getExpectedFieldDisplayText(field: PropShapeField, index: number): string {
  if (field.name === 'id') return String(index);
  if (field.type === 'number') return String(index);
  const suffix = index > 1 ? ` ${index}` : '';
  return `Test ${field.name}${suffix}`;
}