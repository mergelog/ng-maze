import type { AmbiguousUsage, AnalysisResult, ComponentId, ComponentInfo, Diagnostic, ExternalUsage, RouteEntry } from '../model/types.js';
import { compareCodePoint } from '../util/paths.js';
import { buildGraph, rootCandidates, reachableFrom, type Graph } from './graph.js';
import { buildTree, collectTreeIds, createTreeBudget, DEFAULT_MAX_TREE_DEPTH, type Direction, type TreeNode } from './tree.js';

export interface ViewOptions {
  component?: string | undefined;
  parents?: boolean;
  depth?: number | undefined;
  all?: boolean;
  ignoreAmbiguous?: boolean;
}

export interface ResultStats {
  components: number;
  templateUsages: number;
  dynamicUsages: number;
  routeEntries: number;
  externalUsages: number;
}

export interface QueryView {
  kind: 'summary' | 'component' | 'all';
  direction: Direction;
  depth: number | undefined;
  graph: Graph;
  /** Present for `kind: "component"`. */
  component?: ComponentInfo;
  tree?: TreeNode;
  /** Present for `kind: "all"`. */
  trees?: TreeNode[];
  unreachable?: ComponentId[];
  rootCandidates: ComponentId[];
  routes: RouteEntry[];
  externalUsages: ExternalUsage[];
  ambiguousUsages: AmbiguousUsage[];
  /** Direct inheritance relations, kept separate from component-use edges. */
  extendsComponent: ComponentInfo | null;
  extendedBy: ComponentInfo[];
  diagnostics: Diagnostic[];
  globalStats: ResultStats;
  resultStats: ResultStats;
  /** Expansion stopped at the node ceiling; the caller should suggest `--depth`. */
  nodeBudgetExceeded: boolean;
  /** The ceiling that was applied, for the message. */
  nodeBudgetLimit: number;
  /** The implicit depth ceiling cut a tree. */
  defaultDepthExceeded: boolean;
  defaultDepthLimit: number;
}

function statsOf(result: AnalysisResult): ResultStats {
  return {
    components: result.components.length,
    templateUsages: result.edges.filter((e) => e.kind === 'template').length,
    dynamicUsages: result.edges.filter((e) => e.kind !== 'template').length,
    routeEntries: result.routes.length,
    externalUsages: result.externalUsages.length,
  };
}

export function buildView(result: AnalysisResult, options: ViewOptions, selectedId?: ComponentId): QueryView {
  const graph = buildGraph(result);
  const budget = createTreeBudget();
  const defaultDepthState = { exceeded: false };
  const direction: Direction = options.parents ? 'parents' : 'children';
  const globalStats = statsOf(result);
  const roots = rootCandidates(graph);
  const visibleAmbiguous = options.ignoreAmbiguous ? [] : result.ambiguousUsages;
  const ambiguousByOwner = new Map<ComponentId, AmbiguousUsage[]>();
  for (const usage of visibleAmbiguous) {
    if (!usage.owner) continue;
    const list = ambiguousByOwner.get(usage.owner) ?? [];
    list.push(usage);
    ambiguousByOwner.set(usage.owner, list);
  }

  if (selectedId) {
    const tree = buildTree(graph, selectedId, { direction, maxDepth: options.depth, ambiguousByOwner, budget, defaultDepthState });
    const ids = collectTreeIds(tree);
    const component = graph.components.get(selectedId)!;
    const routes = result.routes.filter((r) => r.target === selectedId);
    const externalUsages = result.externalUsages.filter((u) => u.target === selectedId);
    const extendsComponent = component.extendsComponent ? graph.components.get(component.extendsComponent) ?? null : null;
    const extendedBy = [...graph.components.values()]
      .filter((candidate) => candidate.extendsComponent === selectedId)
      .sort((a, b) => compareCodePoint(a.id, b.id));
    const edgesInTree = result.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

    return {
      kind: 'component',
      direction,
      depth: options.depth,
      graph,
      component,
      tree,
      rootCandidates: roots,
      routes,
      externalUsages,
      ambiguousUsages: visibleAmbiguous.filter((usage) =>
        (usage.owner !== null && ids.has(usage.owner)) || usage.candidates.includes(selectedId)),
      extendsComponent,
      extendedBy,
      diagnostics: result.diagnostics.filter((d) => d.owner !== null && ids.has(d.owner)),
      globalStats,
      resultStats: {
        components: ids.size,
        templateUsages: edgesInTree.filter((e) => e.kind === 'template').length,
        dynamicUsages: edgesInTree.filter((e) => e.kind !== 'template').length,
        routeEntries: routes.length,
        externalUsages: externalUsages.length,
      },
      nodeBudgetExceeded: budget.exceeded,
      nodeBudgetLimit: budget.limit,
      defaultDepthExceeded: defaultDepthState.exceeded,
      defaultDepthLimit: DEFAULT_MAX_TREE_DEPTH,
    };
  }

  if (options.all) {
    const trees = roots.map((id) => buildTree(graph, id, { direction: 'children', maxDepth: options.depth, ambiguousByOwner, budget, defaultDepthState }));
    const reached = reachableFrom(graph, roots);
    const unreachable = [...graph.components.keys()].filter((id) => !reached.has(id)).sort(compareCodePoint);
    return {
      kind: 'all',
      direction: 'children',
      depth: options.depth,
      graph,
      trees,
      unreachable,
      rootCandidates: roots,
      routes: result.routes,
      externalUsages: result.externalUsages,
      ambiguousUsages: visibleAmbiguous,
      extendsComponent: null,
      extendedBy: [],
      diagnostics: result.diagnostics,
      globalStats,
      resultStats: globalStats,
      nodeBudgetExceeded: budget.exceeded,
      nodeBudgetLimit: budget.limit,
      defaultDepthExceeded: defaultDepthState.exceeded,
      defaultDepthLimit: DEFAULT_MAX_TREE_DEPTH,
    };
  }

  return {
    kind: 'summary',
    direction: 'children',
    depth: options.depth,
    graph,
    rootCandidates: roots,
    routes: result.routes,
    externalUsages: result.externalUsages,
    ambiguousUsages: visibleAmbiguous,
    extendsComponent: null,
    extendedBy: [],
    diagnostics: result.diagnostics,
    globalStats,
    resultStats: globalStats,
    nodeBudgetExceeded: budget.exceeded,
    nodeBudgetLimit: budget.limit,
    defaultDepthExceeded: false,
    defaultDepthLimit: DEFAULT_MAX_TREE_DEPTH,
  };
}

/** Warning counters shown under `Warnings:` (plan section 31). */
export function diagnosticCounts(diagnostics: Diagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((a, b) => compareCodePoint(a[0], b[0])));
}
