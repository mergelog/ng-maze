import * as fs from 'node:fs';
import type * as TS from 'typescript';
import type { ComponentId, DetectionGap, Diagnostic, Edge, SourceLocation } from '../model/types.js';
import { absPosix, compareCodePoint, relPosix } from '../util/paths.js';
import type { CompilerAdapter, ParsedTemplate, TemplatePosition } from '../angular/compiler-adapter.js';
import type { ProgramContext } from '../project/program.js';
import type { Catalog, ComponentRecord } from './catalog.js';
import type { ScopeEngine } from './scope.js';

export interface OutletCandidate {
  owner: ComponentId;
  /** Raw expression source of `[ngComponentOutlet]`. */
  expression: string;
  location: SourceLocation;
}

export interface TemplateAnalysis {
  edges: Edge[];
  diagnostics: Diagnostic[];
  detectionGaps: DetectionGap[];
  outletCandidates: OutletCandidate[];
  templateFileCount: number;
}

type PositionMapper = (position: TemplatePosition) => SourceLocation;

export function analyzeTemplates(
  ctx: ProgramContext,
  adapter: CompilerAdapter,
  catalog: Catalog,
  scopes: ScopeEngine,
): TemplateAnalysis {
  const edges: Edge[] = [];
  const diagnostics: Diagnostic[] = [];
  const detectionGaps: DetectionGap[] = [];
  const outletCandidates: OutletCandidate[] = [];
  const workspaceRoot = ctx.workspace.workspaceRoot;

  // Project wide selector index (plan section 17).
  const selectorIndex = adapter.createSelectorIndex<ComponentId>();
  for (const record of [...catalog.components.values()].sort((a, b) => compareCodePoint(a.info.id, b.info.id))) {
    const selector = record.info.selector;
    if (!selector) continue;
    // A selector the parser rejects leaves the component out of the index, so
    // nothing would ever match it: that has to be reported, not discarded.
    if (!selectorIndex.add(selector, record.info.id)) {
      diagnostics.push({
        code: 'component-metadata',
        message: `selector "${selector}" of ${record.info.className} could not be parsed; the component cannot be matched in templates.`,
        file: record.info.location.file,
        location: record.info.location,
        owner: record.info.id,
      });
      detectionGaps.push({
        code: 'decorated-but-not-catalogued',
        message: `selector "${selector}" of ${record.info.className} could not be parsed; template usages of it cannot be detected.`,
        file: record.info.location.file,
        location: record.info.location,
        owner: record.info.id,
        candidates: [],
      });
    }
  }

  // Same HTML shared by several components: the AST is cached, the edges are not
  // (plan section 19).
  const astCache = new Map<string, ParsedTemplate>();
  const parsedTemplateFiles = new Set<string>();

  for (const record of [...catalog.components.values()].sort((a, b) => compareCodePoint(a.info.id, b.info.id))) {
    const owner = record.info.id;
    const template = readTemplate(ctx, record, astCache, adapter);
    if (!template) continue;
    if (template.templateFile) parsedTemplateFiles.add(template.templateFile);

    if (template.parsed.errors.length > 0) {
      const first = template.parsed.errors[0]!;
      diagnostics.push({
        code: 'template-parse-error',
        message: `Template of ${record.info.className} could not be parsed: ${first.message}`,
        file: template.map(first.position).file,
        location: template.map(first.position),
        owner,
        detail: template.parsed.errors.map((e) => e.message).join(' | '),
      });
      // Never build edges from a partially parsed template (plan section 16).
      continue;
    }

    const scope = scopes.scopeOf(owner);
    let order = 0;

    for (const element of template.parsed.elements) {
      for (const attribute of element.attributes) {
        if (attribute.name === 'ngComponentOutlet' && attribute.bound && attribute.value.trim() !== '') {
          outletCandidates.push({
            owner,
            expression: attribute.value.trim(),
            location: template.map(attribute.position),
          });
        }
        if (attribute.name === 'ngTemplateOutlet') {
          const location = template.map(attribute.position);
          detectionGaps.push({
            code: 'view-relocation',
            message: 'NgTemplateOutlet relocates a view and is intentionally not represented as a component edge.',
            file: location.file, location, owner, candidates: [],
          });
        }
      }

      const matches = [...new Set(selectorIndex.match(element))];
      if (matches.length === 0) continue; // not a project component: out of scope of the graph

      const inScope = matches.filter((id) => scope.components.has(id));
      const location = template.map(element.position);

      if (inScope.length === 1) {
        edges.push({ from: owner, to: inScope[0]!, kind: 'template', location, order: order++ });
        continue;
      }

      if (inScope.length > 1) {
        diagnostics.push({
          code: 'ambiguous-selector',
          message: `<${element.tagName}> in ${record.info.className} matches ${inScope.length} project components.`,
          file: location.file,
          location,
          owner,
          detail: [...inScope].sort(compareCodePoint).join(', '),
        });
        continue;
      }

      if (!scope.complete) {
        diagnostics.push({
          code: 'unresolved-scope',
          message: `<${element.tagName}> in ${record.info.className} matches a project component, but the scope of ${record.info.className} is incomplete.`,
          file: location.file,
          location,
          owner,
          detail: scope.reasons.map((r) => r.reason).join(' | '),
        });
        continue;
      }

      diagnostics.push({
        code: 'selector-out-of-scope',
        message: `<${element.tagName}> in ${record.info.className} matches a project component that is not imported.`,
        file: location.file,
        location,
        owner,
        detail: [...matches].sort(compareCodePoint).join(', '),
      });
    }
  }

  return { edges, diagnostics, detectionGaps, outletCandidates, templateFileCount: parsedTemplateFiles.size };

  function readTemplate(
    context: ProgramContext,
    record: ComponentRecord,
    cache: Map<string, ParsedTemplate>,
    compiler: CompilerAdapter,
  ): { parsed: ParsedTemplate; map: PositionMapper; templateFile: string | null } | null {
    if (record.info.templateKind === 'external' && record.info.templateFile) {
      const file = record.info.templateFile;
      let parsed = cache.get(file);
      if (!parsed) {
        let content: string;
        try {
          content = fs.readFileSync(file, 'utf8');
        } catch {
          return null;
        }
        parsed = compiler.parseTemplate(content, file);
        cache.set(file, parsed);
      }
      const relative = relPosix(workspaceRoot, file);
      const map: PositionMapper = (position) => ({
        file: relative,
        line: position.line + 1,
        column: position.column + 1,
        precision: 'exact',
      });
      return { parsed, map, templateFile: file };
    }

    if (record.info.templateKind === 'inline' && record.inlineTemplate) {
      const key = `${record.info.id}#inline`;
      let parsed = cache.get(key);
      if (!parsed) {
        parsed = compiler.parseTemplate(record.inlineTemplate.text, record.info.file);
        cache.set(key, parsed);
      }
      const map = inlineMapper(context.ts, record, workspaceRoot);
      return { parsed, map, templateFile: null };
    }

    return null;
  }
}

/**
 * Inline template positions are mapped back into the TypeScript file
 * (plan section 19). When the literal contains escapes the mapping can shift, so
 * the location is reported as `approximate` instead of being dropped.
 */
function inlineMapper(ts: typeof TS, record: ComponentRecord, workspaceRoot: string): PositionMapper {
  const node = record.inlineTemplate!.node;
  const sourceFile = node.getSourceFile();
  const file = relPosix(workspaceRoot, absPosix(sourceFile.fileName));
  const fallback: SourceLocation = {
    file,
    line: record.info.location.line,
    column: record.info.location.column,
    precision: 'approximate',
  };

  const isLiteral = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  if (!isLiteral) return () => fallback;

  const start = node.getStart(sourceFile);
  const raw = node.getText(sourceFile);
  const inner = raw.length >= 2 ? raw.slice(1, -1) : '';
  const exact = inner === record.inlineTemplate!.text;
  const contentStart = start + 1;
  const contentEnd = start + raw.length - 1;

  return (position) => {
    const offset = Math.min(contentStart + position.offset, contentEnd);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset);
    return {
      file,
      line: line + 1,
      column: character + 1,
      precision: exact ? 'exact' : 'approximate',
    };
  };
}
