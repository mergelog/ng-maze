import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as TS from 'typescript';
import { existsFile, realPathSafe, toPosix } from '../util/paths.js';

/**
 * Resolution of `typescript` / `@angular/compiler` (plan section 1.1).
 *
 * 1. try the analysed project's node_modules
 * 2. use it when found
 * 3. otherwise fall back to the copy bundled with ngmaze
 * 4. report origin and version under `--verbose`
 */
export type ToolSource = 'project' | 'bundled';

export interface Toolchain {
  ts: typeof TS;
  tsVersion: string;
  tsSource: ToolSource;
  tsPath: string;
  ng: AngularCompilerApi;
  ngVersion: string;
  ngSource: ToolSource;
  ngPath: string;
  /** Non fatal notes, e.g. "version outside the contract tested range". */
  warnings: string[];
}

/** Only the pieces of `@angular/compiler` ngmaze is allowed to touch (plan section 2). */
export interface AngularCompilerApi {
  parseTemplate: (...args: any[]) => any;
  CssSelector: any;
  SelectorMatcher: any;
  createCssSelectorFromNode: (node: any) => any;
  TmplAstRecursiveVisitor: any;
  tmplAstVisitAll: (visitor: any, nodes: any[]) => any;
  VERSION?: { full: string };
  [key: string]: unknown;
}

/** Ranges the contract tests in `tests/contract` actually cover. */
export const CONTRACT_TESTED = {
  typescript: /^(5\.[89]|6\.0)\./,
  angularCompiler: /^(20|22)\./,
};

export function supportedToolchain(ngVersion: string, tsVersion: string): boolean {
  const [major, minor] = ngVersion.split('.').map(Number);
  return major === 20
    ? /^5\.8\./.test(tsVersion) || (minor! >= 2 && /^5\.9\./.test(tsVersion))
    : major === 22 && /^6\.0\./.test(tsVersion);
}

function findPackageDir(startDir: string, name: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (existsFile(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Pick an importable entry file from a package.json, preferring ESM. */
function packageEntry(pkgDir: string, pkg: any): string | undefined {
  const fromExports = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return undefined;
    const obj = value as Record<string, unknown>;
    for (const key of ['node', 'import', 'module', 'default', 'require']) {
      if (key in obj) {
        const resolved = fromExports(obj[key]);
        if (resolved) return resolved;
      }
    }
    return undefined;
  };

  const candidates: (string | undefined)[] = [];
  if (pkg.exports) {
    const root = typeof pkg.exports === 'object' && pkg.exports !== null && '.' in pkg.exports
      ? (pkg.exports as Record<string, unknown>)['.']
      : pkg.exports;
    candidates.push(fromExports(root));
  }
  candidates.push(pkg.module, pkg.main, 'index.js');

  for (const candidate of candidates) {
    if (!candidate) continue;
    const file = path.join(pkgDir, candidate);
    if (existsFile(file)) return file;
  }
  return undefined;
}

async function importFile(file: string): Promise<any> {
  const mod = await import(pathToFileURL(file).href);
  return mod?.default ?? mod;
}

async function loadFromProject(startDir: string, name: string): Promise<{ mod: any; dir: string; version: string } | undefined> {
  const dir = findPackageDir(startDir, name);
  if (!dir) return undefined;
  try {
    const pkg = readJson(path.join(dir, 'package.json'));
    const entry = packageEntry(dir, pkg);
    if (!entry) return undefined;
    const mod = await importFile(entry);
    if (!mod) return undefined;
    return { mod, dir, version: String(pkg.version ?? 'unknown') };
  } catch {
    return undefined;
  }
}

export async function loadToolchain(startDir: string): Promise<Toolchain> {
  const warnings: string[] = [];
  // A project may be selected through a worktree/IDE symlink. Module lookup
  // must walk the real project's ancestors, where its node_modules lives.
  startDir = realPathSafe(startDir);

  const projectTs = await loadFromProject(startDir, 'typescript');
  let ts: typeof TS;
  let tsVersion: string;
  let tsSource: ToolSource;
  let tsPath: string;
  if (projectTs && typeof projectTs.mod.createProgram === 'function') {
    ts = projectTs.mod as typeof TS;
    tsVersion = ts.version ?? projectTs.version;
    tsSource = 'project';
    tsPath = toPosix(projectTs.dir);
  } else {
    ts = (await import('typescript')).default as unknown as typeof TS;
    tsVersion = ts.version;
    tsSource = 'bundled';
    tsPath = 'bundled';
  }

  const projectNg = await loadFromProject(startDir, '@angular/compiler');
  let ng: AngularCompilerApi;
  let ngVersion: string;
  let ngSource: ToolSource;
  let ngPath: string;
  if (projectNg && typeof projectNg.mod.parseTemplate === 'function') {
    ng = projectNg.mod as AngularCompilerApi;
    ngVersion = ng.VERSION?.full ?? projectNg.version;
    ngSource = 'project';
    ngPath = toPosix(projectNg.dir);
  } else {
    ng = (await import('@angular/compiler')) as unknown as AngularCompilerApi;
    ngVersion = ng.VERSION?.full ?? 'unknown';
    ngSource = 'bundled';
    ngPath = 'bundled';
  }

  if (!CONTRACT_TESTED.typescript.test(tsVersion)) {
    warnings.push(`typescript ${tsVersion} is outside the contract tested range (5.8.x, 5.9.x, 6.0.x). Analysis continues but this version is unverified.`);
  }
  if (!CONTRACT_TESTED.angularCompiler.test(ngVersion)) {
    warnings.push(`@angular/compiler ${ngVersion} is outside the contract tested range (20.x, 22.x). Analysis continues but this version is unverified.`);
  }
  if (CONTRACT_TESTED.typescript.test(tsVersion) && CONTRACT_TESTED.angularCompiler.test(ngVersion) &&
    !supportedToolchain(ngVersion, tsVersion)) {
    warnings.push(`typescript ${tsVersion} / @angular/compiler ${ngVersion} is outside the tested version combinations. ` +
      'Angular 20.0/20.1 uses TS 5.8, Angular 20.2/20.3 uses TS 5.8/5.9, Angular 22 uses TS 6.0.');
  }

  return { ts, tsVersion, tsSource, tsPath, ng, ngVersion, ngSource, ngPath, warnings };
}
