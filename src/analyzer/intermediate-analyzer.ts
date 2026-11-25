import * as ts from 'typescript';
import type {
  AsyncFlowModel,
  ComponentModel,
  ConditionModel,
  DependencyModel,
  ElementModel,
  ExportKind,
  InteractionModel,
  ListRenderModel,
  PropKind,
  PropModel,
  PropShapeField,
  StateModel,
} from '../model/component-model.js';
import type { Diagnostic } from '../model/diagnostic.js';

const ADVANCED_ONLY_PACKAGES = new Set([
  'react-router',
  'react-router-dom',
  '@tanstack/react-query',
  'react-query',
  'swr',
  'zustand',
  'redux',
  '@reduxjs/toolkit',
  'react-redux',
  'jotai',
  'recoil',
  'mobx',
  'mobx-react',
  'mobx-react-lite',
  'react-i18next',
]);

const QUERY_OR_STORE_MODULE_PATTERN =
  /(?:^|\/)[^/]+\.(?:queries|mutations|store|stores|context|contexts)(?:\.[jt]sx?)?$/i;

const QUERY_OR_STORE_HOOK_PATTERN =
  /^use[A-Z]\w*(?:Query|Mutation|InfiniteQuery|SuspenseQuery|Context|Store|Selector|Dispatch)$/;

const LAYOUT_TAGS = new Set([
  'div',
  'span',
  'section',
  'main',
  'header',
  'footer',
  'article',
  'aside',
  'nav',
  'ul',
  'ol',
  'li',
  'label',
  'form',
  'fieldset',
  'legend',
]);

export function analyzeIntermediateComponent(sourceFile: ts.SourceFile): ComponentModel {
  const diagnostics: Diagnostic[] = [];
  const sourcePath = sourceFile.fileName;

  const localTypes = collectLocalTypeShapes(sourceFile);
  const { dependencies, providers } = analyzeImports(sourceFile, diagnostics);
  const componentInfo = findExportedComponent(sourceFile);

  if (!componentInfo) {
    diagnostics.push({
      code: 'NO_EXPORTED_COMPONENT',
      severity: 'error',
      message: 'No exported React functional component found in file.',
    });
    return {
      name: 'UnknownComponent',
      sourcePath,
      exportKind: 'named',
      props: [],
      elements: [],
      interactions: [],
      conditions: [],
      lists: [],
      state: [],
      effects: [],
      dependencies,
      providers,
      asyncFlows: [],
      diagnostics,
    };
  }

  const props = extractProps(componentInfo.node, localTypes, diagnostics);
  const { state, effects, asyncFlows } = analyzeHooksAndAsync(
    componentInfo.node,
    dependencies,
    providers,
    diagnostics
  );

  const { elements, interactions, conditions, lists } = analyzeJsxTree(
    componentInfo.node,
    props,
    state,
    diagnostics
  );

  return {
    name: componentInfo.name,
    sourcePath,
    exportKind: componentInfo.exportKind,
    props,
    elements,
    interactions,
    conditions,
    lists,
    state,
    effects,
    dependencies,
    providers,
    asyncFlows,
    diagnostics,
  };
}

function collectLocalTypeShapes(sourceFile: ts.SourceFile): Map<string, PropShapeField[]> {
  const shapes = new Map<string, PropShapeField[]>();

  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      shapes.set(stmt.name.text, extractMembersToFields(stmt.members));
    } else if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
      shapes.set(stmt.name.text, extractMembersToFields(stmt.type.members));
    }
  }

  return shapes;
}

function extractMembersToFields(members: ts.NodeArray<ts.TypeElement>): PropShapeField[] {
  const fields: PropShapeField[] = [];
  for (const member of members) {
    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
      fields.push({
        name: member.name.text,
        type: member.type ? member.type.getText() : 'string',
        required: !member.questionToken,
      });
    }
  }
  return fields;
}

function analyzeImports(
  sourceFile: ts.SourceFile,
  diagnostics: Diagnostic[]
): { dependencies: DependencyModel[]; providers: string[] } {
  const dependencies: DependencyModel[] = [];
  const providers: string[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    // Skip top-level type-only imports (`import type { User } from '...'`)
    if (stmt.importClause?.isTypeOnly) continue;

    const source = stmt.moduleSpecifier.text;
    const specifiers: string[] = [];

    if (stmt.importClause?.name) {
      specifiers.push(stmt.importClause.name.text);
    }
    if (stmt.importClause?.namedBindings) {
      if (ts.isNamedImports(stmt.importClause.namedBindings)) {
        for (const el of stmt.importClause.namedBindings.elements) {
          // Skip inline type specifiers (`import { useState, type FormEvent } from 'react'`)
          if (el.isTypeOnly) continue;
          specifiers.push(el.name.text);
        }
      } else if (ts.isNamespaceImport(stmt.importClause.namedBindings)) {
        specifiers.push(stmt.importClause.namedBindings.name.text);
      }
    }

    // If all named specifiers were `type`-only, no runtime dependency exists
    if (stmt.importClause && specifiers.length === 0) continue;

    if (source === 'react') {
      if (specifiers.includes('useContext')) {
        providers.push('React.useContext');
        diagnostics.push({
          code: 'UNSUPPORTED_PROVIDER_INTERMEDIATE',
          severity: 'error',
          message:
            'React Context (useContext) is not supported in intermediate mode. Re-run with --mode advanced.',
        });
      }
      continue;
    }

    if (ADVANCED_ONLY_PACKAGES.has(source)) {
      providers.push(source);
      diagnostics.push({
        code: 'UNSUPPORTED_DEPENDENCY_INTERMEDIATE',
        severity: 'error',
        message: `Dependency "${source}" requires provider/store orchestration. Re-run with --mode advanced.`,
      });
      continue;
    }

    // Reject custom TanStack Query / mutation / store / context hooks imported from local modules
    const advancedHooks = specifiers.filter((s) => QUERY_OR_STORE_HOOK_PATTERN.test(s));
    if (QUERY_OR_STORE_MODULE_PATTERN.test(source) || advancedHooks.length > 0) {
      const label = advancedHooks.length > 0 ? advancedHooks.join(', ') : source;
      providers.push(label);
      diagnostics.push({
        code: 'UNSUPPORTED_QUERY_HOOK_INTERMEDIATE',
        severity: 'error',
        message: `Server-state or store hook "${label}" from "${source}" is not supported in intermediate mode. Re-run with --mode advanced.`,
      });
      continue;
    }

    if (source.startsWith('.')) {
      dependencies.push({
        source,
        specifiers,
        supportedInBasic: false,
      });
    }
  }

  return { dependencies, providers };
}

interface ComponentMatch {
  name: string;
  exportKind: ExportKind;
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
}

function findExportedComponent(sourceFile: ts.SourceFile): ComponentMatch | null {
  let defaultExportName: string | null = null;
  const localFunctions = new Map<
    string,
    ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
  >();

  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      defaultExportName = stmt.expression.text;
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const hasExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const hasDefault = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (hasExport) {
        return {
          name: stmt.name.text,
          exportKind: hasDefault ? 'default' : 'named',
          node: stmt,
        };
      }
      localFunctions.set(stmt.name.text, stmt);
    }

    if (ts.isVariableStatement(stmt)) {
      const hasExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          if (hasExport) {
            return {
              name: decl.name.text,
              exportKind: 'named',
              node: decl.initializer,
            };
          }
          localFunctions.set(decl.name.text, decl.initializer);
        }
      }
    }
  }

  if (defaultExportName && localFunctions.has(defaultExportName)) {
    return {
      name: defaultExportName,
      exportKind: 'default',
      node: localFunctions.get(defaultExportName)!,
    };
  }

  return null;
}

function extractProps(
  fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  localTypes: Map<string, PropShapeField[]>,
  diagnostics: Diagnostic[]
): PropModel[] {
  const firstParam = fnNode.parameters[0];
  if (!firstParam || !firstParam.type) return [];

  const members = resolveTypeMembers(firstParam.type, fnNode.getSourceFile(), localTypes);
  const props: PropModel[] = [];

  for (const member of members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
    const name = member.name.text;
    const required = !member.questionToken;
    const typeNode = member.type;
    const typeText = typeNode ? typeNode.getText() : 'unknown';

    const classified = classifyPropType(name, typeNode, localTypes, diagnostics);
    props.push({
      name,
      type: typeText,
      required,
      kind: classified.kind,
      fields: classified.fields,
      unionLiterals: classified.unionLiterals,
    });
  }

  return props;
}

function resolveTypeMembers(
  typeNode: ts.TypeNode,
  sourceFile: ts.SourceFile,
  _localTypes: Map<string, PropShapeField[]>
): ts.NodeArray<ts.TypeElement> | readonly ts.TypeElement[] {
  if (ts.isTypeLiteralNode(typeNode)) {
    return typeNode.members;
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const targetName = typeNode.typeName.text;
    for (const stmt of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === targetName) {
        return stmt.members;
      }
      if (
        ts.isTypeAliasDeclaration(stmt) &&
        stmt.name.text === targetName &&
        ts.isTypeLiteralNode(stmt.type)
      ) {
        return stmt.type.members;
      }
    }
  }
  return [];
}

function classifyPropType(
  propName: string,
  typeNode: ts.TypeNode | undefined,
  localTypes: Map<string, PropShapeField[]>,
  diagnostics: Diagnostic[]
): { kind: PropKind; fields?: PropShapeField[]; unionLiterals?: string[] } {
  if (!typeNode) {
    return { kind: 'primitive' };
  }

  if (
    typeNode.kind === ts.SyntaxKind.StringKeyword ||
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BooleanKeyword
  ) {
    return { kind: 'primitive' };
  }

  if (ts.isFunctionTypeNode(typeNode)) {
    return { kind: 'function' };
  }

  if (ts.isUnionTypeNode(typeNode)) {
    const literals: string[] = [];
    for (const part of typeNode.types) {
      if (ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal)) {
        literals.push(part.literal.text);
      }
    }
    if (literals.length > 0) {
      return { kind: 'union', unionLiterals: literals };
    }
  }

  if (ts.isArrayTypeNode(typeNode)) {
    const elemType = typeNode.elementType;
    if (ts.isTypeLiteralNode(elemType)) {
      return { kind: 'array', fields: extractMembersToFields(elemType.members) };
    }
    if (ts.isTypeReferenceNode(elemType) && ts.isIdentifier(elemType.typeName)) {
      return { kind: 'array', fields: localTypes.get(elemType.typeName.text) };
    }
    return { kind: 'array' };
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return { kind: 'object', fields: extractMembersToFields(typeNode.members) };
  }

  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const refName = typeNode.typeName.text;
    if (refName === 'Array') {
      const inner = typeNode.typeArguments?.[0];
      if (inner && ts.isTypeLiteralNode(inner)) {
        return { kind: 'array', fields: extractMembersToFields(inner.members) };
      }
      if (inner && ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)) {
        return { kind: 'array', fields: localTypes.get(inner.typeName.text) };
      }
      return { kind: 'array' };
    }
    if (localTypes.has(refName)) {
      return { kind: 'object', fields: localTypes.get(refName) };
    }
  }

  diagnostics.push({
    code: 'UNSUPPORTED_PROP_INTERMEDIATE',
    severity: 'error',
    message: `Prop "${propName}" uses an unsupported complex type (${typeNode.getText()}). Simplify the prop contract or use --mode advanced.`,
  });
  return { kind: 'unsupported' };
}

function analyzeHooksAndAsync(
  fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  dependencies: DependencyModel[],
  providers: string[],
  diagnostics: Diagnostic[]
): { state: StateModel[]; effects: string[]; asyncFlows: AsyncFlowModel[] } {
  const state: StateModel[] = [];
  const effects: string[] = [];
  const asyncFlows: AsyncFlowModel[] = [];
  const importedSpecifiers = new Set(dependencies.flatMap((d) => d.specifiers));

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const calleeText = node.expression.getText();
      if (
        calleeText === 'useContext' ||
        calleeText === 'React.useContext' ||
        calleeText === 'createContext' ||
        calleeText === 'React.createContext'
      ) {
        if (!providers.includes('React.useContext')) {
          providers.push('React.useContext');
          diagnostics.push({
            code: 'UNSUPPORTED_PROVIDER_INTERMEDIATE',
            severity: 'error',
            message:
              'React Context (useContext) is not supported in intermediate mode. Re-run with --mode advanced.',
          });
        }
      }

      if (calleeText === 'useEffect' || calleeText === 'React.useEffect') {
        effects.push('useEffect');
        const effectText = node.getText();
        const calledDep = Array.from(importedSpecifiers).find((spec) =>
          new RegExp(`\\b${spec}\\b`).test(effectText)
        );
        if (calledDep) {
          asyncFlows.push({
            trigger: 'mount',
            sourceDependency: calledDep,
          });
        }
      }
    }

    // Detect const [x, setX] = useState(init)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression.getText();
      if (callee === 'useState' || callee === 'React.useState') {
        const [firstEl, secondEl] = node.name.elements;
        if (
          firstEl &&
          ts.isBindingElement(firstEl) &&
          ts.isIdentifier(firstEl.name) &&
          secondEl &&
          ts.isBindingElement(secondEl) &&
          ts.isIdentifier(secondEl.name)
        ) {
          const initArg = node.initializer.arguments[0];
          const initExpr = initArg ? initArg.getText() : 'undefined';
          state.push({
            name: firstEl.name.text,
            setterName: secondEl.name.text,
            initialValueExpression: initExpr,
            inferredType: inferStateType(initArg),
          });
        }
      }
    }

    // Detect async handlers calling imported dependencies
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)) &&
      node !== fnNode &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      const bodyText = node.getText();
      const calledDep = Array.from(importedSpecifiers).find((spec) =>
        new RegExp(`\\b${spec}\\b`).test(bodyText)
      );
      if (calledDep) {
        const isSubmit =
          ts.isFunctionDeclaration(node) && node.name
            ? /submit/i.test(node.name.text)
            : Boolean(
                node.parent &&
                  ts.isVariableDeclaration(node.parent) &&
                  ts.isIdentifier(node.parent.name) &&
                  /submit/i.test(node.parent.name.text)
              );
        asyncFlows.push({
          trigger: isSubmit ? 'submit' : 'click',
          sourceDependency: calledDep,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  if (fnNode.body) {
    visit(fnNode.body);
  }

  return { state, effects, asyncFlows };
}

function inferStateType(
  initArg: ts.Expression | undefined
): StateModel['inferredType'] {
  if (!initArg) return 'unknown';
  if (ts.isStringLiteral(initArg) || ts.isNoSubstitutionTemplateLiteral(initArg)) return 'string';
  if (ts.isNumericLiteral(initArg)) return 'number';
  if (
    initArg.kind === ts.SyntaxKind.TrueKeyword ||
    initArg.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return 'boolean';
  }
  if (ts.isArrayLiteralExpression(initArg)) return 'array';
  if (ts.isObjectLiteralExpression(initArg)) return 'object';
  return 'unknown';
}

function analyzeJsxTree(
  fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  props: PropModel[],
  state: StateModel[],
  diagnostics: Diagnostic[]
): {
  elements: ElementModel[];
  interactions: InteractionModel[];
  conditions: ConditionModel[];
  lists: ListRenderModel[];
} {
  const elements: ElementModel[] = [];
  const interactions: InteractionModel[] = [];
  const conditions: ConditionModel[] = [];
  const lists: ListRenderModel[] = [];
  const propNames = new Set(props.map((p) => p.name));
  const stateNames = new Set(state.map((s) => s.name));
  const labelByForId = new Map<string, string>();

  // Pass 1: Collect <label htmlFor="id">Label Text</label> mappings
  function collectLabels(node: ts.Node): void {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText();
      if (tag === 'label') {
        const forAttr = getStringAttr(node.openingElement.attributes, 'htmlFor');
        const labelText = extractDirectText(node.children);
        if (forAttr && labelText) {
          labelByForId.set(forAttr, labelText);
        }
      }
    }
    ts.forEachChild(node, collectLabels);
  }

  if (fnNode.body) {
    collectLabels(fnNode.body);
  }

  // Pass 1b: Map local handler functions (e.g. handleFormSubmit) to any callback prop they invoke
  const localHandlerToProp = new Map<string, string>();
  function collectLocalHandlers(node: ts.Node): void {
    let fnName: string | undefined;
    let body: ts.Node | undefined;

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      fnName = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      fnName = node.name.text;
      body = node.initializer.body;
    }

    if (fnName && body && node !== fnNode) {
      let matchedProp: string | undefined;
      function findPropCall(inner: ts.Node): void {
        if (matchedProp) return;
        if (
          ts.isCallExpression(inner) &&
          ts.isIdentifier(inner.expression) &&
          propNames.has(inner.expression.text)
        ) {
          matchedProp = inner.expression.text;
          return;
        }
        ts.forEachChild(inner, findPropCall);
      }
      findPropCall(body);
      if (matchedProp) {
        localHandlerToProp.set(fnName, matchedProp);
      }
    }

    ts.forEachChild(node, collectLocalHandlers);
  }

  if (fnNode.body) {
    collectLocalHandlers(fnNode.body);
  }

  // Pass 2: Extract elements, interactions, conditionals, and .map() lists
  function visit(node: ts.Node, wrappingLabel?: string): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText();
      const children = ts.isJsxElement(node) ? node.children : undefined;

      const currentLabel =
        tag === 'label' && children ? extractDirectText(children) ?? wrappingLabel : wrappingLabel;

      const idAttr = getStringAttr(opening.attributes, 'id');
      const ariaLabel = getStringAttr(opening.attributes, 'aria-label');
      const placeholder = getStringAttr(opening.attributes, 'placeholder');
      const inputType = getStringAttr(opening.attributes, 'type');
      const resolvedLabel =
        ariaLabel ?? (idAttr ? labelByForId.get(idAttr) : undefined) ?? wrappingLabel;

      const textContent = children ? extractDirectText(children) : undefined;
      const boundExpr = children ? extractBoundExpression(children) : undefined;
      const rootBoundIdent = boundExpr?.split('.')[0];
      const boundProp =
        boundExpr && rootBoundIdent && propNames.has(rootBoundIdent) ? boundExpr : undefined;
      const boundState = boundExpr && stateNames.has(boundExpr) ? boundExpr : undefined;

      const disabledExpr = getExprAttr(opening.attributes, 'disabled');
      const disabledProp = disabledExpr && propNames.has(disabledExpr) ? disabledExpr : undefined;
      const disabledState =
        disabledExpr && stateNames.has(disabledExpr) ? disabledExpr : undefined;

      const hasNestedJsx = Boolean(
        children?.some((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c))
      );

      // Preserve Basic capability: leaf <span>/<div> rendering a direct prop/state binding
      const role =
        mapTagToRole(tag, inputType) ??
        ((tag === 'span' || tag === 'div') && (boundProp || boundState) && !hasNestedJsx
          ? 'paragraph'
          : undefined);

      if (role) {
        elements.push({
          tag,
          role,
          textContent,
          labelText: resolvedLabel,
          placeholder,
          inputType,
          boundProp,
          boundState,
          hasDisabledAttr: Boolean(disabledExpr || hasBooleanAttr(opening.attributes, 'disabled')),
          disabledProp,
          disabledState,
        });
      } else if (/^[a-z]/.test(tag) && !LAYOUT_TAGS.has(tag)) {
        diagnostics.push({
          code: 'UNSUPPORTED_ELEMENT_INTERMEDIATE',
          severity: 'warning',
          message: `HTML element <${tag}> is outside standard intermediate element assertions.`,
        });
      }

      // Extract event interactions (onClick, onChange, onSubmit)
      for (const eventName of ['onClick', 'onChange', 'onSubmit'] as const) {
        const handlerExpr = getExprAttr(opening.attributes, eventName);
        if (handlerExpr) {
          const cleanHandler = handlerExpr.replace(/^\(\)\s*=>\s*/, '').replace(/\(\)$/, '');
          const resolvedProp = propNames.has(cleanHandler)
            ? cleanHandler
            : localHandlerToProp.get(cleanHandler);

          interactions.push({
            event: eventName,
            elementTag: tag,
            elementText: textContent ?? resolvedLabel ?? placeholder,
            handlerProp: resolvedProp,
          });
        }
      }

      if (children) {
        for (const child of children) {
          visit(child, currentLabel);
        }
      }
      return;
    }

    // Extract JSX expressions: && conditionals, ? : ternaries, and .map() lists
    if (ts.isJsxExpression(node) && node.expression) {
      const expr = node.expression;

      // Logical AND: {showNote && <p>Note</p>}
      if (
        ts.isBinaryExpression(expr) &&
        expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        ts.isIdentifier(expr.left)
      ) {
        const condName = expr.left.text;
        const branchInfo = inspectJsxBranch(expr.right);
        if (branchInfo && propNames.has(condName)) {
          conditions.push({
            kind: 'logical-and',
            conditionProp: condName,
            renderedTag: branchInfo.tag,
            renderedText: branchInfo.text,
            boundProp:
              branchInfo.boundIdent && propNames.has(branchInfo.boundIdent)
                ? branchInfo.boundIdent
                : undefined,
          });
        }
      }

      // Ternary: {isActive ? <span>Active</span> : <span>Inactive</span>}
      if (ts.isConditionalExpression(expr) && ts.isIdentifier(expr.condition)) {
        const condName = expr.condition.text;
        const trueBranch = inspectJsxBranch(expr.whenTrue);
        const falseBranch = inspectJsxBranch(expr.whenFalse);
        if (trueBranch && falseBranch && propNames.has(condName)) {
          conditions.push({
            kind: 'ternary',
            conditionProp: condName,
            renderedTag: trueBranch.tag,
            renderedText: trueBranch.text,
            falseRenderedTag: falseBranch.tag,
            falseRenderedText: falseBranch.text,
          });
        }
      }

      // List rendering: {items.map((item) => <li key={item.id}>{item.title}</li>)}
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression) &&
        expr.expression.name.text === 'map' &&
        ts.isIdentifier(expr.expression.expression)
      ) {
        const sourceName = expr.expression.expression.text;
        const callback = expr.arguments[0];
        const firstCallbackParam =
          callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
            ? callback.parameters[0]
            : undefined;

        if (
          callback &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          firstCallbackParam &&
          ts.isIdentifier(firstCallbackParam.name)
        ) {
          const itemVar = firstCallbackParam.name.text;
          const itemFields = collectItemPropertyAccesses(callback.body, itemVar);
          const rootTag = extractRootJsxTag(callback.body) ?? 'li';
          lists.push({
            sourceKind: stateNames.has(sourceName) ? 'state' : 'prop',
            sourceName,
            itemVar,
            renderedTag: rootTag,
            itemFields,
          });
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, wrappingLabel));
  }

  if (fnNode.body) {
    visit(fnNode.body);
  }

  return { elements, interactions, conditions, lists };
}

function mapTagToRole(tag: string, inputType?: string): ElementModel['role'] | undefined {
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'button' || tag === 'Button') return 'button';
  if (tag === 'textarea' || tag === 'Textarea') return 'textbox';
  if (tag === 'select' || tag === 'Select') return 'combobox';
  if (tag === 'form') return 'form';
  if (tag === 'input' || tag === 'Input') {
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'submit' || inputType === 'button') return 'button';
    return 'textbox';
  }
  return undefined;
}

function getAttrName(attr: ts.JsxAttribute): string | undefined {
  return ts.isIdentifier(attr.name) ? attr.name.text : undefined;
}

function getStringAttr(attrs: ts.JsxAttributes, name: string): string | undefined {
  for (const prop of attrs.properties) {
    if (ts.isJsxAttribute(prop) && getAttrName(prop) === name && prop.initializer) {
      if (ts.isStringLiteral(prop.initializer)) {
        return prop.initializer.text;
      }
      if (
        ts.isJsxExpression(prop.initializer) &&
        prop.initializer.expression &&
        ts.isStringLiteral(prop.initializer.expression)
      ) {
        return prop.initializer.expression.text;
      }
    }
  }
  return undefined;
}

function getExprAttr(attrs: ts.JsxAttributes, name: string): string | undefined {
  for (const prop of attrs.properties) {
    if (ts.isJsxAttribute(prop) && getAttrName(prop) === name && prop.initializer) {
      if (ts.isJsxExpression(prop.initializer) && prop.initializer.expression) {
        return prop.initializer.expression.getText();
      }
    }
  }
  return undefined;
}

function hasBooleanAttr(attrs: ts.JsxAttributes, name: string): boolean {
  return attrs.properties.some(
    (prop) => ts.isJsxAttribute(prop) && getAttrName(prop) === name && !prop.initializer
  );
}

function extractDirectText(children: ts.NodeArray<ts.JsxChild>): string | undefined {
  const parts: string[] = [];
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const trimmed = child.getText().trim();
      if (trimmed) parts.push(trimmed);
    }
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function extractBoundExpression(children: ts.NodeArray<ts.JsxChild>): string | undefined {
  for (const child of children) {
    if (ts.isJsxExpression(child) && child.expression) {
      if (ts.isIdentifier(child.expression)) {
        return child.expression.text;
      }
      if (ts.isPropertyAccessExpression(child.expression)) {
        return child.expression.getText();
      }
    }
  }
  return undefined;
}

function inspectJsxBranch(
  node: ts.Expression
): { tag: string; text?: string; boundIdent?: string } | null {
  const unwrapped = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isJsxElement(unwrapped)) {
    return {
      tag: unwrapped.openingElement.tagName.getText(),
      text: extractDirectText(unwrapped.children),
      boundIdent: extractBoundExpression(unwrapped.children),
    };
  }
  if (ts.isJsxSelfClosingElement(unwrapped)) {
    return { tag: unwrapped.tagName.getText() };
  }
  return null;
}

function collectItemPropertyAccesses(body: ts.ConciseBody, itemVar: string): string[] {
  const fields = new Set<string>();
  function walk(n: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === itemVar
    ) {
      fields.add(n.name.text);
    }
    ts.forEachChild(n, walk);
  }
  walk(body);
  return Array.from(fields);
}

function extractRootJsxTag(body: ts.ConciseBody): string | undefined {
  let foundTag: string | undefined;
  function walk(n: ts.Node): void {
    if (foundTag) return;
    if (ts.isJsxElement(n)) {
      foundTag = n.openingElement.tagName.getText();
      return;
    }
    if (ts.isJsxSelfClosingElement(n)) {
      foundTag = n.tagName.getText();
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(body);
  return foundTag;
}