import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/analysis/analyze.js';
import { UserError } from '../../src/model/errors.js';
import { analyzeFixture, fixturePath, isolatedFixturePath } from '../helpers/fixtures.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('multi project workspace (plan sections 6.1, 7.2, 7.3)', () => {
  it('analyses every angular.json project below the analysis root', async () => {
    const { result } = await analyzeFixture('multi-project');
    expect(result.meta.angularProjects).toEqual(['app-one', 'app-two']);
    const appComponents = result.components.filter((c) => c.className === 'AppComponent');
    expect(appComponents.map((c) => c.id).sort()).toEqual([
      'projects/two/src/app.component.ts#AppComponent',
      'src/app.component.ts#AppComponent',
    ]);
    expect(appComponents.map((c) => c.angularProject).sort()).toEqual(['app-one', 'app-two']);
  });

  it('discovers an Angular workspace nested below the analysis root', async () => {
    const { result, context } = await analyzeFixture('nested-workspace');
    expect(result.meta.workspaceRoot).toBe(fixturePath('nested-workspace'));
    expect(result.meta.angularProjects).toEqual(['nested-app', 'nested-child']);
    expect(result.components.map((component) => component.id)).toEqual([
      'apps/web/packages/child/src/child.component.ts#NestedChildComponent',
      'apps/web/src/nested-app.component.ts#NestedAppComponent',
    ]);
    // The parent app must provide the compiler options.  Selecting the child
    // by alphabetic project name is a regression that can hide parent sources.
    expect(context.tsconfig.primary).toBe(path.join(fixturePath('nested-workspace'), 'apps/web/tsconfig.app.json'));
  });

  it('reports, rather than silently merges, a nested workspace below an enclosing workspace', async () => {
    const project = path.join(fixturePath('nested-workspace'), 'apps', 'web');
    const { result, warnings } = await analyze({ project });
    expect(result.meta.angularProjects).toEqual(['nested-app']);
    expect(result.components.map((component) => component.className)).toEqual(['NestedAppComponent']);
    expect(result.detectionGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'nested-workspace', file: 'packages/child/angular.json' }),
    ]));
    expect(warnings.join('\n')).toContain('nested Angular workspace');
  });

  it('finds a component that no entry point imports', async () => {
    // tsconfig.app.json only lists src/main.ts, so a Program built from the
    // tsconfig alone would silently drop this component (plan section 7.2).
    const { result } = await analyzeFixture('multi-project');
    expect(result.components.some((c) => c.className === 'UnreferencedComponent')).toBe(true);
  });

  it('keeps spec sources out and counts what was dropped', async () => {
    const { result } = await analyzeFixture('multi-project');
    expect(result.components.some((c) => c.className === 'SpecComponent')).toBe(false);
    expect(result.meta.excludedFileCount).toBe(1);
  });

  it('limits the analysis with --angular-project', async () => {
    const { result } = await analyzeFixture('multi-project', { angularProject: 'app-two' });
    expect(result.meta.angularProjects).toEqual(['app-two']);
    expect(result.components.map((c) => c.className)).toEqual(['AppComponent']);
    expect(result.components[0]!.selector).toBe('two-root');
  });

  it('fails with a user error for an unknown project name', async () => {
    await expect(analyze({ project: fixturePath('multi-project'), angularProject: 'nope' }))
      .rejects.toThrow(UserError);
  });
});

/**
 * Issue 32, F-02: one tsconfig used to win by the length of its root path, and
 * the aliases of every other project were dropped, so real imports resolved to
 * nothing and their edges disappeared without a warning.
 */
describe('monorepo with one tsconfig per project (issue 32, F-02)', () => {
  it('picks the application tsconfig and merges the other projects path aliases', async () => {
    const { result, context } = await analyzeFixture('monorepo-paths');
    expect(context.tsconfig.primary)
      .toBe(path.join(fixturePath('monorepo-paths'), 'apps/web/tsconfig.app.json'));
    expect(context.tsconfig.merged)
      .toEqual([path.join(fixturePath('monorepo-paths'), 'libs/ui/tsconfig.lib.json')]);
    expect(result.meta.tsconfigFiles).toEqual(['apps/web/tsconfig.app.json', 'libs/ui/tsconfig.lib.json']);
  });

  it('keeps the edges of both projects, through both aliases', async () => {
    const { result } = await analyzeFixture('monorepo-paths');
    expect(result.edges.map((e) => `${e.from.split('#')[1]} -> ${e.to.split('#')[1]}`).sort()).toEqual([
      'AppComponent -> HeaderComponent',
      'AppComponent -> UiPanelComponent',
      'UiPanelComponent -> UiButtonComponent',
    ]);
    expect(result.diagnostics.filter((d) => d.code === 'selector-out-of-scope')).toEqual([]);
  });
});

describe('tsconfig resolution (plan sections 7.1, 7.4, 7.5)', () => {
  it('follows the references of a solution style tsconfig', async () => {
    const { result } = await analyze({
      project: fixturePath('solution'),
      tsconfig: path.join(fixturePath('solution'), 'tsconfig.json'),
    });
    expect(result.components.map((c) => c.className).sort()).toEqual(['SolutionOneComponent', 'SolutionTwoComponent']);
    expect(result.edges).toHaveLength(1);
  });

  it('prefers the tsconfig named by angular.json', async () => {
    const { context } = await analyzeFixture('main');
    expect(context.tsconfig.primary.endsWith('tsconfig.app.json')).toBe(true);
  });

  it('fails loudly when @angular/core cannot be resolved', async () => {
    const project = isolatedFixturePath('no-angular');
    await expect(analyze({ project, tsconfig: path.join(project, 'tsconfig.json') }))
      .rejects.toThrow(/@angular\/core/);
  });

  it('fails when neither angular.json nor --tsconfig is available', async () => {
    await expect(analyze({ project: isolatedFixturePath('no-angular') })).rejects.toThrow(UserError);
  });
});

describe('toolchain resolution (plan section 1.1)', () => {
  it('reports where typescript and @angular/compiler came from', async () => {
    const { result } = await analyzeFixture('main');
    expect(result.meta.typescriptSource).toBe('project');
    expect(result.meta.angularCompilerSource).toBe('project');
    expect(result.meta.typescriptVersion).toMatch(/^6\./);
    expect(result.meta.angularCompilerVersion).toMatch(/^22\./);
  });

  it('resolves project dependencies through a symlinked project root', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ngmaze-link-'));
    const link = path.join(temp, 'main-link');
    fs.symlinkSync(fixturePath('main'), link, 'dir');
    try {
      const { result } = await analyze({ project: link });
      expect(result.meta.analysisRoot).toBe(link);
      expect(result.components.some((component) => component.className === 'AppComponent')).toBe(true);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
