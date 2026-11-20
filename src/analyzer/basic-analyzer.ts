import ts from 'typescript';
import {
  type ComponentModel,
  type ConditionModel,
  type DependencyModel,
  type ElementModel,
  type ExportKind,
  type InteractionModel,
  type PropKind,
  type PropModel,
} from '../model/component-model.js';
import { createDiagnostic, type Diagnostic } from '../model/diagnostic.js';

const SUPPORTED_BASIC_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'button']);

export function analyzeBasicComponent(sourceFile: ts.SourceFile): ComponentModel {
  const diagnostics: Diagnostic[] = [];
  const dependencies: DependencyModel[] = [];
  const typeMap = collectLocalTypeDeclarations(sourceFile);

  // 1. Inspect imports for unsupported external dependencies in Basic mode
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const mod = stmt.moduleSpecifier.text;
      const isTypeOnly = Boolean(stmt.importClause?.isTypeOnly);
      const isReact = mod === 'react' || mod === 'react/jsx-runtime';
      const specifiers: string[] = [];

      if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const el of stmt.importClause.namedBindings.elements) {
          specifiers.push(el.name.text);
        }
      }

      const supportedInBasic = isTypeOnly || isReact;
      dependencies.push({ source: mod, specifiers, supportedInBasic });

      if (!supportedInBasic) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'UNSUPPORTED_DEPENDENCY_BASIC',
            `Component imports external module "${mod}" which is unsupported in Basic mode. Try --mode intermediate or --mode advanced.`
          )
        );
      }
    }
  }

  // 2. Locate exported React functional component
  const found = findExportedComponent(sourceFile);
  if (!found) {
    diagnostics.push(
      createDiagnostic(
        'error',
        'MISSING_COMPONENT_EXPORT',
        'No exported React functional component was detected in the file.'
      )
    );
    return {
      name: 'UnknownComponent',
      sourcePath: sourceFile.fileName,
      exportKind: 'named',
      props: [],
      elements: [],
      interactions: [],
      conditions: [],
      state: [],
      effects: [],
      dependencies,
      providers: [],
      asyncFlows: [],
      diagnostics,
    };
  }

  const { name, exportKind, params, body } = found;

  // 3. Analyze props
  const props = extractProps(params, typeMap, sourceFile, diagnostics);

  // 4. Scan body for hooks/state/effects unsupported in Basic mode
  const state: string[] = [];
  const effects: string[] = [];
  scanForUnsupportedHooks(body, state, effects, diagnostics);

  // 5. Analyze JSX elements, interactions, and simple && conditional blocks
  const elements: ElementModel[] = [];
  const interactions: InteractionModel[] = [];
  const conditions: ConditionModel[] = [];
  analyzeJsxBody(body, sourceFile, elements, interactions, conditions, diagnostics);

  return {
    name,
    sourcePath: sourceFile.fileName,
    exportKind,
    props,
    elements,
    interactions,
    conditions,
    state,
    effects,
    dependencies,
    providers: [],
    asyncFlows: [],
    diagnostics,
  };
}

interface FoundComponent {
  name: string;
  exportKind: ExportKind;
  params: readonly ts.ParameterDeclaration[];
  body: ts.Node;
}

function findExportedComponent(sourceFile: ts.SourceFile): FoundComponent | undefined {
  let defaultExportIdentifier: string | undefined;
  const localFunctions = new Map<string, { params: readonly ts.ParameterDeclaration[]; body: ts.Node }>();

  for (const stmt of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const hasDefault = modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      localFunctions.set(stmt.name.text, { params: stmt.parameters, body: stmt.body });
      if (hasExport && /^[A-Z]/.test(stmt.name.text)) {
        return {
          name: stmt.name.text,
          exportKind: hasDefault ? 'default' : 'named',
          params: stmt.parameters,
          body: stmt.body,
        };
      }
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          localFunctions.set(decl.name.text, {
            params: decl.initializer.parameters,
            body: decl.initializer.body,
          });
          if (hasExport && /^[A-Z]/.test(decl.name.text)) {
            return {
              name: decl.name.text,
              exportKind: 'named',
              params: decl.initializer.parameters,
              body: decl.initializer.body,
            };
          }
        }
      }
    }

    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
      defaultExportIdentifier = stmt.expression.text;
    }
  }

  if (defaultExportIdentifier && localFunctions.has(defaultExportIdentifier)) {
    const fn = localFunctions.get(defaultExportIdentifier)!;
    return {
      name: defaultExportIdentifier,
      exportKind: 'default',
      params: fn.params,
      body: fn.body,
    };
  }

  return undefined;
}

function collectLocalTypeDeclarations(sourceFile: ts.SourceFile): Map<string, ts.TypeElement[]> {
  const map = new Map<string, ts.TypeElement[]>();
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      map.set(stmt.name.text, [...stmt.members]);
    } else if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
      map.set(stmt.name.text, [...stmt.type.members]);
    }
  }
  return map;
}

function extractProps(
  params: readonly ts.ParameterDeclaration[],
  typeMap: Map<string, ts.TypeElement[]>,
  sourceFile: ts.SourceFile,
  diagnostics: Diagnostic[]
): PropModel[] {
  if (params.length === 0) return [];
  const firstParam = params[0];
  if (!firstParam?.type) return [];

  let members: readonly ts.TypeElement[] | undefined;
  if (ts.isTypeLiteralNode(firstParam.type)) {
    members = firstParam.type.members;
  } else if (ts.isTypeReferenceNode(firstParam.type) && ts.isIdentifier(firstParam.type.typeName)) {
    members = typeMap.get(firstParam.type.typeName.text);
  }

  if (!members) {
    diagnostics.push(
      createDiagnostic(
        'error',
        'UNSUPPORTED_PROP_TYPE',
        `Unable to statically resolve prop type "${firstParam.type.getText(sourceFile)}" in Basic mode.`
      )
    );
    return [];
  }

  const props: PropModel[] = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;
    const name = member.name.getText(sourceFile);
    const required = !member.questionToken;
    const rawType = member.type.getText(sourceFile);
    const kind = classifyPropType(member.type);

    if (kind === 'unsupported' || kind === 'object' || kind === 'array' || kind === 'union') {
      diagnostics.push(
        createDiagnostic(
          'error',
          'UNSUPPORTED_PROP_KIND_BASIC',
          `Prop "${name}: ${rawType}" is not supported in Basic mode. Try --mode intermediate.`
        )
      );
    }

    props.push({ name, type: rawType, required, kind });
  }

  return props;
}

function classifyPropType(typeNode: ts.TypeNode): PropKind {
  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
      return 'primitive';
    case ts.SyntaxKind.FunctionType:
      return 'function';
    case ts.SyntaxKind.ArrayType:
      return 'array';
    case ts.SyntaxKind.TypeLiteral:
      return 'object';
    case ts.SyntaxKind.UnionType:
      return 'union';
    default:
      return 'unsupported';
  }
}

function scanForUnsupportedHooks(
  node: ts.Node,
  state: string[],
  effects: string[],
  diagnostics: Diagnostic[]
): void {
  function visit(current: ts.Node) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const callee = current.expression.text;
      if (callee === 'useState' || callee === 'useReducer') {
        state.push(callee);
        diagnostics.push(
          createDiagnostic(
            'error',
            'UNSUPPORTED_STATE_BASIC',
            `Hook "${callee}" requires state analysis, which is unsupported in Basic mode. Try --mode intermediate.`
          )
        );
      } else if (callee === 'useEffect' || callee === 'useLayoutEffect') {
        effects.push(callee);
        diagnostics.push(
          createDiagnostic(
            'error',
            'UNSUPPORTED_EFFECT_BASIC',
            `Hook "${callee}" is unsupported in Basic mode. Try --mode intermediate or --mode advanced.`
          )
        );
      } else if (/^use[A-Z]/.test(callee)) {
        diagnostics.push(
          createDiagnostic(
            'error',
            'UNSUPPORTED_CUSTOM_HOOK_BASIC',
            `Custom hook "${callee}" is unsupported in Basic mode. Try --mode intermediate or --mode advanced.`
          )
        );
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
}

function analyzeJsxBody(
  body: ts.Node,
  sourceFile: ts.SourceFile,
  elements: ElementModel[],
  interactions: InteractionModel[],
  conditions: ConditionModel[],
  diagnostics: Diagnostic[]
): void {
  function visit(node: ts.Node) {
    // Detect simple {condition && <Element>...</Element>} expressions
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const left = node.expression.left;
      const right = node.expression.right;
      if (ts.isIdentifier(left) && (ts.isJsxElement(right) || ts.isJsxSelfClosingElement(right))) {
        const tag = getJsxTagName(right);
        const childInfo = extractJsxChildrenInfo(right, sourceFile);
        conditions.push({
          kind: 'logical-and',
          conditionProp: left.text,
          renderedTag: tag,
          renderedText: childInfo.staticText,
          boundProp: childInfo.boundProp,
        });
        return; // Handled as conditional element
      }
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = getJsxTagName(node);
      if (/^[a-z]/.test(tag) && !SUPPORTED_BASIC_TAGS.has(tag)) {
        diagnostics.push(
          createDiagnostic(
            'warning',
            'UNSUPPORTED_ELEMENT_BASIC',
            `Element <${tag}> is outside Basic mode's core element set (headings, paragraphs, buttons).`
          )
        );
      }

      const attrs = getJsxAttributes(node);
      const childInfo = extractJsxChildrenInfo(node, sourceFile);
      const role = tag.startsWith('h') ? 'heading' : tag === 'button' ? 'button' : tag === 'p' ? 'paragraph' : undefined;

      let disabledProp: string | undefined;
      let hasDisabledAttr = false;

      for (const attr of attrs) {
        if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
        const attrName = attr.name.text;

        if (attrName === 'disabled') {
          hasDisabledAttr = true;
          if (attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression && ts.isIdentifier(attr.initializer.expression)) {
            disabledProp = attr.initializer.expression.text;
          }
        }

        if (attrName === 'onClick' && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          if (ts.isIdentifier(attr.initializer.expression)) {
            interactions.push({
              event: 'onClick',
              elementTag: tag,
              elementText: childInfo.staticText,
              handlerProp: attr.initializer.expression.text,
            });
          }
        }
      }

      elements.push({
        tag,
        role,
        textContent: childInfo.staticText,
        boundProp: childInfo.boundProp,
        hasDisabledAttr,
        disabledProp,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(body);
}

function getJsxTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return ts.isJsxElement(node) ? node.openingElement.tagName.getText() : node.tagName.getText();
}

function getJsxAttributes(node: ts.JsxElement | ts.JsxSelfClosingElement): readonly ts.JsxAttributeLike[] {
  return ts.isJsxElement(node) ? node.openingElement.attributes.properties : node.attributes.properties;
}

function extractJsxChildrenInfo(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile
): { staticText?: string; boundProp?: string } {
  if (ts.isJsxSelfClosingElement(node)) return {};
  const texts: string[] = [];
  let boundProp: string | undefined;

  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      const trimmed = child.getText(sourceFile).trim();
      if (trimmed) texts.push(trimmed);
    } else if (ts.isJsxExpression(child) && child.expression && ts.isIdentifier(child.expression)) {
      boundProp = child.expression.text;
    }
  }

  return {
    staticText: texts.length > 0 ? texts.join(' ') : undefined,
    boundProp,
  };
}