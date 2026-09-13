import type * as TS from 'typescript';
import type { AmbiguousUsage, ComponentId, DetectionGap, Diagnostic, Edge, EdgeKind, ExternalUsage } from '../model/types.js';
import { absPosix } from '../util/paths.js';
import type { ProgramContext } from '../project/program.js';
import { locationOf, makeComponentId, type Catalog } from './catalog.js';
import { classLikeName, type StaticEvaluator } from './evaluator.js';
import { isDeclaredInPackage, type SymbolResolver } from './symbols.js';
import type { OutletCandidate } from './templates.js';

export interface DynamicAnalysis {
  edges: Edge[];
  externalUsages: ExternalUsage[];
  ambiguousUsages: AmbiguousUsage[];
  diagnostics: Diagnostic[];
  detectionGaps: DetectionGap[];
}

/**
 * Dynamic component creation, plan section 21.
 *
 * A pattern never matches on the callee name alone: the receiver type or the
 * function identity has to come from the right Angular package.
 */
/**
 * Callee names that can produce a detection gap. Every other call expression in
 * the program must leave `handleGapApi` before any symbol or type lookup.
 */
const COMPILER_API_NAMES = new Set(['compileModuleAndAllComponentsAsync', 'compileModuleAsync']);
const GAP_API_NAMES = new Set([
  'createEmbeddedView',
  'createCustomElement',
  'resolveComponentFactory',
  ...COMPILER_API_NAMES,
]);

interface DynamicPattern {
  name: string;
  kind: Exclude<EdgeKind, 'template'>;
  /** Index of the argument holding the component class. */
  argumentIndex: number;
  matches(call: TS.CallExpression): boolean;
}

export function analyzeDynamic(
  ctx: ProgramContext,
  symbols: SymbolResolver,
  evaluator: StaticEvaluator,
  catalog: Catalog,
  outletCandidates: OutletCandidate[],
): DynamicAnalysis {
  const ts = ctx.ts;
  const edges: Edge[] = [];
  const externalUsages: ExternalUsage[] = [];
  const ambiguousUsages: AmbiguousUsage[] = [];
  const diagnostics: Diagnostic[] = [];
  const detectionGaps: DetectionGap[] = [];
  const workspaceRoot = ctx.workspace.workspaceRoot;

  const receiverTypeIsFrom = (receiver: TS.Expression, typeName: string, packageName: string): boolean => {
    const symbol = symbols.typeSymbolOf(receiver);
    if (!symbol || symbol.getName() !== typeName) return false;
    const file = symbols.originFile(symbol);
    return file !== null && isDeclaredInPackage(file, packageName);
  };

  /** `TestBed.createComponent()` must never become an edge (plan section 21). */
  const isTestingReceiver = (receiver: TS.Expression): boolean => {
    const symbol = symbols.typeSymbolOf(receiver)
      ?? (ts.isIdentifier(receiver) ? symbols.symbolAt(receiver) : undefined);
    const file = symbol ? symbols.originFile(symbol) : null;
    if (file && file.includes('/@angular/core/testing/')) return true;
    return ts.isIdentifier(receiver) && receiver.text === 'TestBed';
  };

  const patterns: DynamicPattern[] = [
    {
      name: 'MatDialog.open',
      kind: 'dialog',
      argumentIndex: 0,
      matches: (call) => {
        const callee = call.expression;
        if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'open') return false;
        return receiverTypeIsFrom(callee.expression, 'MatDialog', '@angular/material');
      },
    },
    {
      name: 'ViewContainerRef.createComponent',
      kind: 'create-component',
      argumentIndex: 0,
      matches: (call) => {
        const callee = call.expression;
        if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'createComponent') return false;
        if (isTestingReceiver(callee.expression)) return false;
        return receiverTypeIsFrom(callee.expression, 'ViewContainerRef', '@angular/core');
      },
    },
    {
      name: '@angular/core createComponent',
      kind: 'create-component',
      argumentIndex: 0,
      matches: (call) => {
        const callee = call.expression;
        if (!ts.isIdentifier(callee) || callee.text !== 'createComponent') return false;
        return symbols.isPackageExport(symbols.symbolAt(callee), '@angular/core', 'createComponent');
      },
    },
  ];

  const componentIdOf = (expression: TS.Expression): ComponentId | null => {
    const value = evaluator.evaluate(expression);
    if (value.k !== 'class') return null;
    if (!symbols.isInternalFile(value.ref.file)) return null;
    const id = makeComponentId(workspaceRoot, value.ref.file, value.ref.name);
    return catalog.components.has(id) ? id : null;
  };

  /** Conservative value-flow: enumerate only catalogued classes reachable
   * through const/property aliases, conditionals and literal maps/arrays. */
  const componentCandidatesOf = (expression: TS.Expression): ComponentId[] => {
    const found = new Set<ComponentId>();
    const seen = new Set<TS.Node>();
    const unwrap = (node: TS.Expression): TS.Expression =>
      ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
        ? unwrap(node.expression) : node;
    const addValue = (value: ReturnType<StaticEvaluator['evaluate']>): void => {
      if (value.k === 'class' && symbols.isInternalFile(value.ref.file)) {
        const id = makeComponentId(workspaceRoot, value.ref.file, value.ref.name);
        if (catalog.components.has(id)) found.add(id);
      } else if (value.k === 'array') {
        value.items.forEach(addValue);
      } else if (value.k === 'object') {
        value.props.forEach(addValue);
      }
    };
    const walk = (input: TS.Expression): void => {
      const node = unwrap(input);
      if (seen.has(node)) return;
      seen.add(node);
      addValue(evaluator.evaluate(node));
      if (ts.isConditionalExpression(node)) {
        walk(node.whenTrue);
        walk(node.whenFalse);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
          if (ts.isSpreadElement(element)) walk(element.expression);
          else walk(element);
        }
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        for (const property of node.properties) {
          if (ts.isPropertyAssignment(property)) walk(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property)) walk(property.name);
          else if (ts.isSpreadAssignment(property)) walk(property.expression);
        }
        return;
      }
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const name = ts.isPropertyAccessExpression(node) ? node.name : node;
        const declaration = symbols.declarationOf(symbols.symbolAt(name));
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) walk(declaration.initializer);
        else if (declaration && ts.isPropertyDeclaration(declaration) && declaration.initializer) walk(declaration.initializer);
        else if (declaration && ts.isPropertyAssignment(declaration)) walk(declaration.initializer);
        else if (declaration && ts.isGetAccessorDeclaration(declaration) && declaration.body?.statements.length === 1) {
          const statement = declaration.body.statements[0];
          if (statement && ts.isReturnStatement(statement) && statement.expression) walk(statement.expression);
        }
        return;
      }
      if (ts.isElementAccessExpression(node)) {
        const expression = node.expression;
        const name = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
        if (ts.isIdentifier(name)) {
          const declaration = symbols.declarationOf(symbols.symbolAt(name));
          if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) walk(declaration.initializer);
          if (declaration && ts.isPropertyDeclaration(declaration) && declaration.initializer) walk(declaration.initializer);
        }
      }
    };
    walk(expression);
    return [...found].sort();
  };

  const gap = (code: DetectionGap['code'], message: string, location: import('../model/types.js').SourceLocation,
    owner: ComponentId | null, candidates: ComponentId[] = [], detail?: string): void => {
    detectionGaps.push({ code, message, file: location.file, location, owner, candidates, ...(detail ? { detail } : {}) });
  };

  const orderCounters = new Map<ComponentId, number>();
  const nextOrder = (owner: ComponentId): number => {
    const current = orderCounters.get(owner) ?? 0;
    orderCounters.set(owner, current + 1);
    return current;
  };

  for (const sourceFile of ctx.analysisFiles) {
    const file = absPosix(sourceFile.fileName);

    // Owner tracking without relying on node.parent.
    const classStack: TS.ClassLikeDeclaration[] = [];
    const functionStack: string[] = [];

    const currentOwner = (): { componentId: ComponentId | null; callerKind: ExternalUsage['callerKind']; callerName: string } => {
      const enclosingClass = classStack[classStack.length - 1];
      if (enclosingClass) {
        // Only `export default class {}` is addressable as `default`. Any other
        // anonymous class (`const helper = class { ... }`) has no id, and
        // calling it `default` would hand its calls to an unrelated component.
        const name = classLikeName(ts, enclosingClass);
        if (name === null) {
          return { componentId: null, callerKind: 'class', callerName: '(anonymous)' };
        }
        const id = makeComponentId(workspaceRoot, file, name);
        return {
          componentId: catalog.components.has(id) ? id : null,
          callerKind: 'class',
          callerName: name,
        };
      }
      const enclosingFunction = functionStack[functionStack.length - 1];
      if (enclosingFunction) return { componentId: null, callerKind: 'function', callerName: enclosingFunction };
      return { componentId: null, callerKind: 'file', callerName: sourceFile.fileName.split('/').pop() ?? sourceFile.fileName };
    };

    const handleCall = (call: TS.CallExpression): void => {
      const pattern = patterns.find((p) => p.matches(call));
      if (!pattern) return;
      const argument = call.arguments[pattern.argumentIndex];
      const location = locationOf(ctx, call);
      if (!argument) return;

      const target = componentIdOf(argument);
      const owner = currentOwner();

      if (!target) {
        const value = evaluator.evaluate(argument);
        const candidates = componentCandidatesOf(argument);
        // Only complain when this really was a component slot we could not pin
        // down, not when the target is an external component.
        if (value.k === 'unknown') {
          diagnostics.push({
            code: 'unresolved-dynamic',
            message: `${pattern.name} target could not be resolved statically.`,
            file: location.file,
            location,
            owner: owner.componentId,
            detail: value.reason,
          });
          gap('unresolved-dynamic-target', `${pattern.name} target could not be resolved statically.`, location,
            owner.componentId, candidates, value.reason);
          ambiguousUsages.push({
            owner: owner.componentId,
            callerKind: owner.callerKind,
            callerName: owner.callerName,
            kind: pattern.kind,
            expression: argument.getText(sourceFile),
            message: `${pattern.name} target could not be resolved statically.`,
            location,
            candidates,
          });
        }
        return;
      }

      if (owner.componentId) {
        edges.push({ from: owner.componentId, to: target, kind: pattern.kind, location, order: nextOrder(owner.componentId) });
      } else {
        // Plan section 23: services, effects and plain functions are not parents.
        externalUsages.push({
          callerKind: owner.callerKind,
          callerName: owner.callerName,
          target,
          kind: pattern.kind,
          location,
        });
      }
    };

    const handleGapApi = (call: TS.CallExpression): void => {
      const callee = call.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
      if (!GAP_API_NAMES.has(name)) return;
      const receiverIs = (typeName: string, packageName = '@angular/core'): boolean =>
        ts.isPropertyAccessExpression(callee) && receiverTypeIsFrom(callee.expression, typeName, packageName);
      // Resolving the callee symbol costs an alias walk per call expression in
      // the program: only the one branch that needs it may pay for it.
      const calleeSymbol = (): TS.Symbol | undefined => (
        ts.isIdentifier(callee) || ts.isPropertyAccessExpression(callee)
          ? symbols.symbolAt(ts.isPropertyAccessExpression(callee) ? callee.name : callee)
          : undefined
      );
      if (name === 'createEmbeddedView' && (receiverIs('TemplateRef') || receiverIs('ViewContainerRef'))) {
        gap('view-relocation', 'Embedded view creation changes runtime view topology and is not a component edge.',
          locationOf(ctx, call), currentOwner().componentId);
      }
      if ((name === 'createCustomElement' && symbols.isPackageExport(calleeSymbol(), '@angular/elements', 'createCustomElement'))
        || (name === 'resolveComponentFactory' && receiverIs('ComponentFactoryResolver'))
        || (COMPILER_API_NAMES.has(name) && receiverIs('Compiler'))) {
        gap('unsupported-angular-api', `${name} is a runtime Angular API and cannot be represented as a static component edge.`,
          locationOf(ctx, call), currentOwner().componentId);
      }
    };

    const visit = (node: TS.Node): void => {
      const isClass = ts.isClassDeclaration(node) || ts.isClassExpression(node);
      const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

      if (isClass) classStack.push(node as TS.ClassLikeDeclaration);
      if (isFunction) {
        const named = node as TS.FunctionDeclaration;
        functionStack.push(named.name?.text ?? functionStack[functionStack.length - 1] ?? 'anonymous');
      }
      if (ts.isCallExpression(node)) {
        handleCall(node);
        handleGapApi(node);
      }

      ts.forEachChild(node, visit);

      if (isClass) classStack.pop();
      if (isFunction) functionStack.pop();
    };

    ts.forEachChild(sourceFile, visit);
  }

  // NgComponentOutlet, plan section 22.
  for (const candidate of outletCandidates) {
    const record = catalog.components.get(candidate.owner);
    if (!record) continue;
    const memberExpressions = resolveOutletExpressions(ts, record.declaration, candidate.expression);
    const targets = [...new Set(memberExpressions.flatMap((expression) => componentIdOf(expression) ?? []))];
    if (targets.length === 1 && memberExpressions.length > 0
      && memberExpressions.every((expression) => componentIdOf(expression) === targets[0])) {
      edges.push({ from: candidate.owner, to: targets[0]!, kind: 'ng-component-outlet', location: candidate.location, order: nextOrder(candidate.owner) });
      continue;
    }
    const values = memberExpressions.map((expression) => evaluator.evaluate(expression));
    if (values.length > 0 && values.every((value) => value.k === 'class' && !symbols.isInternalFile(value.ref.file))) continue;
    const candidates = [...new Set(memberExpressions.flatMap(componentCandidatesOf))].sort();
    diagnostics.push({
      code: 'unresolved-dynamic',
      message: `ngComponentOutlet target "${candidate.expression}" could not be resolved statically.`,
      file: candidate.location.file,
      location: candidate.location,
      owner: candidate.owner,
    });
    gap('unresolved-dynamic-target', `ngComponentOutlet target "${candidate.expression}" could not be resolved statically.`,
      candidate.location, candidate.owner, candidates);
    ambiguousUsages.push({
      owner: candidate.owner,
      callerKind: 'class',
      callerName: record.info.className,
      kind: 'ng-component-outlet',
      expression: candidate.expression,
      message: 'ngComponentOutlet target could not be resolved statically.',
      location: candidate.location,
      candidates,
    });
  }

  return { edges, externalUsages, ambiguousUsages, diagnostics, detectionGaps };
}

/** Resolves template-side member/conditional/map syntax back to original class
 * expressions, which retain TypeChecker symbols. Arbitrary template calls are
 * never executed; only their explicit return expressions can contribute. */
function resolveOutletExpressions(
  ts: typeof TS,
  declaration: TS.ClassLikeDeclaration,
  expression: string,
): TS.Expression[] {
  const source = ts.createSourceFile(
    '__ngmaze_template_expression.ts',
    `const __ngmaze_value = (${expression});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = source.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return [];
  const parsed = statement.declarationList.declarations[0]?.initializer;
  if (!parsed) return [];

  const memberValues = (name: string, includeMethods: boolean): TS.Expression[] => {
    for (const member of declaration.members) {
      if (!member.name || !ts.isIdentifier(member.name) || member.name.text !== name) continue;
      if (ts.isPropertyDeclaration(member) && member.initializer) return [member.initializer];
      if (ts.isGetAccessorDeclaration(member) && member.body) {
        return member.body.statements.flatMap((item) =>
          ts.isReturnStatement(item) && item.expression ? [item.expression] : []);
      }
      if (includeMethods && ts.isMethodDeclaration(member) && member.body) {
        return member.body.statements.flatMap((item) =>
          ts.isReturnStatement(item) && item.expression ? [item.expression] : []);
      }
    }
    return [];
  };

  const propertyOf = (object: TS.Expression, key: string | null): TS.Expression[] => {
    const bases = resolve(object);
    const result: TS.Expression[] = [];
    for (const base of bases) {
      if (!ts.isObjectLiteralExpression(base)) {
        result.push(base);
        continue;
      }
      for (const property of base.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          || ts.isNumericLiteral(property.name) ? property.name.text : null;
        if (key === null || propertyName === key) result.push(property.initializer);
      }
    }
    return result;
  };

  const resolve = (node: TS.Expression): TS.Expression[] => {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return resolve(node.expression);
    }
    if (ts.isConditionalExpression(node)) return [...resolve(node.whenTrue), ...resolve(node.whenFalse)];
    if (ts.isIdentifier(node)) return memberValues(node.text, false);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) return memberValues(node.expression.text, true);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return memberValues(node.expression.name.text, true);
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return memberValues(node.name.text, false);
    }
    if (ts.isPropertyAccessExpression(node)) return propertyOf(node.expression, node.name.text);
    if (ts.isElementAccessExpression(node)) {
      const argument = node.argumentExpression;
      const key = argument && (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) ? argument.text : null;
      return propertyOf(node.expression, key);
    }
    return [];
  };

  return resolve(parsed);
}

export type { DynamicPattern };
