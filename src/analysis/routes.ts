import type * as TS from 'typescript';
import type { ComponentId, DetectionGap, Diagnostic, RouteEntry, SourceLocation } from '../model/types.js';
import { absPosix } from '../util/paths.js';
import type { ProgramContext } from '../project/program.js';
import { projectOfFile } from '../project/workspace.js';
import { asString, StaticEvaluator } from './evaluator.js';
import { locationOf, makeComponentId, type Catalog } from './catalog.js';
import type { SymbolResolver } from './symbols.js';

export interface RouteAnalysis {
  routes: RouteEntry[];
  diagnostics: Diagnostic[];
  detectionGaps: DetectionGap[];
}

const ROUTER_MODULE = '@angular/router';

/**
 * Route analysis, plan section 20.
 *
 * A `path:` property alone never makes an object a route: the enclosing
 * expression has to be reachable from a real Angular Router API.
 */
export function analyzeRoutes(
  ctx: ProgramContext,
  symbols: SymbolResolver,
  evaluator: StaticEvaluator,
  catalog: Catalog,
): RouteAnalysis {
  const ts = ctx.ts;
  const routes: RouteEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const detectionGaps: DetectionGap[] = [];
  const workspaceRoot = ctx.workspace.workspaceRoot;
  // The same route array is often reachable twice (its `: Routes` declaration and
  // the `provideRouter(routes)` call). Dedupe per route object and parent path so
  // one source route stays one entry, while a shared children array used under two
  // parents still yields both real paths.
  const visitedRouteObjects = new Map<TS.Node, Set<string>>();

  const addDiagnostic = (
    message: string,
    location: SourceLocation,
    detail?: string,
    candidates: ComponentId[] = [],
  ): void => {
    diagnostics.push({
      code: 'unresolved-route',
      message,
      file: location.file,
      location,
      owner: null,
      ...(detail ? { detail } : {}),
    });
    detectionGaps.push({
      code: 'unresolved-route-loader', message, file: location.file, location,
      owner: null, candidates, ...(detail ? { detail } : {}),
    });
  };

  const isRouterType = (typeNode: TS.TypeNode | undefined): boolean => {
    if (!typeNode) return false;
    let node: TS.TypeNode = typeNode;
    if (ts.isArrayTypeNode(node)) node = node.elementType;
    if (!ts.isTypeReferenceNode(node)) return false;
    const name = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName;
    if (!ts.isIdentifier(name)) return false;
    if (name.text !== 'Routes' && name.text !== 'Route') return false;
    const symbol = symbols.symbolAt(name);
    return symbols.isPackageExport(symbol, ROUTER_MODULE, name.text);
  };

  /** Resolves an expression to the route object literals it stands for. */
  const routeObjectsOf = (expression: TS.Expression): { objects: TS.ObjectLiteralExpression[]; unresolved: TS.Node[] } => {
    const objects: TS.ObjectLiteralExpression[] = [];
    const unresolved: TS.Node[] = [];
    const seen = new Set<TS.Node>();

    const walk = (node: TS.Expression): void => {
      if (seen.has(node)) return;
      seen.add(node);

      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
        walk(node.expression);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) {
          if (ts.isSpreadElement(element)) {
            walk(element.expression);
            continue;
          }
          if (ts.isObjectLiteralExpression(element)) {
            objects.push(element);
            continue;
          }
          walk(element);
        }
        return;
      }
      if (ts.isObjectLiteralExpression(node)) {
        objects.push(node);
        return;
      }
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const nameNode = ts.isPropertyAccessExpression(node) ? node.name : node;
        const declaration = symbols.declarationOf(symbols.symbolAt(nameNode));
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
          walk(declaration.initializer);
          return;
        }
        unresolved.push(node);
        return;
      }
      unresolved.push(node);
    };

    walk(expression);
    return { objects, unresolved };
  };

  /** `import('./x').then(m => m.Foo)` and friends (plan section 20). */
  const resolveLazyTargets = (expression: TS.Expression): { symbols: TS.Symbol[]; complete: boolean } => {
    const unwrapBody = (node: TS.Expression): TS.Expression | undefined => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const body = node.body;
        if (ts.isBlock(body)) {
          const statement = body.statements.length === 1 ? body.statements[0] : undefined;
          return statement && ts.isReturnStatement(statement) ? statement.expression : undefined;
        }
        return body;
      }
      return node;
    };

    const result: TS.Symbol[] = [];
    const seen = new Set<TS.Node>();
    let complete = true;

    const walk = (input: TS.Expression): void => {
      let current = unwrapBody(input);
      if (current && ts.isAwaitExpression(current)) current = current.expression;
      if (!current) { complete = false; return; }
      if (seen.has(current)) return;
      seen.add(current);

      if (ts.isConditionalExpression(current)) {
        walk(current.whenTrue);
        walk(current.whenFalse);
        return;
      }
      if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
        walk(current.expression);
        return;
      }
      if (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current)) {
        const name = ts.isPropertyAccessExpression(current) ? current.name : current;
        const declaration = symbols.declarationOf(symbols.symbolAt(name));
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
          walk(declaration.initializer);
          return;
        }
      }

      let importCall: TS.CallExpression | undefined;
      let exportName = 'default';

      if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)
        && current.expression.name.text === 'then') {
        const target = current.expression.expression;
        if (ts.isCallExpression(target) && target.expression.kind === ts.SyntaxKind.ImportKeyword) {
          importCall = target;
        }
        const callback = current.arguments[0];
        const body = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          ? unwrapBody(callback)
          : undefined;
        if (body && ts.isPropertyAccessExpression(body)) {
          exportName = body.name.text;
        } else if (body && ts.isIdentifier(body)) {
          // `.then(({ Foo }) => Foo)`
          exportName = body.text;
        } else if (body) {
          complete = false;
          return;
        }
      } else if (ts.isCallExpression(current) && current.expression.kind === ts.SyntaxKind.ImportKeyword) {
        importCall = current;
      } else if (ts.isPropertyAccessExpression(current)) {
        const target = current.expression;
        if (ts.isAwaitExpression(target) && ts.isCallExpression(target.expression)
          && target.expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
          importCall = target.expression;
          exportName = current.name.text;
        }
      }

      if (!importCall) { complete = false; return; }
      const specifierNode = importCall.arguments[0];
      if (!specifierNode || !ts.isStringLiteralLike(specifierNode)) { complete = false; return; }

      const containingFile = importCall.getSourceFile().fileName;
      const resolved = ts.resolveModuleName(specifierNode.text, containingFile, ctx.program.getCompilerOptions(), ts.sys);
      if (!resolved.resolvedModule) { complete = false; return; }
      const moduleFile = ctx.program.getSourceFile(resolved.resolvedModule.resolvedFileName);
      if (!moduleFile) { complete = false; return; }
      const moduleSymbol = ctx.checker.getSymbolAtLocation(moduleFile);
      if (!moduleSymbol) { complete = false; return; }
      const exported = ctx.checker.getExportsOfModule(moduleSymbol)
        .find((s) => s.getName() === exportName || (exportName === 'default' && s.getName() === 'default'));
      const resolvedExport = symbols.resolveAlias(exported);
      if (resolvedExport) result.push(resolvedExport);
      else complete = false;
    };

    walk(expression);
    const unique = [...new Map(result.map((symbol) => [symbols.originFile(symbol) + '#' + symbol.getName(), symbol])).values()];
    return { symbols: unique, complete };
  };

  const componentIdOfSymbol = (symbol: TS.Symbol | undefined): ComponentId | undefined => {
    const declaration = symbols.declarationOf(symbol);
    if (!declaration) return undefined;
    if (!ts.isClassDeclaration(declaration) && !ts.isClassExpression(declaration)) return undefined;
    const file = absPosix(declaration.getSourceFile().fileName);
    if (!symbols.isInternalFile(file)) return undefined;
    const name = declaration.name?.text ?? 'default';
    const id = makeComponentId(workspaceRoot, file, name);
    return catalog.components.has(id) ? id : undefined;
  };

  const joinPath = (parent: string, segment: string | null): string => {
    if (segment === null || segment === '') return parent || '/';
    const joined = `${parent === '/' ? '' : parent}/${segment}`.replace(/\/{2,}/g, '/');
    return joined.startsWith('/') ? joined : `/${joined}`;
  };

  const propertyOf = (object: TS.ObjectLiteralExpression, name: string): TS.Expression | undefined => {
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
        return property.initializer;
      }
    }
    return undefined;
  };

  /** The route array a `loadChildren` resolves to, when it resolves to exactly one. */
  const loadChildrenArrayOf = (expression: TS.Expression): TS.Expression | undefined => {
    const resolved = resolveLazyTargets(expression);
    if (!resolved.complete || resolved.symbols.length !== 1) return undefined;
    const declaration = symbols.declarationOf(resolved.symbols[0]);
    return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
      ? declaration.initializer
      : undefined;
  };

  const readRouteObject = (object: TS.ObjectLiteralExpression, parentPath: string): void => {
    const seenPaths = visitedRouteObjects.get(object) ?? new Set<string>();
    if (seenPaths.has(parentPath)) return;
    seenPaths.add(parentPath);
    visitedRouteObjects.set(object, seenPaths);

    const propertyNode = (name: string): TS.Expression | undefined => propertyOf(object, name);

    const pathNode = propertyNode('path');
    const pathValue = pathNode ? asString(evaluator.evaluate(pathNode)) : null;
    const fullPath = joinPath(parentPath, pathValue);
    const outlet = asString(propertyNode('outlet') ? evaluator.evaluate(propertyNode('outlet')) : undefined);
    const location = locationOf(ctx, object);
    const angularProject = projectOfFile(ctx.workspace.projects, absPosix(object.getSourceFile().fileName));

    const componentNode = propertyNode('component');
    if (componentNode) {
      const value = evaluator.evaluate(componentNode);
      if (value.k === 'class' && symbols.isInternalFile(value.ref.file)) {
        const id = makeComponentId(workspaceRoot, value.ref.file, value.ref.name);
        if (catalog.components.has(id)) {
          routes.push({ path: fullPath, target: id, targetKind: 'component', outlet, location, angularProject });
        } else {
          addDiagnostic(`Route "${fullPath}" targets an internal class that is not in the component catalog.`, location, id);
        }
      } else if (value.k !== 'class') {
        addDiagnostic(`Route "${fullPath}" has a component that could not be resolved statically.`, location, value.k === 'unknown' ? value.reason : undefined);
      }
    }

    const loadComponentNode = propertyNode('loadComponent');
    if (loadComponentNode) {
      const resolved = resolveLazyTargets(loadComponentNode);
      const ids = [...new Set(resolved.symbols.flatMap((symbol) => componentIdOfSymbol(symbol) ?? []))].sort();
      if (resolved.complete && ids.length === 1) {
        const id = ids[0]!;
        routes.push({ path: fullPath, target: id, targetKind: 'loadComponent', outlet, location, angularProject });
      } else {
        addDiagnostic(`Route "${fullPath}" has a loadComponent that could not be resolved to one component statically.`, location, undefined, ids);
      }
    }

    const childrenNode = propertyNode('children');
    if (childrenNode) {
      walkRouteArray(childrenNode, fullPath);
    }

    const loadChildrenNode = propertyNode('loadChildren');
    if (loadChildrenNode) {
      const array = loadChildrenArrayOf(loadChildrenNode);
      if (array) {
        walkRouteArray(array, fullPath);
      } else {
        const resolved = resolveLazyTargets(loadChildrenNode);
        const detail = resolved.symbols.map((symbol) => `${symbols.originFile(symbol) ?? 'unknown'}#${symbol.getName()}`).join(', ');
        addDiagnostic(`Route "${fullPath}" has a loadChildren that could not be resolved to one route collection statically.`, location, detail || undefined);
      }
    }
  };

  function walkRouteArray(expression: TS.Expression, parentPath: string): void {
    const { objects, unresolved } = routeObjectsOf(expression);
    for (const object of objects) readRouteObject(object, parentPath);
    for (const node of unresolved) {
      addDiagnostic('Route configuration could not be resolved statically.', locationOf(ctx, node));
    }
  }

  // Route roots are collected first so real application roots
  // (`provideRouter` / `RouterModule.forRoot`) are expanded before standalone
  // `Routes` declarations. A child route array that is mounted through
  // `children` / `loadChildren` must not be reported a second time as if it
  // were mounted at "/".
  const providerRoots: TS.Expression[] = [];
  const annotatedRoots: TS.Expression[] = [];

  for (const sourceFile of ctx.analysisFiles) {
    const visit = (node: TS.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (isRouterType(node.type)) {
          annotatedRoots.push(node.initializer);
        } else if ((ts.isSatisfiesExpression(node.initializer) || ts.isAsExpression(node.initializer))
          && isRouterType(node.initializer.type)) {
          annotatedRoots.push(node.initializer.expression);
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) {
          const symbol = symbols.symbolAt(callee);
          if (symbols.isPackageExport(symbol, ROUTER_MODULE, 'provideRouter')) {
            const [first] = node.arguments;
            if (first) providerRoots.push(first);
          }
        } else if (ts.isPropertyAccessExpression(callee)
          && (callee.name.text === 'forRoot' || callee.name.text === 'forChild')) {
          const receiver = callee.expression;
          const receiverSymbol = ts.isIdentifier(receiver) ? symbols.symbolAt(receiver) : undefined;
          if (symbols.isPackageExport(receiverSymbol, ROUTER_MODULE, 'RouterModule')) {
            const [first] = node.arguments;
            if (first) providerRoots.push(first);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  // Which route objects are mounted through `children` / `loadChildren` is a
  // property of the code, not of the order the declarations happen to appear
  // in. Collecting them up front keeps the output identical when a refactor
  // moves a child array above its parent.
  const mountedAsChild = new Set<TS.ObjectLiteralExpression>();
  const collectMounted = (expression: TS.Expression, seen: Set<TS.ObjectLiteralExpression>): void => {
    for (const object of routeObjectsOf(expression).objects) {
      if (seen.has(object)) continue;
      seen.add(object);
      const childrenNode = propertyOf(object, 'children');
      if (childrenNode) {
        for (const child of routeObjectsOf(childrenNode).objects) mountedAsChild.add(child);
        collectMounted(childrenNode, seen);
      }
      const loadChildrenNode = propertyOf(object, 'loadChildren');
      const array = loadChildrenNode ? loadChildrenArrayOf(loadChildrenNode) : undefined;
      if (array) {
        for (const child of routeObjectsOf(array).objects) mountedAsChild.add(child);
        collectMounted(array, seen);
      }
    }
  };
  const mountedSeen = new Set<TS.ObjectLiteralExpression>();
  for (const root of [...providerRoots, ...annotatedRoots]) collectMounted(root, mountedSeen);

  for (const root of providerRoots) walkRouteArray(root, '/');

  for (const root of annotatedRoots) {
    const { objects } = routeObjectsOf(root);
    // Already mounted under its real parent path: do not invent a second "/" mount.
    if (objects.length > 0 && objects.every((object) => mountedAsChild.has(object) || visitedRouteObjects.has(object))) {
      continue;
    }
    walkRouteArray(root, '/');
  }

  return { routes, diagnostics, detectionGaps };
}
