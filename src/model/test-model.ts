import type { TestType } from './component-model.js';
import type { Diagnostic } from './diagnostic.js';

export interface ImportModel {
  from: string;
  named?: string[];
  defaultImport?: string;
}

export interface SetupModel {
  statement: string;
}

export interface GeneratedPropValue {
  name: string;
  expression: string;
  isMockFn?: boolean;
}

export interface UserActionModel {
  kind: 'click' | 'type' | 'clear' | 'select' | 'submit';
  targetQuery: string;
  queryBy?: 'role' | 'label' | 'placeholder' | 'text';
  value?: string;
}

export interface AssertionModel {
  kind:
    | 'visible-text'
    | 'absent-text'
    | 'async-visible-text'
    | 'called'
    | 'called-with'
    | 'disabled'
    | 'enabled'
    | 'item-count';
  target: string;
  expectedArgs?: string[];
  count?: number;
}

export interface TestScenarioModel {
  title: string;
  props: GeneratedPropValue[];
  arrangement: SetupModel[];
  actions: UserActionModel[];
  assertions: AssertionModel[];
  mockOverrides?: MockBehaviorOverride[];
}

export interface TestFileModel {
  componentName: string;
  componentImportPath: string;
  testType: TestType;
  imports: ImportModel[];
  setup: SetupModel[];
  scenarios: TestScenarioModel[];
  diagnostics: Diagnostic[];
  moduleMocks: ModuleMockModel[];
}

export interface ModuleMockModel {
  modulePath: string;
  namedExports: Array<{
    name: string;
    kind: 'fn' | 'async-fn' | 'hook';
    defaultReturnExpression?: string;
  }>;
}

export interface MockBehaviorOverride {
  exportName: string;
  behavior: 'pending' | 'resolve' | 'reject';
  valueExpression?: string;
}