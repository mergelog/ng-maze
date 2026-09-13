import type { AmbiguousUsage, AnalysisResult, DetectionGap, Diagnostic, Edge, ExternalUsage, RouteEntry } from '../model/types.js';
import { EDGE_KIND_ORDER } from '../model/types.js';
import { compareCodePoint, realPathSafe, relPosix } from '../util/paths.js';
import { createCompilerAdapter } from '../angular/compiler-adapter.js';
import { createProgramContext, type ProgramContext } from '../project/program.js';
import { resolveWorkspace } from '../project/workspace.js';
import { loadToolchain } from '../toolchain/load.js';
import { buildCatalog } from './catalog.js';
import { analyzeDynamic } from './dynamic.js';
import { StaticEvaluator } from './evaluator.js';
import { analyzeRoutes } from './routes.js';
import { ScopeEngine } from './scope.js';
import { SymbolResolver } from './symbols.js';
import { analyzeTemplates } from './templates.js';

export interface AnalyzeOptions {
  project?: string | undefined;
  angularProject?: string | undefined;
  tsconfig?: string | undefined;
}

export interface AnalysisRun {
  result: AnalysisResult;
  /** Milliseconds per phase, reported under `--verbose` only (plan section 32). */
  timings: Record<string, number>;
  warnings: string[];
  context: ProgramContext;
}

const compareLocation = (a: { file: string; line: number; column: number }, b: { file: string; line: number; column: number }): number =>
  compareCodePoint(a.file, b.file) || a.line - b.line || a.column - b.column;

export async function analyze(options: AnalyzeOptions): Promise<AnalysisRun> {
  const startedAt = Date.now();
  const timings: Record<string, number> = {};

  let started = Date.now();
  const toolchain = await loadToolchain(realPathSafe(options.project ?? process.cwd()));
  timings.toolchain = Date.now() - started;

  const workspace = resolveWorkspace(toolchain.ts, options);
  const context = createProgramContext(toolchain.ts, workspace, options.tsconfig);
  Object.assign(timings, context.timings);

  const adapter = createCompilerAdapter(toolchain.ng);
  const symbols = new SymbolResolver(context);
  const evaluator = new StaticEvaluator(toolchain.ts, symbols);

  started = Date.now();
  const catalog = buildCatalog(context, symbols, evaluator);
  timings.catalog = Date.now() - started;

  const scopes = new ScopeEngine(catalog);

  started = Date.now();
  const templates = analyzeTemplates(context, adapter, catalog, scopes);
  timings.templates = Date.now() - started;

  started = Date.now();
  const routes = analyzeRoutes(context, symbols, evaluator, catalog);
  timings.routes = Date.now() - started;

  started = Date.now();
  const dynamic = analyzeDynamic(context, symbols, evaluator, catalog, templates.outletCandidates);
  timings.dynamic = Date.now() - started;

  const edges = normalizeEdges([...templates.edges, ...dynamic.edges]);

  const diagnostics = sortDiagnostics([
    ...catalog.diagnostics,
    ...scopes.diagnostics,
    ...templates.diagnostics,
    ...routes.diagnostics,
    ...dynamic.diagnostics,
  ]);
  const detectionGaps = sortGaps([
    ...catalog.detectionGaps,
    ...templates.detectionGaps,
    ...routes.detectionGaps,
    ...dynamic.detectionGaps,
    ...workspace.skippedNestedWorkspacePaths.map((file) => ({
      code: 'nested-workspace' as const,
      message: 'Nested Angular workspace was not analysed with the enclosing workspace; analyse it with -p directly.',
      file: relPosix(workspace.workspaceRoot, file),
      location: { file: relPosix(workspace.workspaceRoot, file), line: 1, column: 1, precision: 'exact' as const },
      owner: null,
      candidates: [],
    })),
  ]);

  const result: AnalysisResult = {
    meta: {
      workspaceRoot: workspace.workspaceRoot,
      analysisRoot: workspace.analysisRoot,
      angularProjects: workspace.projects.map((p) => p.name).sort(compareCodePoint),
      tsconfigFiles: [context.tsconfig.primary, ...context.tsconfig.merged]
        .map((file) => relPosix(workspace.workspaceRoot, file)),
      typescriptVersion: toolchain.tsVersion,
      typescriptSource: toolchain.tsSource,
      angularCompilerVersion: toolchain.ngVersion,
      angularCompilerSource: toolchain.ngSource,
      sourceFileCount: context.analysisFiles.length,
      excludedFileCount: context.excludedFileCount,
      templateFileCount: templates.templateFileCount,
    },
    components: [...catalog.components.values()].map((r) => r.info).sort((a, b) => compareCodePoint(a.id, b.id)),
    ngModules: [...catalog.ngModules.values()].map((r) => r.info).sort((a, b) => compareCodePoint(a.id, b.id)),
    edges,
    routes: sortRoutes(routes.routes),
    externalUsages: sortExternalUsages(dynamic.externalUsages),
    ambiguousUsages: sortAmbiguousUsages(dynamic.ambiguousUsages),
    diagnostics,
    detectionGaps,
  };

  timings.total = Date.now() - startedAt;
  const nestedWarnings = workspace.skippedNestedWorkspacePaths.length === 0 ? [] : [
    `nested Angular workspace(s) below ${workspace.analysisRoot} were not analysed; run -p on each workspace to include them.`,
  ];
  return { result, timings, warnings: [...toolchain.warnings, ...context.tsconfig.warnings, ...nestedWarnings], context };
}

function sortAmbiguousUsages(usages: AmbiguousUsage[]): AmbiguousUsage[] {
  return [...usages].sort((a, b) =>
    compareLocation(a.location, b.location)
    || compareCodePoint(a.kind, b.kind)
    || compareCodePoint(a.expression, b.expression));
}

function sortGaps(gaps: DetectionGap[]): DetectionGap[] {
  return [...gaps].sort((a, b) =>
    compareLocation(a.location, b.location)
    || compareCodePoint(a.code, b.code)
    || compareCodePoint(a.message, b.message));
}

/**
 * Deterministic edge order, plan section 28.1: kind groups first, source order
 * inside a group. `order` is renumbered per parent so renderers never sort again.
 */
export function normalizeEdges(edges: Edge[]): Edge[] {
  const byParent = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = byParent.get(edge.from) ?? [];
    list.push(edge);
    byParent.set(edge.from, list);
  }

  const result: Edge[] = [];
  for (const parent of [...byParent.keys()].sort(compareCodePoint)) {
    const list = byParent.get(parent)!;
    list.sort((a, b) => {
      const kindDelta = EDGE_KIND_ORDER.indexOf(a.kind) - EDGE_KIND_ORDER.indexOf(b.kind);
      if (kindDelta !== 0) return kindDelta;
      return compareLocation(a.location, b.location) || compareCodePoint(a.to, b.to);
    });
    list.forEach((edge, index) => {
      result.push({ ...edge, order: index });
    });
  }
  return result;
}

function sortRoutes(routes: RouteEntry[]): RouteEntry[] {
  return [...routes].sort((a, b) =>
    compareLocation(a.location, b.location) || compareCodePoint(a.path, b.path) || compareCodePoint(a.target, b.target));
}

function sortExternalUsages(usages: ExternalUsage[]): ExternalUsage[] {
  return [...usages].sort((a, b) =>
    compareCodePoint(a.target, b.target)
    || compareLocation(a.location, b.location)
    || compareCodePoint(a.callerName, b.callerName));
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) =>
    compareLocation(a.location, b.location)
    || compareCodePoint(a.code, b.code)
    || compareCodePoint(a.message, b.message));
}
