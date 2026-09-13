import type { AnalysisResult, ComponentId, ComponentInfo, Edge } from '../model/types.js';
import { compareCodePoint } from '../util/paths.js';

export interface Graph {
  components: Map<ComponentId, ComponentInfo>;
  /** Edges leaving a component, already in display order (plan section 28.1). */
  children: Map<ComponentId, Edge[]>;
  /** Edges entering a component, ordered by parent ComponentId. */
  parents: Map<ComponentId, Edge[]>;
  /** Unique component parents per component (plan section 30). */
  referenceCount: Map<ComponentId, number>;
}

export function buildGraph(result: AnalysisResult): Graph {
  const components = new Map(result.components.map((c) => [c.id, c]));
  const children = new Map<ComponentId, Edge[]>();
  const parents = new Map<ComponentId, Edge[]>();

  for (const edge of result.edges) {
    const outgoing = children.get(edge.from) ?? [];
    outgoing.push(edge);
    children.set(edge.from, outgoing);

    const incoming = parents.get(edge.to) ?? [];
    incoming.push(edge);
    parents.set(edge.to, incoming);
  }

  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  for (const list of parents.values()) {
    list.sort((a, b) => compareCodePoint(a.from, b.from) || a.order - b.order);
  }

  const referenceCount = new Map<ComponentId, number>();
  for (const [id, incoming] of parents) {
    referenceCount.set(id, new Set(incoming.map((e) => e.from)).size);
  }

  return { components, children, parents, referenceCount };
}

/** Root candidates: component in-degree 0. Routes and external usages do not count. */
export function rootCandidates(graph: Graph): ComponentId[] {
  return [...graph.components.keys()]
    .filter((id) => (graph.parents.get(id)?.length ?? 0) === 0)
    .sort(compareCodePoint);
}

export function reachableFrom(graph: Graph, roots: ComponentId[]): Set<ComponentId> {
  const seen = new Set<ComponentId>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.children.get(id) ?? []) stack.push(edge.to);
  }
  return seen;
}
