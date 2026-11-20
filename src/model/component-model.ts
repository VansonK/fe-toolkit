import type { Diagnostic } from './diagnostic.js';

export type ExportKind = 'named' | 'default';
export type PropKind = 'primitive' | 'function' | 'object' | 'array' | 'union' | 'unsupported';
export type ModeName = 'basic' | 'intermediate' | 'advanced';
export type TestType = 'unit' | 'integration';

export interface PropShapeField {
  name: string;
  type: string;
  required: boolean;
}

export interface PropModel {
  name: string;
  type: string;
  required: boolean;
  kind: PropKind;
  fields?: PropShapeField[];
  unionLiterals?: string[];
}

export interface ElementModel {
  tag: string;
  role?: 'heading' | 'button' | 'paragraph' | 'textbox' | 'combobox' | 'checkbox' | 'form';
  textContent?: string;
  labelText?: string;
  placeholder?: string;
  inputType?: string;
  boundProp?: string;
  boundState?: string;
  hasDisabledAttr?: boolean;
  disabledProp?: string;
  disabledState?: string;
}

export interface StateModel {
  name: string;
  setterName: string;
  initialValueExpression: string;
  inferredType: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
}

export interface ListRenderModel {
  sourceKind: 'prop' | 'state';
  sourceName: string;
  itemVar: string;
  renderedTag: string;
  itemFields: string[]; // e.g., ['title'] when rendering item.title
}

export interface AsyncFlowModel {
  trigger: 'mount' | 'submit' | 'click';
  sourceDependency?: string; // e.g., 'fetchUsers' or 'useLogin'
  loadingText?: string;
  errorText?: string;
  successPropOrState?: string;
}

export interface InteractionModel {
  event: 'onClick' | 'onChange' | 'onSubmit';
  elementTag: string;
  elementText?: string;
  handlerProp?: string;
}

export interface ConditionModel {
  kind: 'logical-and' | 'ternary';
  conditionProp: string;
  renderedTag: string;
  renderedText?: string;
  boundProp?: string;
}

export interface DependencyModel {
  source: string;
  specifiers: string[];
  supportedInBasic: boolean;
}

export interface ComponentModel {
  name: string;
  sourcePath: string;
  exportKind: ExportKind;
  props: PropModel[];
  elements: ElementModel[];
  interactions: InteractionModel[];
  conditions: ConditionModel[];
  lists: ListRenderModel[];
  state: StateModel[];
  effects: string[];
  dependencies: DependencyModel[];
  providers: string[];
  asyncFlows: AsyncFlowModel[];
  diagnostics: Diagnostic[];
}

export interface ModeProfile {
  name: ModeName;
  analyzers: string[];
  scenarioStrategies: string[];
  allowedTestTypes: TestType[];
  allowProviderPlanning: boolean;
  allowAsyncWorkflows: boolean;
}

export const MODE_PROFILES: Record<ModeName, ModeProfile> = {
  basic: {
    name: 'basic',
    analyzers: ['component', 'primitive-props', 'basic-jsx', 'click-interaction', 'logical-and'],
    scenarioStrategies: ['render-value', 'conditional-and', 'button-click', 'button-disabled'],
    allowedTestTypes: ['unit'],
    allowProviderPlanning: false,
    allowAsyncWorkflows: false,
  },
  intermediate: {
    name: 'intermediate',
    analyzers: [
      'component',
      'primitive-props',
      'selected-complex-props',
      'basic-jsx',
      'forms-and-lists',
      'local-state',
      'selected-mocks',
      'single-async',
    ],
    scenarioStrategies: [
      'render-value',
      'conditional-and',
      'ternary-branch',
      'list-map',
      'form-interaction',
      'state-transition',
      'mocked-dependency',
      'async-states',
    ],
    allowedTestTypes: ['unit'],
    allowProviderPlanning: false,
    allowAsyncWorkflows: true,
  },
  advanced: {
    name: 'advanced',
    analyzers: [
      'component',
      'primitive-props',
      'selected-complex-props',
      'basic-jsx',
      'forms-and-lists',
      'local-state',
      'selected-mocks',
      'multi-async',
      'providers-and-routing',
      'stores-and-queries',
    ],
    scenarioStrategies: [
      'render-value',
      'conditional-and',
      'ternary-branch',
      'list-map',
      'form-interaction',
      'state-transition',
      'mocked-dependency',
      'async-states',
      'provider-integration',
      'retry-and-empty',
    ],
    allowedTestTypes: ['unit', 'integration'],
    allowProviderPlanning: true,
    allowAsyncWorkflows: true,
  },
};