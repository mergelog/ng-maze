import type { AnalysisResult, ComponentId } from '../model/types.js';
import { compareCodePoint } from '../util/paths.js';

export type SelectResult =
  | { kind: 'found'; id: ComponentId }
  | { kind: 'not-found'; query: string }
  | { kind: 'ambiguous'; query: string; candidates: ComponentId[]; matchedBy: 'class' | 'selector' };

/**
 * Component selection, plan section 27: ComponentId, then class name, then
 * selector. The first rule that matches anything decides; candidates are never
 * merged across rules.
 */
export function selectComponent(result: AnalysisResult, query: string): SelectResult {
  const normalized = query.replace(/\\/g, '/').trim();

  const byId = result.components.filter((c) => c.id === normalized);
  if (byId.length === 1) return { kind: 'found', id: byId[0]!.id };
  if (byId.length > 1) {
    return { kind: 'ambiguous', query, candidates: byId.map((c) => c.id).sort(compareCodePoint), matchedBy: 'class' };
  }

  const byClass = result.components.filter((c) => c.className === normalized);
  if (byClass.length === 1) return { kind: 'found', id: byClass[0]!.id };
  if (byClass.length > 1) {
    return { kind: 'ambiguous', query, candidates: byClass.map((c) => c.id).sort(compareCodePoint), matchedBy: 'class' };
  }

  const bySelector = result.components.filter((c) => c.selector === normalized);
  if (bySelector.length === 1) return { kind: 'found', id: bySelector[0]!.id };
  if (bySelector.length > 1) {
    return { kind: 'ambiguous', query, candidates: bySelector.map((c) => c.id).sort(compareCodePoint), matchedBy: 'selector' };
  }

  return { kind: 'not-found', query };
}
