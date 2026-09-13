import type { AnalysisResult, ComponentId, Diagnostic, Edge, SourceLocation } from '../model/types.js';
import type { QueryView, ResultStats } from '../query/view.js';
import type { TreeNode } from '../query/tree.js';
import { collectTreeIds } from '../query/tree.js';

export interface JsonQuery {
  component: string | null;
  direction: 'children' | 'parents';
  depth: number | null;
  all: boolean;
  why: boolean;
  ignoreAmbiguous?: boolean;
}

export interface JsonError {
  code: 'not-found' | 'ambiguous';
  message: string;
  candidates: ComponentId[];
}

interface JsonTreeNode {
  id: ComponentId;
  className: string;
  cycle: boolean;
  truncated: boolean;
  occurrences: { kind: Edge['kind']; location: SourceLocation }[];
  children: JsonTreeNode[];
  ambiguousChildren: AnalysisResult['ambiguousUsages'];
}

/**
 * JSON output, plan section 32.
 *
 * `global` and `result` are separate so "the project has 352 components" is
 * never confused with "this tree has 18". No timing value enters the document so
 * reruns diff cleanly.
 */
export function renderJson(
  view: QueryView | null,
  result: AnalysisResult,
  query: JsonQuery,
  version: string,
  error: JsonError | null,
): string {
  const document: Record<string, unknown> = {
    ngmazeVersion: version,
    query: { ...query, ignoreAmbiguous: query.ignoreAmbiguous ?? false },
    meta: result.meta,
    global: {
      stats: globalStats(result),
      diagnostics: result.diagnostics,
      detectionGaps: result.detectionGaps,
    },
    result: view ? resultSection(view, result) : emptyResult(),
    error,
  };
  return JSON.stringify(document, null, 2) + '\n';
}

function globalStats(result: AnalysisResult): ResultStats {
  return {
    components: result.components.length,
    templateUsages: result.edges.filter((e) => e.kind === 'template').length,
    dynamicUsages: result.edges.filter((e) => e.kind !== 'template').length,
    routeEntries: result.routes.length,
    externalUsages: result.externalUsages.length,
  };
}

function emptyResult(): Record<string, unknown> {
  return {
    stats: { components: 0, templateUsages: 0, dynamicUsages: 0, routeEntries: 0, externalUsages: 0 },
    rootCandidates: [],
    components: [],
    edges: [],
    routes: [],
    externalUsages: [],
    ambiguousUsages: [],
    tree: null,
    trees: [],
    unreachable: [],
    diagnostics: [] as Diagnostic[],
  };
}

function toJsonTree(view: QueryView, node: TreeNode): JsonTreeNode {
  const root: JsonTreeNode = {
    id: node.id, className: view.graph.components.get(node.id)?.className ?? node.id,
    cycle: node.cycle, truncated: node.truncated,
    occurrences: node.occurrences.map((occurrence) => ({ kind: occurrence.kind, location: occurrence.location })),
    children: [], ambiguousChildren: node.ambiguousChildren,
  };
  const stack: Array<{ source: TreeNode; target: JsonTreeNode }> = [{ source: node, target: root }];
  while (stack.length > 0) {
    const { source, target } = stack.pop()!;
    for (const child of source.children) {
      const converted: JsonTreeNode = {
        id: child.id, className: view.graph.components.get(child.id)?.className ?? child.id,
        cycle: child.cycle, truncated: child.truncated,
        occurrences: child.occurrences.map((occurrence) => ({ kind: occurrence.kind, location: occurrence.location })),
        children: [], ambiguousChildren: child.ambiguousChildren,
      };
      target.children.push(converted);
      stack.push({ source: child, target: converted });
    }
  }
  return root;
}

function resultSection(view: QueryView, result: AnalysisResult): Record<string, unknown> {
  const ids = new Set<ComponentId>();
  if (view.tree) collectTreeIds(view.tree, ids);
  for (const tree of view.trees ?? []) collectTreeIds(tree, ids);
  if (view.kind !== 'component') {
    for (const component of result.components) ids.add(component.id);
  }

  const edges = result.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

  return {
    stats: view.resultStats,
    rootCandidates: view.rootCandidates,
    components: result.components.filter((component) => ids.has(component.id)),
    edges,
    routes: view.routes,
    externalUsages: view.externalUsages,
    ambiguousUsages: view.ambiguousUsages,
    tree: view.tree ? toJsonTree(view, view.tree) : null,
    trees: (view.trees ?? []).map((tree) => toJsonTree(view, tree)),
    unreachable: view.unreachable ?? [],
    diagnostics: view.diagnostics,
  };
}
