import { createColors } from 'picocolors';
import type { AmbiguousUsage, ComponentId, Diagnostic, Edge, ExternalUsage, RouteEntry } from '../model/types.js';
import { compareCodePoint } from '../util/paths.js';
import type { QueryView } from '../query/view.js';
import { diagnosticCounts } from '../query/view.js';
import type { TreeNode } from '../query/tree.js';

export interface TextOptions {
  why: boolean;
  color: boolean;
}

const DIAGNOSTIC_LABELS: Record<Diagnostic['code'], string> = {
  'ambiguous-selector': 'ambiguous selectors',
  'component-metadata': 'component metadata',
  'missing-template': 'missing templates',
  'multiple-ngmodule-declarations': 'multiple ngmodule declarations',
  'selector-out-of-scope': 'selectors out of scope',
  'template-parse-error': 'template parse errors',
  'unresolved-dynamic': 'unresolved dynamics',
  'unresolved-route': 'unresolved routes',
  'unresolved-scope': 'unresolved scopes',
};

/** Root candidates listed in the summary before the rest is counted, never dropped silently. */
const ROOT_PREVIEW = 20;

function formatLocation(location: { file: string; line: number; column: number; precision: string }): string {
  const base = `${location.file}:${location.line}`;
  return location.precision === 'approximate' ? `${base} (approximate)` : base;
}

function occurrenceSuffix(occurrences: Edge[], why: boolean): string {
  if (occurrences.length === 0) return '';
  const parts: string[] = [];
  if (occurrences.length > 1) parts.push(`×${occurrences.length}`);
  if (!why) {
    const kinds = new Map<string, number>();
    for (const occurrence of occurrences) kinds.set(occurrence.kind, (kinds.get(occurrence.kind) ?? 0) + 1);
    if ([...kinds.keys()].some((kind) => kind !== 'template')) {
      // Plan section 25: an aggregated edge never loses its kinds.
      const label = kinds.size === 1
        ? `[${[...kinds.keys()][0]}]`
        : `[${[...kinds.entries()].map(([kind, count]) => `${kind}×${count}`).join(', ')}]`;
      parts.push(label);
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

export function renderText(view: QueryView, options: TextOptions): string {
  const c = createColors(options.color);
  const lines: string[] = [];

  // Two components can share a class name in different files. Every text label
  // goes through `nameOf`, so the id is appended only for those, keeping the
  // common case short while never printing two different components alike.
  const nameCounts = new Map<string, number>();
  for (const component of view.graph.components.values()) {
    nameCounts.set(component.className, (nameCounts.get(component.className) ?? 0) + 1);
  }
  const nameOf = (id: ComponentId): string => {
    const component = view.graph.components.get(id);
    if (!component) return id;
    if ((nameCounts.get(component.className) ?? 0) > 1) return `${component.className} ${c.dim(id)}`;
    return component.className;
  };

  const renderTree = (root: TreeNode): string[] => {
    const output: string[] = [];

    const label = (target: TreeNode, isRoot: boolean): string => {
      const references = view.graph.referenceCount.get(target.id) ?? 0;
      let text = c.cyan(nameOf(target.id));
      const base = view.graph.components.get(target.id)?.extendsComponent;
      if (base) text += c.dim(` [extends ${nameOf(base)}]`);
      if (!isRoot && references > 1) text += c.dim(` (参照元: ${references})`);
      text += occurrenceSuffix(target.occurrences, options.why);
      if (target.cycle) text += c.yellow(' [cycle]');
      if (target.truncated) text += c.dim(' [...]');
      return text;
    };

    type NodeWork = { type: 'node'; target: TreeNode; connector: string; prefix: string; childPrefix: string; isRoot: boolean };
    type AmbiguousWork = { type: 'ambiguous'; usage: TreeNode['ambiguousChildren'][number]; connector: string; prefix: string; detailPrefix: string };
    const stack: Array<NodeWork | AmbiguousWork> = [{ type: 'node', target: root, connector: '', prefix: '', childPrefix: '', isRoot: true }];
    while (stack.length > 0) {
      const work = stack.pop()!;
      if (work.type === 'ambiguous') {
        const candidates = work.usage.candidates.length > 0
          ? ` candidates: ${work.usage.candidates.map(nameOf).join(' | ')}`
          : ' target unresolved';
        output.push(`${work.prefix}${work.connector}${c.yellow('? Ambiguous component')} ${c.dim(`[${work.usage.kind}]${candidates}`)}`);
        if (options.why) output.push(`${work.detailPrefix}${c.dim(`${formatLocation(work.usage.location)} expression: ${work.usage.expression}`)}`);
        continue;
      }
      const { target, connector, prefix, childPrefix, isRoot } = work;
      output.push(`${prefix}${connector}${label(target, isRoot)}`);
      if (options.why) {
        for (const occurrence of target.occurrences) output.push(`${childPrefix}${c.dim(`[${occurrence.kind}] ${formatLocation(occurrence.location)}`)}`);
      }
      for (let index = target.ambiguousChildren.length - 1; index >= 0; index--) {
        const last = index === target.ambiguousChildren.length - 1;
        stack.push({ type: 'ambiguous', usage: target.ambiguousChildren[index]!, connector: last ? '└── ' : '├── ', prefix: childPrefix,
          detailPrefix: childPrefix + (last ? '    ' : '│   ') });
      }
      for (let index = target.children.length - 1; index >= 0; index--) {
        const last = index === target.children.length - 1 && target.ambiguousChildren.length === 0;
        stack.push({ type: 'node', target: target.children[index]!, connector: last ? '└── ' : '├── ', prefix: childPrefix,
          childPrefix: childPrefix + (last ? '    ' : '│   '), isRoot: false });
      }
    }
    return output;
  };

  const renderUnownedAmbiguous = (usages: AmbiguousUsage[]): void => {
    const unowned = usages.filter((usage) => usage.owner === null);
    if (unowned.length === 0) return;
    lines.push('');
    lines.push(c.bold('Unowned ambiguous component usages:'));
    unowned.forEach((usage, index) => {
      const last = index === unowned.length - 1;
      const candidates = usage.candidates.length > 0 ? ` → ${usage.candidates.map(nameOf).join(' | ')}` : '';
      lines.push(`${last ? '└── ' : '├── '}${usage.callerName} ${c.yellow('?')} ${c.dim(`[${usage.kind}]`)}${candidates}`);
      lines.push(`${last ? '    ' : '│   '}${c.dim(`${formatLocation(usage.location)} expression: ${usage.expression}`)}`);
    });
  };

  const renderRoutes = (routes: RouteEntry[]): void => {
    if (routes.length === 0) return;
    lines.push('');
    lines.push(c.bold('Route entries:'));
    routes.forEach((route, index) => {
      const last = index === routes.length - 1;
      const target = view.kind === 'component' ? '' : ` → ${nameOf(route.target)}`;
      lines.push(`${last ? '└── ' : '├── '}${route.path}${target}`);
      lines.push(`${last ? '    ' : '│   '}${c.dim(`[${route.targetKind}] ${formatLocation(route.location)}`)}`);
    });
  };

  const renderExternalUsages = (usages: ExternalUsage[]): void => {
    if (usages.length === 0) return;
    lines.push('');
    lines.push(c.bold('External usages:'));
    usages.forEach((usage, index) => {
      const last = index === usages.length - 1;
      const target = view.kind === 'component' ? '' : ` → ${nameOf(usage.target)}`;
      lines.push(`${last ? '└── ' : '├── '}${usage.callerName} ${c.dim(`[${usage.kind}]`)}${target}`);
      lines.push(`${last ? '    ' : '│   '}${c.dim(formatLocation(usage.location))}`);
    });
  };

  const renderInheritance = (): void => {
    if (view.extendsComponent === null && view.extendedBy.length === 0) return;
    lines.push('');
    lines.push(c.bold('Inheritance:'));
    const relations = [
      ...(view.extendsComponent ? [{ label: 'Extends', component: view.extendsComponent }] : []),
      ...view.extendedBy.map((component) => ({ label: 'Extended by', component })),
    ];
    relations.forEach(({ label, component }, index) => {
      const last = index === relations.length - 1;
      lines.push(`${last ? '└── ' : '├── '}${label}: ${nameOf(component.id)}`);
    });
  };

  const renderWarnings = (diagnostics: Diagnostic[]): void => {
    if (diagnostics.length === 0) return;
    lines.push('');
    lines.push(c.bold('Warnings:'));
    const counts = diagnosticCounts(diagnostics);
    // A diagnostic code added without a label must degrade to the raw code,
    // never to `undefined.length`.
    const labelOf = (code: string): string => DIAGNOSTIC_LABELS[code as Diagnostic['code']] ?? code;
    const width = Math.max(...[...counts.keys()].map((code) => labelOf(code).length));
    for (const [code, count] of counts) {
      lines.push(`  ${labelOf(code).padEnd(width)} : ${count}`);
    }
    if (options.why) {
      lines.push('');
      for (const diagnostic of diagnostics) {
        lines.push(`  ${c.yellow(diagnostic.code)} ${formatLocation(diagnostic.location)} ${diagnostic.message}`);
      }
    } else {
      lines.push(c.dim('  (--why or --json shows file and line for each warning)'));
    }
  };

  if (view.kind === 'summary') {
    lines.push(c.bold('Angular Component Analysis'));
    lines.push('');
    const stats: [string, number][] = [
      ['Components', view.globalStats.components],
      ['Template usages', view.globalStats.templateUsages],
      ['Route entries', view.globalStats.routeEntries],
      ['Dynamic usages', view.globalStats.dynamicUsages],
      ['External usages', view.globalStats.externalUsages],
      ['Ambiguous usages', view.ambiguousUsages.length],
    ];
    const width = Math.max(...stats.map(([label]) => label.length));
    for (const [label, value] of stats) lines.push(`${label.padEnd(width)} : ${value}`);

    lines.push('');
    lines.push(c.bold('Root / entry candidates:'));
    const roots = view.rootCandidates;
    const shown = roots.slice(0, ROOT_PREVIEW);
    shown.forEach((id, index) => {
      const last = index === shown.length - 1 && roots.length === shown.length;
      lines.push(`${last ? '└── ' : '├── '}${nameOf(id)}`);
    });
    if (roots.length > shown.length) {
      lines.push(`└── ${c.dim(`... and ${roots.length - shown.length} more (npx mergelog/ng-maze --all)`)}`);
    }
    if (roots.length === 0) lines.push(c.dim('  (none: every component is used by another component)'));

    renderWarnings(view.diagnostics);
    renderUnownedAmbiguous(view.ambiguousUsages);

    lines.push('');
    lines.push('Use:');
    lines.push('  npx mergelog/ng-maze <component>');
    lines.push('  npx mergelog/ng-maze <component> --parents');
    lines.push('  npx mergelog/ng-maze --all');
    return lines.join('\n') + '\n';
  }

  if (view.kind === 'all') {
    lines.push(c.bold('Angular Component Analysis (all)'));
    lines.push('');
    for (const tree of view.trees ?? []) {
      // A rendered tree can hold hundreds of thousands of lines: spreading it
      // into `push` would overflow the argument stack.
      for (const line of renderTree(tree)) lines.push(line);
      lines.push('');
    }
    if ((view.unreachable ?? []).length > 0) {
      lines.push(c.bold('Unreachable:'));
      // The id is always spelled out here; `nameOf` already carries it for
      // components whose class name is not unique.
      for (const id of view.unreachable ?? []) {
        const name = nameOf(id);
        lines.push(`  ${name.includes(id) ? name : `${name} ${c.dim(id)}`}`);
      }
    }
    renderWarnings(view.diagnostics);
    renderUnownedAmbiguous(view.ambiguousUsages);
    return lines.join('\n') + '\n';
  }

  const component = view.component!;
  let header = c.bold(nameOf(component.id));
  if (component.extendsComponent) header += c.dim(` [extends ${nameOf(component.extendsComponent)}]`);
  lines.push(header);
  if (view.direction === 'parents' && (
    view.externalUsages.length > 0 || view.routes.length > 0
    || view.extendsComponent !== null || view.extendedBy.length > 0
  )) {
    lines.push('');
    lines.push(c.bold('Component parents:'));
  }
  const tree = view.tree!;
  if (tree.children.length === 0 && tree.ambiguousChildren.length === 0) {
    lines.push(c.dim(view.direction === 'parents' ? '  (no component parents)' : '  (no child components)'));
  } else {
    // The root line is already printed as the header.
    const rendered = renderTree(tree);
    for (let index = 1; index < rendered.length; index++) lines.push(rendered[index]!);
  }

  if (view.direction === 'parents') renderInheritance();
  renderExternalUsages(view.externalUsages);
  renderUnownedAmbiguous(view.ambiguousUsages);
  renderRoutes(view.routes);
  renderWarnings(view.diagnostics);
  return lines.join('\n') + '\n';
}

/** Candidate list for an ambiguous component query (plan section 27, PRD section 2). */
export function renderCandidates(candidates: ComponentId[], color: boolean): string {
  const c = createColors(color);
  const lines = [c.bold('Multiple components found:'), ''];
  [...candidates].sort(compareCodePoint).forEach((id, index) => {
    lines.push(`${index + 1}. ${id}`);
  });
  return lines.join('\n') + '\n';
}
