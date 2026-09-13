import type { AngularCompilerApi } from '../toolchain/load.js';

/**
 * The only place allowed to touch `@angular/compiler` (plan section 2).
 *
 * Nothing outside this file may import Angular compiler types or rely on its
 * AST class names. If Angular renames an internal API, this adapter changes and
 * the rest of ngmaze does not.
 */

export interface TemplatePosition {
  /** 0 based offset inside the parsed template text. */
  offset: number;
  /** 0 based. */
  line: number;
  /** 0 based. */
  column: number;
}

export interface TemplateAttribute {
  name: string;
  /** Static attribute value, or the raw expression source for bound attributes. */
  value: string;
  bound: boolean;
  position: TemplatePosition;
}

export interface TemplateElement {
  tagName: string;
  /** Opaque `CssSelector` produced by the Angular compiler. */
  selector: unknown;
  position: TemplatePosition;
  attributes: TemplateAttribute[];
}

export interface TemplateParseError {
  message: string;
  position: TemplatePosition;
}

export interface ParsedTemplate {
  elements: TemplateElement[];
  errors: TemplateParseError[];
}

export interface SelectorIndex<T> {
  /** Returns false when the selector text could not be parsed. */
  add(selectorText: string, value: T): boolean;
  match(element: TemplateElement): T[];
}

export interface CompilerAdapter {
  version: string;
  parseTemplate(content: string, fileName: string): ParsedTemplate;
  createSelectorIndex<T>(): SelectorIndex<T>;
}

const EMPTY_POSITION: TemplatePosition = { offset: 0, line: 0, column: 0 };

function positionOf(span: any): TemplatePosition {
  const start = span?.start;
  if (!start) return EMPTY_POSITION;
  return {
    offset: typeof start.offset === 'number' ? start.offset : 0,
    line: typeof start.line === 'number' ? start.line : 0,
    column: typeof start.col === 'number' ? start.col : 0,
  };
}

function attributesOf(node: any): TemplateAttribute[] {
  const attrs: TemplateAttribute[] = [];
  for (const attr of node.attributes ?? []) {
    attrs.push({
      name: String(attr.name),
      value: typeof attr.value === 'string' ? attr.value : '',
      bound: false,
      position: positionOf(attr.sourceSpan),
    });
  }
  for (const attr of node.inputs ?? []) {
    attrs.push({
      name: String(attr.name),
      value: typeof attr.value?.source === 'string' ? attr.value.source : '',
      bound: true,
      position: positionOf(attr.sourceSpan),
    });
  }
  // Structural directive bindings live on the synthesised template node.
  for (const attr of node.templateAttrs ?? []) {
    attrs.push({
      name: String(attr.name),
      value: typeof attr.value?.source === 'string' ? attr.value.source : (typeof attr.value === 'string' ? attr.value : ''),
      bound: attr.value?.source !== undefined,
      position: positionOf(attr.sourceSpan),
    });
  }
  return attrs;
}

export function createCompilerAdapter(ng: AngularCompilerApi): CompilerAdapter {
  const { parseTemplate, CssSelector, SelectorMatcher, createCssSelectorFromNode, TmplAstRecursiveVisitor, tmplAstVisitAll } = ng;

  for (const [name, value] of Object.entries({ parseTemplate, CssSelector, SelectorMatcher, createCssSelectorFromNode, TmplAstRecursiveVisitor, tmplAstVisitAll })) {
    if (!value) {
      throw new Error(`@angular/compiler does not export "${name}". ngmaze cannot analyse templates with this Angular version.`);
    }
  }

  return {
    version: ng.VERSION?.full ?? 'unknown',

    parseTemplate(content: string, fileName: string): ParsedTemplate {
      const elements: TemplateElement[] = [];
      const errors: TemplateParseError[] = [];

      let parsed: any;
      try {
        parsed = parseTemplate(content, fileName, {
          preserveWhitespaces: false,
        });
      } catch (error) {
        return {
          elements: [],
          errors: [{ message: error instanceof Error ? error.message : String(error), position: EMPTY_POSITION }],
        };
      }

      for (const error of parsed.errors ?? []) {
        errors.push({
          message: typeof error.msg === 'string' ? error.msg : String(error),
          position: positionOf(error.span),
        });
      }

      // A node carrying a structural directive is reported by the parser as a
      // synthetic template node PLUS the real element node. Only the element
      // node is turned into a selector match so one usage stays one occurrence.
      const collectTemplateOnlyAttributes = (node: any): void => {
        const attrs = attributesOf(node);
        if (attrs.length === 0) return;
        elements.push({
          tagName: String(node.tagName ?? 'ng-template'),
          selector: null,
          position: positionOf(node.startSourceSpan ?? node.sourceSpan),
          attributes: attrs,
        });
      };

      class Collector extends (TmplAstRecursiveVisitor as { new (): any }) {
        visitElement(element: any): void {
          elements.push({
            tagName: String(element.name),
            selector: createCssSelectorFromNode(element),
            position: positionOf(element.startSourceSpan ?? element.sourceSpan),
            attributes: attributesOf(element),
          });
          super.visitElement(element);
        }

        visitTemplate(template: any): void {
          // `<ng-template>` and structural sugar: no component selector match,
          // but its bindings still matter for ngComponentOutlet.
          if (!template.tagName || template.tagName === 'ng-template') {
            collectTemplateOnlyAttributes(template);
          } else if ((template.templateAttrs ?? []).length > 0) {
            collectTemplateOnlyAttributes({ ...template, attributes: [], inputs: [] });
          }
          super.visitTemplate(template);
        }
      }

      try {
        tmplAstVisitAll(new Collector(), parsed.nodes ?? []);
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : String(error),
          position: EMPTY_POSITION,
        });
      }

      return { elements, errors };
    },

    createSelectorIndex<T>(): SelectorIndex<T> {
      const matcher = new SelectorMatcher();
      return {
        add(selectorText: string, value: T): boolean {
          if (!selectorText || selectorText.trim() === '') return false;
          try {
            const selectors = CssSelector.parse(selectorText);
            if (!selectors || selectors.length === 0) return false;
            matcher.addSelectables(selectors, value);
            return true;
          } catch {
            return false;
          }
        },
        match(element: TemplateElement): T[] {
          if (!element.selector) return [];
          const hits: T[] = [];
          matcher.match(element.selector, (_selector: unknown, context: T) => {
            hits.push(context);
          });
          return hits;
        },
      };
    },
  };
}
