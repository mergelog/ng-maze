import type { AmbiguousUsage, ComponentId, Edge } from '../model/types.js';
import { compareCodePoint } from '../util/paths.js';
import type { Graph } from './graph.js';

export type Direction = 'children' | 'parents';

export interface TreeNode {
  id: ComponentId;
  /** Edges that connect this node to its parent in the tree. */
  occurrences: Edge[];
  children: TreeNode[];
  /** Unresolved dynamic component usages owned by this real component. */
  ambiguousChildren: AmbiguousUsage[];
  /** The node closes a cycle on the current path (plan section 12 / 28). */
  cycle: boolean;
  /** Expansion stopped because of an explicit or default depth limit, or node budget. */
  truncated: boolean;
}

export interface TreeOptions {
  direction: Direction;
  /** `undefined` uses the safe default depth ceiling. */
  maxDepth?: number | undefined;
  ambiguousByOwner?: ReadonlyMap<ComponentId, AmbiguousUsage[]> | undefined;
  /** Shared node budget, so `--all` cannot blow up across many roots. */
  budget?: TreeBudget | undefined;
  /** Records that the default depth ceiling, rather than --depth, cut a tree. */
  defaultDepthState?: TreeDepthState | undefined;
}

/**
 * A DAG is expanded into a tree, so a graph whose components are shared by
 * several parents (a design system, for instance) has a node count that grows
 * with the number of paths, not with the number of components. Without a
 * ceiling an unlimited-depth query on such a project exhausts memory instead of
 * printing anything, so expansion stops at `limit` nodes and the frontier is
 * reported as truncated exactly like `--depth` does.
 */
export interface TreeBudget {
  limit: number;
  remaining: number;
  exceeded: boolean;
}

/** Node ceiling for one query, shared by every root of `--all`. */
export const DEFAULT_MAX_TREE_NODES = 200_000;

/**
 * A tree is rendered with indentation, so depth is an output-size limit as
 * well as a traversal limit. Keep the default comfortably below V8's stack
 * limit even though all walks below are iterative.
 */
export const DEFAULT_MAX_TREE_DEPTH = 1_000;
/** CLI values are capped here too: JSON serialization is stack-based in V8. */
export const MAX_TREE_DEPTH = DEFAULT_MAX_TREE_DEPTH;

export interface TreeDepthState {
  exceeded: boolean;
}

export function createTreeBudget(limit = DEFAULT_MAX_TREE_NODES): TreeBudget {
  return { limit, remaining: limit, exceeded: false };
}

/**
 * Groups edges by the component on the other side, keeping every occurrence
 * (plan sections 9 / 24 / 25).
 */
function groupEdges(edges: Edge[], direction: Direction): { id: ComponentId; occurrences: Edge[] }[] {
  const groups = new Map<ComponentId, Edge[]>();
  for (const edge of edges) {
    const other = direction === 'children' ? edge.to : edge.from;
    const list = groups.get(other) ?? [];
    list.push(edge);
    groups.set(other, list);
  }
  const entries = [...groups.entries()].map(([id, occurrences]) => ({ id, occurrences }));
  if (direction === 'parents') {
    // No natural source order exists upwards, so fix it by ComponentId.
    entries.sort((a, b) => compareCodePoint(a.id, b.id));
  }
  return entries;
}

export function buildTree(graph: Graph, rootId: ComponentId, options: TreeOptions): TreeNode {
  const budget = options.budget;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_TREE_DEPTH;
  const linksOf = (id: ComponentId): Edge[] =>
    (options.direction === 'children' ? graph.children.get(id) : graph.parents.get(id)) ?? [];
  const ambiguousOf = (id: ComponentId): AmbiguousUsage[] =>
    options.direction === 'children' ? options.ambiguousByOwner?.get(id) ?? [] : [];

  let root: TreeNode | undefined;
  const ancestors = new Set<ComponentId>();
  type Visit = { type: 'visit'; id: ComponentId; occurrences: Edge[]; depth: number; parent?: TreeNode };
  type Exit = { type: 'exit'; id: ComponentId };
  const stack: Array<Visit | Exit> = [{ type: 'visit', id: rootId, occurrences: [], depth: 0 }];

  const attach = (node: TreeNode, parent: TreeNode | undefined): void => {
    if (parent) parent.children.push(node);
    else root = node;
  };

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.type === 'exit') {
      ancestors.delete(item.id);
      continue;
    }

    if (ancestors.has(item.id)) {
      attach({ id: item.id, occurrences: item.occurrences, children: [], ambiguousChildren: [], cycle: true, truncated: false }, item.parent);
      continue;
    }

    const edges = linksOf(item.id);
    const ambiguousChildren = ambiguousOf(item.id);
    if (budget && budget.remaining <= 0) {
      budget.exceeded = true;
      attach({ id: item.id, occurrences: item.occurrences, children: [], ambiguousChildren: [], cycle: false, truncated: Boolean(edges.length) }, item.parent);
      continue;
    }
    if (budget) budget.remaining--;

    if (item.depth >= maxDepth) {
      if (options.maxDepth === undefined && (edges.length > 0 || ambiguousChildren.length > 0)) {
        if (options.defaultDepthState) options.defaultDepthState.exceeded = true;
      }
      attach({ id: item.id, occurrences: item.occurrences, children: [], ambiguousChildren: [], cycle: false,
        truncated: Boolean(edges.length || ambiguousChildren.length) }, item.parent);
      continue;
    }

    const node: TreeNode = { id: item.id, occurrences: item.occurrences, children: [], ambiguousChildren, cycle: false, truncated: false };
    attach(node, item.parent);
    ancestors.add(item.id);
    stack.push({ type: 'exit', id: item.id });
    const groups = groupEdges(edges, options.direction);
    for (let index = groups.length - 1; index >= 0; index--) {
      const group = groups[index]!;
      stack.push({ type: 'visit', id: group.id, occurrences: group.occurrences, depth: item.depth + 1, parent: node });
    }
  }

  return root!;
}

/** Every component id appearing in a tree, for the per result stats (plan section 32). */
export function collectTreeIds(node: TreeNode, into = new Set<ComponentId>()): Set<ComponentId> {
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    into.add(current.id);
    for (const child of current.children) stack.push(child);
  }
  return into;
}
