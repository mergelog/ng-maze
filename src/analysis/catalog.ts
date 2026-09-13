import * as path from 'node:path';
import * as fs from 'node:fs';
import type * as TS from 'typescript';
import type { ComponentId, ComponentInfo, DetectionGap, Diagnostic, NgModuleInfo, SourceLocation } from '../model/types.js';
import { absPosix, compareCodePoint, existsFile, relPosix } from '../util/paths.js';
import type { ProgramContext } from '../project/program.js';
import { projectOfFile } from '../project/workspace.js';
import { asBoolean, asString, classLikeName, flatten, objectGet, StaticEvaluator, type StaticValue } from './evaluator.js';
import type { SymbolResolver } from './symbols.js';

/** A reference inside metadata that scope resolution cares about. */
export type ScopeRef =
  | { kind: 'id'; id: ComponentId }
  | { kind: 'external' }
  | { kind: 'unresolved'; reason: string; location: SourceLocation };

export interface ComponentRecord {
  info: ComponentInfo;
  declaration: TS.ClassLikeDeclaration;
  imports: ScopeRef[];
  /** Inline template text with the literal node, for source mapping. */
  inlineTemplate: { text: string; node: TS.Node } | null;
}

export interface NgModuleRecord {
  info: NgModuleInfo;
  declarations: ScopeRef[];
  imports: ScopeRef[];
  exports: ScopeRef[];
}

export interface Catalog {
  components: Map<ComponentId, ComponentRecord>;
  ngModules: Map<ComponentId, NgModuleRecord>;
  diagnostics: Diagnostic[];
  detectionGaps: DetectionGap[];
}

export function makeComponentId(workspaceRoot: string, file: string, className: string): ComponentId {
  return `${relPosix(workspaceRoot, file)}#${className}`;
}

export function locationOf(ctx: ProgramContext, node: TS.Node): SourceLocation {
  const sourceFile = node.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: relPosix(ctx.workspace.workspaceRoot, absPosix(sourceFile.fileName)),
    line: line + 1,
    column: character + 1,
    precision: 'exact',
  };
}

// Plan sections 11 / 24: an anonymous default exported class is addressable as
// `default`. The rule is shared so every phase attributes code identically.
const className = classLikeName;

/** Decorator whose identity really is the given `@angular/core` export. */
function angularDecorator(
  ts: typeof TS,
  symbols: SymbolResolver,
  declaration: TS.ClassLikeDeclaration,
  exportName: string,
): TS.CallExpression | undefined {
  const decorators = ts.canHaveDecorators(declaration) ? ts.getDecorators(declaration) : undefined;
  for (const decorator of decorators ?? []) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    const callee = expression.expression;
    const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    if (!ts.isIdentifier(nameNode)) continue;
    const symbol = symbols.symbolAt(nameNode);
    if (symbols.isPackageExport(symbol, '@angular/core', exportName)) return expression;
  }
  return undefined;
}

/** Root identifier of an expression, used to tell project-local gaps from external ones. */
function rootIdentifier(ts: typeof TS, node: TS.Node): TS.Identifier | undefined {
  let current: TS.Node = node;
  for (;;) {
    if (ts.isIdentifier(current)) return current;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSpreadElement(current)) {
      current = current.expression;
      continue;
    }
    return undefined;
  }
}

export function buildCatalog(
  ctx: ProgramContext,
  symbols: SymbolResolver,
  evaluator: StaticEvaluator,
): Catalog {
  const ts = ctx.ts;
  const components = new Map<ComponentId, ComponentRecord>();
  const ngModules = new Map<ComponentId, NgModuleRecord>();
  const diagnostics: Diagnostic[] = [];
  const detectionGaps: DetectionGap[] = [];
  // Several classes in one file can share a name (namespaces, conditional
  // declarations), so the census keeps every decorated class per id: keyed the
  // same way as `components`, a collision would overwrite the evidence of
  // itself and the audit could never fire.
  const decoratedComponents = new Map<ComponentId, { name: string; location: SourceLocation }[]>();
  const workspaceRoot = ctx.workspace.workspaceRoot;

  const diag = (
    code: Diagnostic['code'],
    message: string,
    location: SourceLocation,
    owner: ComponentId | null,
    detail?: string,
  ): void => {
    diagnostics.push({ code, message, file: location.file, location, owner, ...(detail ? { detail } : {}) });
  };

  /** metadata value -> scope reference (plan sections 14 / 15). */
  const toScopeRef = (value: StaticValue): ScopeRef => {
    if (value.k === 'class') {
      const name = value.ref.name;
      if (!symbols.isInternalFile(value.ref.file)) return { kind: 'external' };
      return { kind: 'id', id: makeComponentId(workspaceRoot, value.ref.file, name) };
    }
    if (value.k === 'unknown') {
      const identifier = rootIdentifier(ts, value.node);
      const symbol = identifier ? symbols.symbolAt(identifier) : undefined;
      // Only a project-local gap can hide project components (plan section 15).
      if (symbol && symbols.isInternalSymbol(symbol)) {
        return { kind: 'unresolved', reason: value.reason, location: locationOf(ctx, value.node) };
      }
      if (!symbol && identifier) {
        return { kind: 'unresolved', reason: value.reason, location: locationOf(ctx, identifier) };
      }
      return { kind: 'external' };
    }
    return { kind: 'external' };
  };

  const refsOf = (value: StaticValue | undefined): ScopeRef[] =>
    value ? flatten(value).map(toScopeRef) : [];

  for (const sourceFile of ctx.analysisFiles) {
    const file = absPosix(sourceFile.fileName);
    const angularProject = projectOfFile(ctx.workspace.projects, file);

    const visit = (node: TS.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const componentDecorator = angularDecorator(ts, symbols, node, 'Component');
        if (componentDecorator) {
          const name = className(ts, node);
          if (name) {
            const location = locationOf(ctx, node.name ?? node);
            const censusId = makeComponentId(workspaceRoot, file, name);
            decoratedComponents.set(censusId, [...(decoratedComponents.get(censusId) ?? []), { name, location }]);
            readComponent(node, componentDecorator);
          }
          else {
            const location = locationOf(ctx, node);
            detectionGaps.push({ code: 'decorated-but-not-catalogued',
              message: 'An Angular Component has no stable class name and cannot be catalogued.',
              file: location.file, location, owner: null, candidates: [] });
          }
        } else {
          const moduleDecorator = angularDecorator(ts, symbols, node, 'NgModule');
          if (moduleDecorator) readNgModule(node, moduleDecorator);
        }
      }
      ts.forEachChild(node, visit);
    };

    const readComponent = (declaration: TS.ClassLikeDeclaration, decorator: TS.CallExpression): void => {
      const name = className(ts, declaration);
      if (!name) return;
      const id = makeComponentId(workspaceRoot, file, name);
      const location = locationOf(ctx, declaration.name ?? declaration);
      const metadataNode = decorator.arguments[0];
      const metadata = metadataNode ? evaluator.evaluate(metadataNode) : undefined;

      const selectorValue = objectGet(metadata, 'selector');
      const selector = asString(selectorValue);
      const selectorUnresolved = selectorValue !== undefined && selector === null;
      if (selectorUnresolved) {
        diag('component-metadata', `selector of ${name} could not be evaluated statically.`, location, id);
      }

      const standaloneValue = objectGet(metadata, 'standalone');
      const standaloneExplicit = asBoolean(standaloneValue);
      if (standaloneValue !== undefined && standaloneExplicit === null) {
        diag('component-metadata', `standalone flag of ${name} could not be evaluated statically.`, location, id);
      }
      // Angular 22: only an explicit `standalone: false` opts into NgModule scope.
      const effectiveStandalone = standaloneExplicit !== false;

      const templateValue = objectGet(metadata, 'template');
      const templateUrlValue = objectGet(metadata, 'templateUrl');
      const inlineTemplateText = asString(templateValue);
      const templateUrl = asString(templateUrlValue);

      let templateKind: ComponentInfo['templateKind'] = 'none';
      let templateFile: string | null = null;
      let inlineTemplate: ComponentRecord['inlineTemplate'] = null;

      if (inlineTemplateText !== null && templateUrlValue !== undefined) {
        diag('component-metadata',
          `${name} declares both template and templateUrl; the inline template is used.`, location, id,
          templateUrl ?? undefined);
      }

      if (inlineTemplateText !== null) {
        templateKind = 'inline';
        const literalNode = metadataNode && ts.isObjectLiteralExpression(metadataNode)
          ? findPropertyInitializer(ts, metadataNode, 'template')
          : undefined;
        inlineTemplate = { text: inlineTemplateText, node: literalNode ?? declaration };
      } else if (templateValue !== undefined) {
        diag('component-metadata', `template of ${name} could not be evaluated statically.`, location, id);
      } else if (templateUrl !== null) {
        templateKind = 'external';
        const resolved = absPosix(path.resolve(path.dirname(file), templateUrl));
        if (existsFile(resolved)) {
          templateFile = resolved;
        } else {
          templateKind = 'none';
          diag('missing-template', `templateUrl "${templateUrl}" of ${name} does not exist.`, location, id, resolved);
        }
      } else if (templateUrlValue !== undefined) {
        diag('component-metadata', `templateUrl of ${name} could not be evaluated statically.`, location, id);
      }

      const imports = refsOf(objectGet(metadata, 'imports'));
      if (objectGet(metadata, 'hostDirectives') !== undefined) {
        detectionGaps.push({ code: 'unsupported-angular-api',
          message: `hostDirectives on ${name} may affect runtime host behavior but is not a component composition edge.`,
          file: location.file, location, owner: id, candidates: [] });
      }

      if (metadataNode && metadata && metadata.k === 'unknown') {
        diag('component-metadata', `metadata of ${name} could not be evaluated statically.`, location, id, metadata.reason);
      }

      const info: ComponentInfo = {
        id,
        className: name,
        extendsComponent: null,
        selector,
        selectorUnresolved,
        templateKind,
        templateFile,
        effectiveStandalone,
        standaloneExplicit,
        angularProject,
        file,
        location,
      };

      const existing = components.get(id);
      if (existing) return;
      components.set(id, { info, declaration, imports, inlineTemplate });
    };

    const readNgModule = (declaration: TS.ClassLikeDeclaration, decorator: TS.CallExpression): void => {
      const name = className(ts, declaration);
      if (!name) return;
      const id = makeComponentId(workspaceRoot, file, name);
      const location = locationOf(ctx, declaration.name ?? declaration);
      const metadataNode = decorator.arguments[0];
      const metadata = metadataNode ? evaluator.evaluate(metadataNode) : undefined;

      const declarations = refsOf(objectGet(metadata, 'declarations'));
      const imports = refsOf(objectGet(metadata, 'imports'));
      const exports = refsOf(objectGet(metadata, 'exports'));
      const unresolved = [...declarations, ...imports, ...exports].some((r) => r.kind === 'unresolved');

      const info: NgModuleInfo = {
        id,
        className: name,
        declarations: declarations.flatMap((r) => (r.kind === 'id' ? [r.id] : [])),
        imports: imports.flatMap((r) => (r.kind === 'id' ? [r.id] : [])),
        exports: exports.flatMap((r) => (r.kind === 'id' ? [r.id] : [])),
        file,
        location,
        angularProject,
        unresolved,
      };
      if (!ngModules.has(id)) {
        ngModules.set(id, { info, declarations, imports, exports });
      }
    };

    ts.forEachChild(sourceFile, visit);
  }

  // Explicit symbol-based census. This normally stays empty because the same
  // pass builds the catalog, but makes a future early-return/filter regression
  // visible instead of silently lowering the component count.
  for (const [id, occurrences] of decoratedComponents) {
    // The first occurrence of an id is the one the catalog kept; every further
    // one was dropped and must be visible.
    const catalogued = components.has(id) ? 1 : 0;
    for (const decorated of occurrences.slice(catalogued)) {
      detectionGaps.push({
        code: 'decorated-but-not-catalogued',
        message: catalogued === 0
          ? `Angular component ${decorated.name} was identified by symbol but is absent from the catalog.`
          : `Angular component ${decorated.name} shares the component id of another class in the same file and was dropped.`,
        file: decorated.location.file,
        location: decorated.location,
        owner: null,
        detail: id,
        candidates: [],
      });
    }
  }

  // Inheritance is not a component-use edge: it is retained as component
  // metadata so it cannot alter the tree, reference counts or root candidates.
  // Resolve after cataloguing every file because a base class can be declared
  // later in the program.
  for (const record of components.values()) {
    const clause = record.declaration.heritageClauses?.find(
      (candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword,
    );
    const baseType = clause?.types[0];
    if (!baseType?.expression) continue;

    const baseSymbol = symbols.symbolAt(baseType.expression);
    const baseDeclaration = symbols.declarationOf(baseSymbol);
    if (!baseDeclaration || (!ts.isClassDeclaration(baseDeclaration) && !ts.isClassExpression(baseDeclaration))) {
      if (ts.isCallExpression(baseType.expression)
        || (baseDeclaration && symbols.isInternalFile(absPosix(baseDeclaration.getSourceFile().fileName)))) {
        const location = locationOf(ctx, baseType.expression);
        detectionGaps.push({
          code: 'unsupported-angular-api',
          message: `The extends expression of ${record.info.className} is dynamic and cannot be resolved as component inheritance.`,
          file: location.file,
          location,
          owner: record.info.id,
          detail: baseType.expression.getText(baseType.expression.getSourceFile()),
          candidates: [],
        });
      }
      continue;
    }

    const baseName = className(ts, baseDeclaration);
    const baseFile = symbols.originFile(baseSymbol);
    if (!baseName || !baseFile || !symbols.isInternalFile(baseFile)) continue;

    const baseId = makeComponentId(workspaceRoot, baseFile, baseName);
    if (components.has(baseId)) record.info.extendsComponent = baseId;
  }

  // Plan section 13: the same non standalone component in several NgModules.
  const declaredIn = new Map<ComponentId, NgModuleRecord[]>();
  for (const record of ngModules.values()) {
    for (const declaredId of record.info.declarations) {
      const list = declaredIn.get(declaredId) ?? [];
      list.push(record);
      declaredIn.set(declaredId, list);
    }
  }
  for (const [componentId, modules] of [...declaredIn.entries()].sort((a, b) => compareCodePoint(a[0], b[0]))) {
    if (modules.length < 2) continue;
    if (!components.has(componentId)) continue;
    const owner = components.get(componentId)!;
    diagnostics.push({
      code: 'multiple-ngmodule-declarations',
      message: `${owner.info.className} is declared in ${modules.length} NgModules.`,
      file: owner.info.location.file,
      location: owner.info.location,
      owner: componentId,
      detail: modules.map((m) => m.info.id).sort(compareCodePoint).join(', '),
    });
  }

  // Exclusions are intentional (specs, e2e, testing helpers), but hiding a
  // genuine Angular component there is valuable doctor information.  This is
  // syntax-only on purpose: it avoids manufacturing a catalog entry from an
  // untypechecked file while still rejecting same-named local decorators.
  for (const excludedFile of ctx.excludedSourceFiles) {
    let source: TS.SourceFile;
    try { source = ts.createSourceFile(excludedFile, fs.readFileSync(excludedFile, 'utf8'), ts.ScriptTarget.Latest, true); } catch { continue; }
    const componentNames = new Set<string>();
    const coreNamespaces = new Set<string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== '@angular/core') continue;
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const specifier of bindings.elements) {
        if ((specifier.propertyName?.text ?? specifier.name.text) === 'Component') componentNames.add(specifier.name.text);
      }
      if (bindings && ts.isNamespaceImport(bindings)) coreNamespaces.add(bindings.name.text);
    }
    const visitExcluded = (node: TS.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
        const decorator = (decorators ?? []).find((d) => {
          if (!ts.isCallExpression(d.expression)) return false;
          const callee = d.expression.expression;
          return (ts.isIdentifier(callee) && componentNames.has(callee.text))
            || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
              && coreNamespaces.has(callee.expression.text) && callee.name.text === 'Component');
        });
        if (decorator) {
          const location = locationOf(ctx, node.name ?? node);
          detectionGaps.push({ code: 'excluded-source', message: 'Angular component is in an excluded source file.',
            file: location.file, location, owner: null, candidates: [], detail: relPosix(workspaceRoot, excludedFile) });
        }
      }
      ts.forEachChild(node, visitExcluded);
    };
    visitExcluded(source);
  }

  return { components, ngModules, diagnostics, detectionGaps };
}

function findPropertyInitializer(
  ts: typeof TS,
  objectLiteral: TS.ObjectLiteralExpression,
  name: string,
): TS.Node | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return property.initializer;
    }
  }
  return undefined;
}
