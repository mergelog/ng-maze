import * as path from 'node:path';
import type * as TS from 'typescript';
import { UserError } from '../model/errors.js';
import { absPosix, relPosix, toPosix } from '../util/paths.js';
import { isExcludedSourceFile, resolveTsconfig, type TsConfigResolution } from './tsconfig.js';
import type { WorkspaceInfo } from './workspace.js';

export interface ProgramContext {
  ts: typeof TS;
  program: TS.Program;
  checker: TS.TypeChecker;
  workspace: WorkspaceInfo;
  tsconfig: TsConfigResolution;
  /** Source files ngmaze scans: internal, non declaration, not excluded. */
  analysisFiles: TS.SourceFile[];
  /** How many candidate files the exclusion rules dropped (plan section 7.3). */
  excludedFileCount: number;
  /** Excluded project sources, retained only for coverage reporting. */
  excludedSourceFiles: string[];
  timings: Record<string, number>;
}

/** compilerOptions ngmaze forces because it never emits (plan section 7.6). */
export function overrideCompilerOptions(options: TS.CompilerOptions): TS.CompilerOptions {
  return {
    ...options,
    noEmit: true,
    skipLibCheck: true,
    incremental: false,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    tsBuildInfoFile: undefined,
    noEmitOnError: false,
  };
}

/**
 * The analysis set, plan section 7.3.
 *
 * tsconfig `fileNames` alone is not enough (an entry point only tsconfig hides
 * every component that nothing imports), and a bare `tsconfig.json` pulls in
 * specs. So the root names are the union of both sources minus the exclusions,
 * while compilerOptions stay owned by the tsconfig.
 */
export function collectRootNames(
  ts: typeof TS,
  workspace: WorkspaceInfo,
  tsconfig: TsConfigResolution,
): { rootNames: string[]; excludedFileCount: number; excludedSourceFiles: string[] } {
  const kept = new Set<string>();
  const seen = new Set<string>();
  let excluded = 0;
  const excludedSourceFiles: string[] = [];

  const consider = (file: string, allowDeclaration: boolean): void => {
    const abs = absPosix(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const relative = relPosix(workspace.workspaceRoot, abs);
    const outside = relative.startsWith('../');
    if (!outside && isExcludedSourceFile(relative)) {
      excluded++;
      excludedSourceFiles.push(abs);
      return;
    }
    if (!allowDeclaration && abs.endsWith('.d.ts')) return;
    kept.add(abs);
  };

  for (const file of tsconfig.parsed.fileNames) consider(file, true);

  const basePath = path.dirname(tsconfig.primary);
  for (const project of workspace.projects) {
    const base = project.sourceRoot || project.root;
    const scanConfig = {
      ...(tsconfig.parsed.raw ?? {}),
      files: undefined,
      references: undefined,
      include: [toPosix(path.relative(basePath, base)) + '/**/*.ts'],
      exclude: (tsconfig.parsed.raw?.exclude ?? []) as string[],
    };
    const scanned = ts.parseJsonConfigFileContent(scanConfig, ts.sys, basePath, undefined, tsconfig.primary);
    for (const file of scanned.fileNames) consider(file, false);
  }

  const rootNames = [...kept].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { rootNames, excludedFileCount: excluded, excludedSourceFiles: [...new Set(excludedSourceFiles)].sort() };
}

/**
 * Preflight, plan section 7.5: without a resolvable `@angular/core` the whole
 * run would silently report "0 components".
 */
function preflight(ts: typeof TS, program: TS.Program, workspace: WorkspaceInfo, tsconfigPath: string): void {
  const options = program.getCompilerOptions();
  const containingFile = path.join(workspace.projects[0]?.sourceRoot ?? workspace.workspaceRoot, '__ngmaze__.ts');
  const resolved = ts.resolveModuleName('@angular/core', containingFile, options, ts.sys);

  const fail = (detail: string): never => {
    // Every CLI message is English; do not reintroduce a mixed-language string.
    throw new UserError(
      `Cannot resolve @angular/core (${detail}). Install the dependencies of the analysed project.\n` +
      `  analysis root : ${workspace.analysisRoot}\n` +
      `  tsconfig      : ${tsconfigPath}`,
    );
  };

  if (!resolved.resolvedModule) fail('module resolution failed');
  const coreFile = absPosix(resolved.resolvedModule!.resolvedFileName);
  const sourceFile = program.getSourceFile(coreFile) ?? program.getSourceFile(resolved.resolvedModule!.resolvedFileName);
  if (!sourceFile) fail('@angular/core is not reachable from the analysed sources');

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile!);
  if (!moduleSymbol) fail('@angular/core exports no symbols');
  const hasComponent = checker.getExportsOfModule(moduleSymbol!).some((s) => s.getName() === 'Component');
  if (!hasComponent) fail('@angular/core does not export Component');
}

export function createProgramContext(
  ts: typeof TS,
  workspace: WorkspaceInfo,
  explicitTsconfig: string | undefined,
): ProgramContext {
  const timings: Record<string, number> = {};

  let started = Date.now();
  const tsconfig = resolveTsconfig(ts, workspace, explicitTsconfig);
  timings.tsconfig = Date.now() - started;

  started = Date.now();
  const { rootNames, excludedFileCount, excludedSourceFiles } = collectRootNames(ts, workspace, tsconfig);
  timings.fileScan = Date.now() - started;

  if (rootNames.length === 0) {
    throw new UserError(
      `No TypeScript source files found for ${workspace.analysisRoot} (tsconfig: ${tsconfig.primary}).`,
    );
  }

  // `tsconfig.options` is the primary tsconfig plus the path aliases of the
  // other projects of the workspace (plan section 7.2).
  const options = overrideCompilerOptions(tsconfig.options);

  started = Date.now();
  // Parent pointers are assigned by the binder when the checker initialises, so
  // eager parent setup (which costs several seconds on a 1500 file project) is
  // not needed. Never touch node.parent before the checker exists.
  const host = ts.createCompilerHost(options, false);
  const program = ts.createProgram({ rootNames, options, host });
  timings.programCreate = Date.now() - started;

  started = Date.now();
  const checker = program.getTypeChecker();
  preflight(ts, program, workspace, tsconfig.primary);
  timings.preflight = Date.now() - started;

  const rootSet = new Set(rootNames);
  const analysisFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && rootSet.has(absPosix(sf.fileName)));

  return {
    ts,
    program,
    checker,
    workspace,
    tsconfig,
    analysisFiles,
    excludedFileCount,
    excludedSourceFiles,
    timings,
  };
}
