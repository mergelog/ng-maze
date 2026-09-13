import * as path from 'node:path';
import type * as TS from 'typescript';
import { absPosix, hasNodeModulesSegment, isInside, realPathSafe } from '../util/paths.js';
import type { ProgramContext } from '../project/program.js';

/**
 * Thin resolver on top of Program / TypeChecker (plan sections 3, 5, 8).
 * TypeScript already knows about aliases, barrels, re-exports and path aliases,
 * so ngmaze never reimplements module resolution.
 */
export class SymbolResolver {
  private readonly ts: typeof TS;
  private readonly checker: TS.TypeChecker;
  private readonly internalCache = new Map<string, boolean>();
  private readonly moduleCache = new Map<string, TS.Symbol | null>();
  private readonly originCache = new Map<TS.Symbol, string | null>();

  constructor(private readonly ctx: ProgramContext) {
    this.ts = ctx.ts;
    this.checker = ctx.checker;
  }

  /**
   * Internal / external boundary, plan section 5. Order matters: a pnpm store
   * real path lives under the repo root, so the node_modules segment check has
   * to run before the workspace containment check.
   */
  isInternalFile(fileName: string): boolean {
    const cached = this.internalCache.get(fileName);
    if (cached !== undefined) return cached;
    const result = computeIsInternal(fileName, this.ctx.workspace.workspaceRoot);
    this.internalCache.set(fileName, result);
    return result;
  }

  /** Follows alias chains (`import {A as B}`, barrels, re-exports). */
  resolveAlias(symbol: TS.Symbol | undefined): TS.Symbol | undefined {
    let current = symbol;
    const seen = new Set<TS.Symbol>();
    while (current && (current.flags & this.ts.SymbolFlags.Alias) !== 0) {
      if (seen.has(current)) return current;
      seen.add(current);
      let next: TS.Symbol | undefined;
      try {
        next = this.checker.getAliasedSymbol(current);
      } catch {
        return current;
      }
      if (!next || next === current) return current;
      current = next;
    }
    return current;
  }

  symbolAt(node: TS.Node): TS.Symbol | undefined {
    return this.resolveAlias(this.checker.getSymbolAtLocation(node));
  }

  /** First value declaration, alias resolved. */
  declarationOf(symbol: TS.Symbol | undefined): TS.Declaration | undefined {
    const resolved = this.resolveAlias(symbol);
    if (!resolved) return undefined;
    return resolved.valueDeclaration ?? resolved.declarations?.[0];
  }

  /** Absolute file a symbol is declared in, or `null`. */
  originFile(symbol: TS.Symbol | undefined): string | null {
    const resolved = this.resolveAlias(symbol);
    if (!resolved) return null;
    const cached = this.originCache.get(resolved);
    if (cached !== undefined) return cached;
    const declaration = resolved.valueDeclaration ?? resolved.declarations?.[0];
    const file = declaration ? absPosix(declaration.getSourceFile().fileName) : null;
    this.originCache.set(resolved, file);
    return file;
  }

  isInternalSymbol(symbol: TS.Symbol | undefined): boolean {
    const file = this.originFile(symbol);
    return file !== null && this.isInternalFile(file);
  }

  /** Module symbol of a bare package specifier, resolved from the project. */
  moduleSymbol(moduleName: string): TS.Symbol | undefined {
    const cached = this.moduleCache.get(moduleName);
    if (cached !== undefined) return cached ?? undefined;

    const containing = path.join(
      this.ctx.workspace.projects[0]?.sourceRoot ?? this.ctx.workspace.workspaceRoot,
      '__ngmaze__.ts',
    );
    const resolved = this.ts.resolveModuleName(
      moduleName,
      containing,
      this.ctx.program.getCompilerOptions(),
      this.ts.sys,
    );
    let symbol: TS.Symbol | undefined;
    if (resolved.resolvedModule) {
      const sourceFile = this.ctx.program.getSourceFile(resolved.resolvedModule.resolvedFileName);
      if (sourceFile) symbol = this.checker.getSymbolAtLocation(sourceFile);
    }
    this.moduleCache.set(moduleName, symbol ?? null);
    return symbol;
  }

  /** Exported symbol of a package, alias resolved, e.g. `@angular/core#Component`. */
  packageExport(moduleName: string, exportName: string): TS.Symbol | undefined {
    const key = `${moduleName}#${exportName}`;
    const cached = this.moduleCache.get(key);
    if (cached !== undefined) return cached ?? undefined;

    const moduleSymbol = this.moduleSymbol(moduleName);
    let result: TS.Symbol | undefined;
    if (moduleSymbol) {
      const exported = this.checker.getExportsOfModule(moduleSymbol).find((s) => s.getName() === exportName);
      result = this.resolveAlias(exported);
    }
    this.moduleCache.set(key, result ?? null);
    return result;
  }

  /**
   * Identity check against a package export (plan section 11: `@Component`,
   * `@C` and `@ng.Component` must all be recognised, a local `Component` must
   * not be).
   */
  isPackageExport(symbol: TS.Symbol | undefined, moduleName: string, exportName: string): boolean {
    const resolved = this.resolveAlias(symbol);
    if (!resolved) return false;
    const expected = this.packageExport(moduleName, exportName);
    if (expected && resolved === expected) return true;

    // Identity can fail when a package re-exports through several files; fall
    // back to "same name, declared inside that package".
    if (resolved.getName() !== exportName) return false;
    const file = this.originFile(resolved);
    if (!file) return false;
    return isDeclaredInPackage(file, moduleName);
  }

  /** Type of an expression, used only for receiver origin checks (plan section 21). */
  typeSymbolOf(node: TS.Expression): TS.Symbol | undefined {
    try {
      const type = this.checker.getTypeAtLocation(node);
      const symbol = type.getSymbol() ?? type.aliasSymbol;
      return this.resolveAlias(symbol);
    } catch {
      return undefined;
    }
  }
}

/** Exported for unit tests (plan section 5 requires pnpm style paths to be pinned). */
export function computeIsInternal(fileName: string, workspaceRoot: string): boolean {
  const original = absPosix(fileName);
  const real = realPathSafe(original);
  if (hasNodeModulesSegment(original) || hasNodeModulesSegment(real)) return false;
  if (isInside(workspaceRoot, real)) return true;
  return false;
}

/** `true` when the declaration file sits inside `node_modules/<packageName>`. */
export function isDeclaredInPackage(file: string, packageName: string): boolean {
  return absPosix(file).includes(`/node_modules/${packageName}/`);
}
