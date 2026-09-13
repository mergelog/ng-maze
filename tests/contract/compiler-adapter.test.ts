import { describe, expect, it, beforeAll } from 'vitest';
import { createCompilerAdapter, type CompilerAdapter } from '../../src/angular/compiler-adapter.js';
import { loadToolchain } from '../../src/toolchain/load.js';

/**
 * Plan section 2 / 36 "Contract".
 *
 * These assertions pin the `@angular/compiler` behaviour ngmaze relies on to the
 * exact version resolved for this repository. If Angular changes an internal
 * API, this test fails first and only the adapter has to change.
 */
describe('@angular/compiler contract', () => {
  let adapter: CompilerAdapter;
  let version: string;

  beforeAll(async () => {
    const toolchain = await loadToolchain(process.cwd());
    version = toolchain.ngVersion;
    adapter = createCompilerAdapter(toolchain.ng);
  });

  it('resolves the expected Angular compiler major', () => {
    expect(version).toMatch(/^22\./);
  });

  it('parses a template and reports no errors for valid input', () => {
    const parsed = adapter.parseTemplate('<app-a></app-a>', 'a.html');
    expect(parsed.errors).toEqual([]);
    expect(parsed.elements.map((e) => e.tagName)).toEqual(['app-a']);
  });

  it('reports parse errors instead of throwing', () => {
    const parsed = adapter.parseTemplate('<div><span></div>', 'bad.html');
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('traverses nested elements, control flow blocks and deferred blocks', () => {
    const template = [
      '<app-a></app-a>',
      '<app-b />',
      '<!-- <app-commented /> -->',
      '@if (x) { <app-if /> } @else { <app-else /> }',
      '@for (i of items; track i) { <app-for /> } @empty { <app-empty /> }',
      '@switch (v) { @case (1) { <app-case /> } @default { <app-default /> } }',
      '@defer { <app-defer /> } @placeholder { <app-placeholder /> } @loading { <app-loading /> } @error { <app-error /> }',
      '<div *ngIf="c"><app-structural /></div>',
      '<ng-template><app-in-template /></ng-template>',
      '<ng-content />',
      '<router-outlet />',
    ].join('\n');

    const tags = adapter.parseTemplate(template, 't.html').elements.map((e) => e.tagName);

    for (const expected of [
      'app-a', 'app-b', 'app-if', 'app-else', 'app-for', 'app-empty',
      'app-case', 'app-default', 'app-defer', 'app-placeholder',
      'app-loading', 'app-error', 'app-structural', 'app-in-template',
    ]) {
      expect(tags, `missing ${expected}`).toContain(expected);
    }
    expect(tags).not.toContain('app-commented');
  });

  it('reports a source position for every element', () => {
    const parsed = adapter.parseTemplate('<a-one></a-one>\n  <a-two></a-two>', 't.html');
    const [one, two] = parsed.elements;
    expect(one!.position).toEqual({ offset: 0, line: 0, column: 0 });
    expect(two!.position.line).toBe(1);
    expect(two!.position.column).toBe(2);
    expect(two!.position.offset).toBe(18);
  });

  it('exposes static and bound attributes', () => {
    const parsed = adapter.parseTemplate('<app-a class="x" title="t" [foo]="bar" (click)="go()"></app-a>', 't.html');
    const attrs = parsed.elements[0]!.attributes;
    expect(attrs.find((a) => a.name === 'title')).toMatchObject({ value: 't', bound: false });
    expect(attrs.find((a) => a.name === 'foo')).toMatchObject({ value: 'bar', bound: true });
  });

  describe('selector matching', () => {
    const build = (entries: Record<string, string>) => {
      const index = adapter.createSelectorIndex<string>();
      for (const [name, selector] of Object.entries(entries)) {
        expect(index.add(selector, name), `selector ${selector} should parse`).toBe(true);
      }
      return index;
    };

    const matchAll = (index: ReturnType<CompilerAdapter['createSelectorIndex']>, template: string) =>
      adapter.parseTemplate(template, 't.html').elements.map((e) => ({ tag: e.tagName, hits: index.match(e) }));

    it('matches element, attribute, class, attribute value, :not and comma selectors', () => {
      const index = build({
        ELEMENT: 'app-a',
        ATTRIBUTE: '[foo]',
        CLASS: '.bar',
        ATTR_VALUE: 'input[type=text]',
        NOT: 'div:not([skip])',
        COMMA: 'c-one, c-two',
      });

      const result = matchAll(index, [
        '<app-a></app-a>',
        '<span foo></span>',
        '<b class="bar"></b>',
        '<input type="text">',
        '<div></div>',
        '<div skip></div>',
        '<c-one></c-one>',
        '<c-two></c-two>',
      ].join('\n'));

      expect(result).toEqual([
        { tag: 'app-a', hits: ['ELEMENT'] },
        { tag: 'span', hits: ['ATTRIBUTE'] },
        { tag: 'b', hits: ['CLASS'] },
        { tag: 'input', hits: ['ATTR_VALUE'] },
        { tag: 'div', hits: ['NOT'] },
        { tag: 'div', hits: [] },
        { tag: 'c-one', hits: ['COMMA'] },
        { tag: 'c-two', hits: ['COMMA'] },
      ]);
    });

    it('matches a bound attribute selector', () => {
      const index = build({ BOUND: '[appHighlight]' });
      const [element] = matchAll(index, '<span [appHighlight]="value"></span>');
      expect(element!.hits).toEqual(['BOUND']);
    });

    it('matches an element carrying a structural directive exactly once', () => {
      const index = build({ TARGET: 'app-a' });
      const matched = matchAll(index, '<app-a *ngIf="cond"></app-a>').filter((e) => e.hits.length > 0);
      expect(matched).toEqual([{ tag: 'app-a', hits: ['TARGET'] }]);
    });

    it('matches inside control flow blocks', () => {
      const index = build({ TARGET: 'app-a' });
      const matched = matchAll(index, '@if (x) { <app-a></app-a> } @else { <app-a></app-a> }').filter((e) => e.hits.length > 0);
      expect(matched).toHaveLength(2);
    });

    it('reports one hit per registered selector list even when several parts match', () => {
      // Measured behaviour of 22.1.5: SelectorMatcher keeps a per selector list
      // "already matched" flag, so a comma selector reports its context once.
      // ngmaze still dedupes by component id above the adapter (plan section 17)
      // because the same component can reach the index more than once.
      const index = build({ SAME: 'c-one, [foo]' });
      const [element] = matchAll(index, '<c-one foo></c-one>');
      expect(element!.hits).toEqual(['SAME']);
    });

    it('reports each distinct component of an ambiguous selector', () => {
      const index = build({ FIRST: 'dup-one', SECOND: 'dup-one' });
      const [element] = matchAll(index, '<dup-one></dup-one>');
      expect([...element!.hits].sort()).toEqual(['FIRST', 'SECOND']);
    });

    it('rejects an empty selector instead of indexing it', () => {
      // CssSelector.parse('') succeeds and yields a selector that would match
      // unrelated nodes, so the adapter filters blank selector text itself.
      const index = adapter.createSelectorIndex<string>();
      expect(index.add('', 'EMPTY')).toBe(false);
      expect(index.add('   ', 'BLANK')).toBe(false);
    });
  });
});
