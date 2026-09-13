import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv';

interface ValidationError { instancePath: string; message?: string }
type Validator = ((document: unknown) => boolean) & { errors?: ValidationError[] | null };
type AjvInstance = { compile: (schema: unknown) => Validator };
// ajv is CommonJS: under ESM the default import carries the real constructor.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as
  new (options?: Record<string, unknown>) => AjvInstance;
import { buildView } from '../../src/query/view.js';
import { selectComponent } from '../../src/query/select.js';
import { renderJson } from '../../src/render/json.js';
import { analyzeFixture } from '../helpers/fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs', 'ngmaze.schema.json'), 'utf8'));

describe('JSON schema (plan section 32)', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  const check = (document: unknown): void => {
    const valid = validate(document);
    if (!valid) {
      const errors: ValidationError[] = validate.errors ?? [];
      throw new Error(`schema violations:\n${errors.map((e) => `${e.instancePath} ${e.message}`).join('\n')}`);
    }
    expect(valid).toBe(true);
  };

  it('validates the whole project document', async () => {
    const { result } = await analyzeFixture('main');
    const view = buildView(result, {});
    const document = JSON.parse(renderJson(view, result, {
      component: null, direction: 'children', depth: null, all: false, why: false,
    }, '0.0.0', null));
    check(document);
  });

  it('validates a component document with a tree', async () => {
    const { result } = await analyzeFixture('main');
    const selection = selectComponent(result, 'ChildComponent');
    expect(selection.kind).toBe('found');
    const view = buildView(result, { component: 'ChildComponent', depth: 2 }, selection.kind === 'found' ? selection.id : undefined);
    const document = JSON.parse(renderJson(view, result, {
      component: 'ChildComponent', direction: 'children', depth: 2, all: false, why: true,
    }, '0.0.0', null));
    check(document);
  });

  it('validates an --all document', async () => {
    const { result } = await analyzeFixture('main');
    const view = buildView(result, { all: true });
    const document = JSON.parse(renderJson(view, result, {
      component: null, direction: 'children', depth: null, all: true, why: false,
    }, '0.0.0', null));
    check(document);
    expect(document.result.unreachable.length).toBeGreaterThan(0);
  });

  it('validates an error document', async () => {
    const { result } = await analyzeFixture('main');
    const document = JSON.parse(renderJson(null, result, {
      component: 'DuplicateClassComponent', direction: 'children', depth: null, all: false, why: false,
    }, '0.0.0', { code: 'ambiguous', message: 'Multiple components match.', candidates: ['a.ts#A', 'b.ts#A'] }));
    check(document);
  });

  it('rejects a detection gap that omits its candidate contract', async () => {
    const { result } = await analyzeFixture('main');
    const view = buildView(result, {});
    const document = JSON.parse(renderJson(view, result, {
      component: null, direction: 'children', depth: null, all: false, why: false,
    }, '0.0.0', null));
    delete document.global.detectionGaps[0].candidates;
    expect(validate(document)).toBe(false);
  });

  it('keeps ambiguous usages separate from real edges and serializes the tree placeholders', async () => {
    const { result } = await analyzeFixture('main');
    const selection = selectComponent(result, 'OutletHostComponent');
    expect(selection.kind).toBe('found');
    const view = buildView(result, {}, selection.kind === 'found' ? selection.id : undefined);
    const document = JSON.parse(renderJson(view, result, {
      component: 'OutletHostComponent', direction: 'children', depth: null, all: false, why: false,
    }, '0.0.0', null));
    check(document);
    expect(document.result.tree.ambiguousChildren).toHaveLength(5);
    expect(document.result.ambiguousUsages).toHaveLength(5);
    expect(document.query.ignoreAmbiguous).toBe(false);
  });
});
