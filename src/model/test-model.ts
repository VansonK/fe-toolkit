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
  kind: 'click';
  targetQuery: string;
}

export interface AssertionModel {
  kind: 'visible-text' | 'absent-text' | 'called' | 'disabled' | 'enabled';
  target: string;
}

export interface TestScenarioModel {
  title: string;
  props: GeneratedPropValue[];
  arrangement: SetupModel[];
  actions: UserActionModel[];
  assertions: AssertionModel[];
}

export interface TestFileModel {
  componentName: string;
  componentImportPath: string;
  testType: TestType;
  imports: ImportModel[];
  setup: SetupModel[];
  scenarios: TestScenarioModel[];
  diagnostics: Diagnostic[];
}