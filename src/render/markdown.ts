import * as path from 'node:path';
import type { ComponentId } from '../model/types.js';
import type { QueryView } from '../query/view.js';
import type { TreeNode } from '../query/tree.js';
import { relPosix } from '../util/paths.js';

export interface MarkdownOptions {
  /** Directory containing the generated Markdown document. */
  outputRoot: string;
  /** Nested lists, plain box trees, or an HTML <pre> box tree. */
  treeStyle: 'list' | 'box' | 'html';
}

/**
 * Renders the component tree as nested Markdown lists. Unlike a box-drawing
 * tree with forced line breaks, this structure survives Markdown formatters
 * while keeping every class label clickable.
 */
export function renderMarkdown(view: QueryView, options: MarkdownOptions): string {
  const componentOf = (id: ComponentId) => view.graph.components.get(id);
  const html = options.treeStyle === 'html';

  // Class names are not unique across a workspace; the link target is, but a
  // reader only sees the text. Duplicated names therefore carry their directory.
  const nameCounts = new Map<string, number>();
  for (const component of view.graph.components.values()) {
    nameCounts.set(component.className, (nameCounts.get(component.className) ?? 0) + 1);
  }

  const escapeHtml = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const parentPathOf = (id: ComponentId): string => {
    const component = componentOf(id);
    if (!component) return '';

    let relative = relPosix(options.outputRoot, path.dirname(component.file));
    if (relative === '.') return './';
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return relative.endsWith('/') ? relative : `${relative}/`;
  };

  const linkToComponent = (id: ComponentId): string => {
    const component = componentOf(id);
    if (!component) return id;

    let relative = relPosix(options.outputRoot, component.file);
    if (!relative.startsWith('.')) relative = `./${relative}`;
    const href = relative.split('/').map(encodeURIComponent).join('/');
    const ambiguous = (nameCounts.get(component.className) ?? 0) > 1;
    const suffix = ambiguous ? parentPathOf(id) : '';
    if (html) {
      const link = `<a href="${escapeHtml(href)}">${escapeHtml(component.className)}</a>`;
      return suffix ? `${link} <code>${escapeHtml(suffix)}</code>` : link;
    }
    const link = `[${component.className}](<${href}>)`;
    return suffix ? `${link} \`${suffix}\`` : link;
  };

  /** Same information as the text renderer's occurrence suffix (plan section 25). */
  const kindSuffix = (node: TreeNode): string => {
    const kinds = new Map<string, number>();
    for (const occurrence of node.occurrences) kinds.set(occurrence.kind, (kinds.get(occurrence.kind) ?? 0) + 1);
    if (![...kinds.keys()].some((kind) => kind !== 'template')) return '';
    const label = kinds.size === 1
      ? `[${[...kinds.keys()][0]}]`
      : `[${[...kinds.entries()].map(([kind, count]) => `${kind}×${count}`).join(', ')}]`;
    return ` ${label}`;
  };

  const treeLabel = (node: TreeNode, isRoot = false): string => {
    const references = view.graph.referenceCount.get(node.id) ?? 0;
    let label = linkToComponent(node.id);
    const base = componentOf(node.id)?.extendsComponent;
    if (base) label += ` [extends ${linkToComponent(base)}]`;
    if (node.occurrences.length > 1) label += ` ×${node.occurrences.length}`;
    label += kindSuffix(node);
    if (!isRoot && references > 1) label += ` (参照元: ${references})`;
    if (node.cycle) label += ' [cycle]';
    if (node.truncated) label += ' [...]';
    return label;
  };

  const ambiguousLabel = (usage: TreeNode['ambiguousChildren'][number]): string => {
    const candidates = usage.candidates.length > 0
      ? `; candidates: ${usage.candidates.map(linkToComponent).join(' | ')}`
      : '; target unresolved';
    return `⚠ Ambiguous component [${usage.kind}] \`${usage.expression}\`${candidates}`;
  };

  const renderChildren = (root: TreeNode): string[] => {
    const lines: string[] = [];
    type NodeWork = { type: 'node'; node: TreeNode; depth: number };
    type UsageWork = { type: 'usage'; usage: TreeNode['ambiguousChildren'][number]; depth: number };
    const stack: Array<NodeWork | UsageWork> = [];
    for (let index = root.ambiguousChildren.length - 1; index >= 0; index--) stack.push({ type: 'usage', usage: root.ambiguousChildren[index]!, depth: 0 });
    for (let index = root.children.length - 1; index >= 0; index--) stack.push({ type: 'node', node: root.children[index]!, depth: 0 });
    while (stack.length > 0) {
      const work = stack.pop()!;
      if (work.type === 'usage') {
        lines.push(`${'  '.repeat(work.depth)}- ${ambiguousLabel(work.usage)}`);
        continue;
      }
      const { node, depth } = work;
      lines.push(`${'  '.repeat(depth)}- ${treeLabel(node)}`);
      for (let index = node.ambiguousChildren.length - 1; index >= 0; index--) {
        stack.push({ type: 'usage', usage: node.ambiguousChildren[index]!, depth: depth + 1 });
      }
      for (let index = node.children.length - 1; index >= 0; index--) stack.push({ type: 'node', node: node.children[index]!, depth: depth + 1 });
    }
    return lines;
  };

  const renderBoxChildren = (root: TreeNode): string[] => {
    const lines: string[] = [];
    type NodeWork = { type: 'node'; node: TreeNode; connector: string; prefix: string; childPrefix: string };
    type UsageWork = { type: 'usage'; usage: TreeNode['ambiguousChildren'][number]; connector: string; prefix: string };
    const stack: Array<NodeWork | UsageWork> = [];
    for (let index = root.ambiguousChildren.length - 1; index >= 0; index--) {
      const last = index === root.ambiguousChildren.length - 1;
      stack.push({ type: 'usage', usage: root.ambiguousChildren[index]!, connector: last ? '└── ' : '├── ', prefix: '' });
    }
    for (let index = root.children.length - 1; index >= 0; index--) {
      const last = index === root.children.length - 1 && root.ambiguousChildren.length === 0;
      stack.push({ type: 'node', node: root.children[index]!, connector: last ? '└── ' : '├── ', prefix: '', childPrefix: last ? '    ' : '│   ' });
    }
    while (stack.length > 0) {
      const work = stack.pop()!;
      if (work.type === 'usage') {
        lines.push(`${work.prefix}${work.connector}${ambiguousLabel(work.usage)}`);
        continue;
      }
      lines.push(`${work.prefix}${work.connector}${treeLabel(work.node)}`);
      for (let index = work.node.ambiguousChildren.length - 1; index >= 0; index--) {
        const last = index === work.node.ambiguousChildren.length - 1;
        stack.push({ type: 'usage', usage: work.node.ambiguousChildren[index]!, connector: last ? '└── ' : '├── ', prefix: work.childPrefix });
      }
      for (let index = work.node.children.length - 1; index >= 0; index--) {
        const last = index === work.node.children.length - 1 && work.node.ambiguousChildren.length === 0;
        stack.push({ type: 'node', node: work.node.children[index]!, connector: last ? '└── ' : '├── ', prefix: work.childPrefix,
          childPrefix: work.childPrefix + (last ? '    ' : '│   ') });
      }
    }
    return lines;
  };

  const childrenOf = (tree: TreeNode): string => {
    if (html) {
      const lines = renderBoxChildren(tree);
      return lines.length > 0 ? `<pre>\n${lines.join('\n')}\n</pre>` : '<pre></pre>';
    }
    const lines = options.treeStyle === 'box' ? renderBoxChildren(tree) : renderChildren(tree);
    return lines.join(options.treeStyle === 'box' ? '<br>\n' : '\n');
  };

  const rootHeading = (tree: TreeNode, level: '#' | '##'): string =>
    `${level} ${treeLabel(tree, true)}\n\nparent path: \`${parentPathOf(tree.id)}\``;

  const unownedAmbiguousSection = (): string => {
    const usages = view.ambiguousUsages.filter((usage) => usage.owner === null);
    if (usages.length === 0) return '';
    const items = usages.map((usage) => {
      const candidates = usage.candidates.length > 0
        ? `; candidates: ${usage.candidates.map(linkToComponent).join(' | ')}`
        : '; target unresolved';
      return `- ⚠ ${usage.callerName} [${usage.kind}] \`${usage.expression}\`${candidates} (${usage.location.file}:${usage.location.line})`;
    });
    return `## Unowned ambiguous component usages\n\n${items.join('\n')}`;
  };

  if (view.kind === 'component') {
    return `${rootHeading(view.tree!, '#')}\n\n${childrenOf(view.tree!)}${unownedAmbiguousSection() ? `\n\n${unownedAmbiguousSection()}` : ''}\n`;
  }

  if (view.kind === 'all') {
    const sections = (view.trees ?? []).map((tree) =>
      `${rootHeading(tree, '##')}\n\n${childrenOf(tree)}`);
    if ((view.unreachable ?? []).length > 0) {
      sections.push(`## Unreachable\n\n${view.unreachable!.map((id) => `- ${linkToComponent(id)}`).join('\n')}`);
    }
    if (unownedAmbiguousSection()) sections.push(unownedAmbiguousSection());
    return `# Angular Component Analysis\n\n${sections.join('\n\n')}\n`;
  }

  const rootList = view.rootCandidates.map((id) => `- ${linkToComponent(id)}`).join('\n');
  return `# Angular Component Analysis\n\n## Root / entry candidates\n\n${rootList}${unownedAmbiguousSection() ? `\n\n${unownedAmbiguousSection()}` : ''}\n`;
}
