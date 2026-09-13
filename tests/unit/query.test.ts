import { describe, expect, it } from 'vitest';
import type { AnalysisResult, ComponentInfo, Edge, SourceLocation } from '../../src/model/types.js';
import { normalizeEdges } from '../../src/analysis/analyze.js';
import { buildGraph, rootCandidates } from '../../src/query/graph.js';
import { buildTree, createTreeBudget, type TreeNode } from '../../src/query/tree.js';
import { buildView } from '../../src/query/view.js';
import { renderText } from '../../src/render/text.js';
import { renderMarkdown } from '../../src/render/markdown.js';
import { renderJson } from '../../src/render/json.js';
import { selectComponent } from '../../src/query/select.js';

const location = (file: string, line: number, column = 1): SourceLocation => ({ file, line, column, precision: 'exact' });

const component = (id: string, className: string, selector: string | null): ComponentInfo => ({
  id,
  className,
  extendsComponent: null,
  selector,
  selectorUnresolved: false,
  templateKind: 'inline',
  templateFile: null,
  effectiveStandalone: true,
  standaloneExplicit: null,
  angularProject: 'app',
  file: `/ws/${id.split('#')[0]}`,
  location: location(id.split('#')[0]!, 1),
});

const edge = (from: string, to: string, kind: Edge['kind'], line: number): Edge =>
  ({ from, to, kind, location: location('a.html', line), order: 0 });

const result = (components: ComponentInfo[], edges: Edge[]): AnalysisResult => ({
  meta: {
    workspaceRoot: '/ws', analysisRoot: '/ws', angularProjects: ['app'], tsconfigFiles: [],
    typescriptVersion: '6.0.3', typescriptSource: 'project', angularCompilerVersion: '22.1.5',
    angularCompilerSource: 'project', sourceFileCount: 0, excludedFileCount: 0, templateFileCount: 0,
  },
  components,
  ngModules: [],
  edges: normalizeEdges(edges),
  routes: [],
  externalUsages: [],
  ambiguousUsages: [],
  diagnostics: [],
  detectionGaps: [],
});

describe('edge ordering (plan section 28.1)', () => {
  it('groups by kind and keeps source order inside a group', () => {
    const edges = normalizeEdges([
      edge('a.ts#A', 'c.ts#C', 'dialog', 50),
      edge('a.ts#A', 'b.ts#B', 'template', 20),
      edge('a.ts#A', 'd.ts#D', 'ng-component-outlet', 5),
      edge('a.ts#A', 'e.ts#E', 'template', 10),
      edge('a.ts#A', 'f.ts#F', 'create-component', 1),
    ]);
    expect(edges.map((e) => `${e.kind}:${e.location.line}`)).toEqual([
      'template:10', 'template:20', 'ng-component-outlet:5', 'dialog:50', 'create-component:1',
    ]);
    expect(edges.map((e) => e.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it('is stable when the same input arrives in a different order', () => {
    const input = [
      edge('a.ts#A', 'b.ts#B', 'template', 20),
      edge('a.ts#A', 'c.ts#C', 'template', 20),
    ];
    const forward = normalizeEdges(input).map((e) => e.to);
    const backward = normalizeEdges([...input].reverse()).map((e) => e.to);
    expect(forward).toEqual(backward);
  });
});

describe('reference count (plan section 30)', () => {
  it('counts unique parents, not occurrences', () => {
    const graph = buildGraph(result(
      [component('a.ts#A', 'A', 'a'), component('b.ts#B', 'B', 'b'), component('c.ts#C', 'C', 'c')],
      [
        edge('a.ts#A', 'c.ts#C', 'template', 1),
        edge('a.ts#A', 'c.ts#C', 'template', 2),
        edge('a.ts#A', 'c.ts#C', 'template', 3),
        edge('b.ts#B', 'c.ts#C', 'template', 4),
      ],
    ));
    expect(graph.referenceCount.get('c.ts#C')).toBe(2);
    expect(graph.children.get('a.ts#A')).toHaveLength(3);
  });

  it('reports components with no component parent as roots', () => {
    const graph = buildGraph(result(
      [component('a.ts#A', 'A', 'a'), component('b.ts#B', 'B', 'b')],
      [edge('a.ts#A', 'b.ts#B', 'template', 1)],
    ));
    expect(rootCandidates(graph)).toEqual(['a.ts#A']);
  });
});

describe('tree building (plan sections 11, 12, 28)', () => {
  const graph = buildGraph(result(
    [
      component('a.ts#A', 'A', 'a'), component('b.ts#B', 'B', 'b'),
      component('c.ts#C', 'C', 'c'), component('s.ts#S', 'S', 's'),
    ],
    [
      edge('a.ts#A', 'b.ts#B', 'template', 1),
      edge('a.ts#A', 'c.ts#C', 'template', 2),
      edge('b.ts#B', 's.ts#S', 'template', 3),
      edge('c.ts#C', 's.ts#S', 'template', 4),
      edge('s.ts#S', 'a.ts#A', 'template', 5),
    ],
  ));

  it('keeps a shared component on every path', () => {
    const tree = buildTree(graph, 'a.ts#A', { direction: 'children' });
    expect(tree.children.map((c) => c.id)).toEqual(['b.ts#B', 'c.ts#C']);
    expect(tree.children[0]!.children[0]!.id).toBe('s.ts#S');
    expect(tree.children[1]!.children[0]!.id).toBe('s.ts#S');
  });

  it('stops at a cycle instead of recursing', () => {
    const tree = buildTree(graph, 'a.ts#A', { direction: 'children' });
    const cycleNode = tree.children[0]!.children[0]!.children[0]!;
    expect(cycleNode.id).toBe('a.ts#A');
    expect(cycleNode.cycle).toBe(true);
    expect(cycleNode.children).toEqual([]);
  });

  it('marks depth limited nodes', () => {
    const tree = buildTree(graph, 'a.ts#A', { direction: 'children', maxDepth: 1 });
    expect(tree.children.map((c) => c.truncated)).toEqual([true, true]);
    expect(tree.children[0]!.children).toEqual([]);
  });

  it('walks parents with the same cycle rule and a fixed order', () => {
    const tree = buildTree(graph, 's.ts#S', { direction: 'parents' });
    expect(tree.children.map((c) => c.id)).toEqual(['b.ts#B', 'c.ts#C']);
    expect(tree.children[0]!.children[0]!.id).toBe('a.ts#A');
  });

  it('groups repeated occurrences of the same child', () => {
    const repeated = buildGraph(result(
      [component('a.ts#A', 'A', 'a'), component('b.ts#B', 'B', 'b')],
      [
        edge('a.ts#A', 'b.ts#B', 'template', 1),
        edge('a.ts#A', 'b.ts#B', 'template', 2),
      ],
    ));
    const tree = buildTree(repeated, 'a.ts#A', { direction: 'children' });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.occurrences).toHaveLength(2);
  });
});

describe('component selection (plan section 27)', () => {
  const analysis = result(
    [
      component('src/a/app.component.ts#AppComponent', 'AppComponent', 'app-root'),
      component('src/b/app.component.ts#AppComponent', 'AppComponent', 'other-root'),
      component('src/c/leaf.component.ts#LeafComponent', 'LeafComponent', 'leaf'),
    ],
    [],
  );

  it('prefers an exact ComponentId', () => {
    expect(selectComponent(analysis, 'src/a/app.component.ts#AppComponent')).toEqual({
      kind: 'found', id: 'src/a/app.component.ts#AppComponent',
    });
  });

  it('reports every candidate for an ambiguous class name', () => {
    const selection = selectComponent(analysis, 'AppComponent');
    expect(selection.kind).toBe('ambiguous');
    expect(selection.kind === 'ambiguous' && selection.candidates).toHaveLength(2);
  });

  it('falls back to the selector only when the class name matched nothing', () => {
    expect(selectComponent(analysis, 'leaf')).toEqual({ kind: 'found', id: 'src/c/leaf.component.ts#LeafComponent' });
  });

  it('reports not found', () => {
    expect(selectComponent(analysis, 'NopeComponent').kind).toBe('not-found');
  });

  it('accepts a ComponentId written with backslashes', () => {
    expect(selectComponent(analysis, 'src\\a\\app.component.ts#AppComponent')).toEqual({
      kind: 'found', id: 'src/a/app.component.ts#AppComponent',
    });
  });
});

/**
 * Issue 32, F-01: a heavily shared graph expands into a tree whose node count
 * grows with the number of paths. Without a ceiling an unlimited query dies on
 * memory, and the renderers used to overflow the argument stack on the result.
 */
describe('node ceiling on a shared graph (issue 32, F-01)', () => {
  const LEVELS = 20;

  const sharedDagResult = (): AnalysisResult => {
    const components: ComponentInfo[] = [];
    const edges: Edge[] = [];
    for (let level = 0; level <= LEVELS; level++) {
      for (const side of ['a', 'b']) {
        const id = `l${level}${side}.ts#L${level}${side}`;
        components.push(component(id, `L${level}${side}`, `l${level}${side}`));
        if (level === LEVELS) continue;
        // Both components of the next level are used by both of this level.
        for (const next of ['a', 'b']) {
          edges.push(edge(id, `l${level + 1}${next}.ts#L${level + 1}${next}`, 'template', level + 1));
        }
      }
    }
    return result(components, edges);
  };

  const graph = buildGraph(sharedDagResult());

  it('stops expanding at the budget and marks the frontier truncated', () => {
    const budget = createTreeBudget(5_000);
    const tree = buildTree(graph, 'l0a.ts#L0a', { direction: 'children', budget });
    expect(budget.exceeded).toBe(true);
    expect(budget.remaining).toBe(0);

    let nodes = 0;
    let truncated = 0;
    const walk = (node: TreeNode): void => {
      nodes++;
      if (node.truncated) truncated++;
      for (const child of node.children) walk(child);
    };
    walk(tree);
    // The frontier nodes are still emitted (as truncated leaves) after the
    // budget is spent, so the total is bounded by the budget, not equal to it.
    expect(nodes).toBeGreaterThan(4_000);
    expect(nodes).toBeLessThan(10_000);
    expect(truncated).toBeGreaterThan(0);
  });

  it('renders a tree of that size without overflowing the argument stack', () => {
    const view = buildView(sharedDagResult(), { component: 'L0a' }, 'l0a.ts#L0a');
    expect(view.nodeBudgetExceeded).toBe(true);
    expect(() => renderText(view, { why: false, color: false })).not.toThrow();
    expect(() => renderMarkdown(view, { outputRoot: '/ws', treeStyle: 'list' })).not.toThrow();
    expect(() => renderMarkdown(view, { outputRoot: '/ws', treeStyle: 'box' })).not.toThrow();
  });
});

describe('deep linear graph safety (issue 33, F-01)', () => {
  it('truncates 15,000 nodes at the default depth without consuming the call stack', () => {
    const count = 15_000;
    const components: ComponentInfo[] = [];
    const edges: Edge[] = [];
    for (let index = 0; index < count; index++) {
      const id = `deep/${index}.ts#C${index}`;
      components.push(component(id, `C${index}`, `c-${index}`));
      if (index < count - 1) edges.push(edge(id, `deep/${index + 1}.ts#C${index + 1}`, 'template', index + 1));
    }
    const analysis = result(components, edges);
    const graph = buildGraph(analysis);
    expect(() => buildTree(graph, 'deep/0.ts#C0', { direction: 'children' })).not.toThrow();

    const view = buildView(analysis, { component: 'C0' }, 'deep/0.ts#C0');
    expect(view.defaultDepthExceeded).toBe(true);
    expect(view.tree).toBeDefined();
    expect(() => renderText(view, { why: false, color: false })).not.toThrow();
    expect(() => renderMarkdown(view, { outputRoot: '/ws', treeStyle: 'list' })).not.toThrow();
    expect(() => renderMarkdown(view, { outputRoot: '/ws', treeStyle: 'box' })).not.toThrow();
    expect(() => renderJson(view, analysis, {
      component: 'C0', direction: 'children', depth: null, all: false, why: false,
    }, '0.0.0', null)).not.toThrow();
  }, 30_000);
});
