import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXIT } from '../../src/model/errors.js';
import { run, type Io } from '../../src/cli/run.js';
import type { CliOptions } from '../../src/cli/options.js';
import { fixturePath } from '../helpers/fixtures.js';

const VERSION = '0.0.0-test';
/** Any ANSI escape sequence. */
const ANSI = new RegExp(String.fromCharCode(27) + '\\[');

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

const options = (overrides: Partial<CliOptions> = {}): CliOptions => ({
  component: undefined,
  project: fixturePath('main'),
  parents: false,
  depth: undefined,
  why: false,
  ignoreAmbiguous: false,
  all: false,
  json: false,
  md: false,
  mdc: false,
  mdh: false,
  output: undefined,
  angularProject: undefined,
  tsconfig: undefined,
  verbose: false,
  ...overrides,
});

async function invoke(overrides: Partial<CliOptions> = {}, isTty = false): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    isTty,
    env: {},
  };
  const code = await run(options(overrides), io, VERSION);
  return { code, stdout, stderr };
}

describe('CLI behaviour', () => {
  let summary: Captured;

  beforeAll(async () => {
    summary = await invoke();
  }, 60_000);

  it('prints a summary when no component is given (PRD section 13)', () => {
    expect(summary.code).toBe(EXIT.OK);
    expect(summary.stdout).toContain('Angular Component Analysis');
    expect(summary.stdout).toMatch(/Components\s+: \d+/);
    expect(summary.stdout).toMatch(/Template usages\s+: \d+/);
    expect(summary.stdout).toMatch(/Route entries\s+: \d+/);
    expect(summary.stdout).toMatch(/Dynamic usages\s+: \d+/);
    expect(summary.stdout).toContain('Root / entry candidates:');
    expect(summary.stdout).toContain('Warnings:');
    expect(summary.stdout).toContain('npx mergelog/ng-maze <component>');
    expect(summary.stdout).toContain('npx mergelog/ng-maze --all');
  });

  it('never colours a non interactive stdout', () => {
    expect(summary.stdout).not.toMatch(ANSI);
  });

  it('prints a component tree with reference counts and occurrence counts', async () => {
    const { code, stdout } = await invoke({ component: 'ChildComponent' });
    expect(code).toBe(EXIT.OK);
    expect(stdout).toContain('ChildComponent');
    expect(stdout).toContain('LeafComponent');
    expect(stdout).toContain('×4');
    expect(stdout).toContain('参照元');
  });

  it('shows unresolved dynamic components as ambiguous leaves unless explicitly ignored', async () => {
    const visible = await invoke({ component: 'OutletHostComponent', why: true });
    expect(visible.stdout).toContain('? Ambiguous component');
    expect(visible.stdout).toContain('candidates: GenericDialogTargetComponent | OutletTargetComponent');
    expect(visible.stdout).toContain('expression: runtimeComponent');

    const hidden = await invoke({ component: 'OutletHostComponent', ignoreAmbiguous: true });
    expect(hidden.stdout).not.toContain('? Ambiguous component');
  });

  it('walks parents and separates external usages and routes (PRD section 7)', async () => {
    const { stdout } = await invoke({ component: 'DialogTargetComponent', parents: true });
    expect(stdout).toContain('Component parents:');
    expect(stdout).toContain('DialogHostComponent');
    expect(stdout).toContain('External usages:');
    expect(stdout).toContain('ExternalUsageService');
    const treeSection = stdout.slice(0, stdout.indexOf('External usages:'));
    expect(treeSection).not.toContain('ExternalUsageService');
  });

  it('annotates inherited components and lists direct inheritance separately with --parents', async () => {
    const child = await invoke({ component: 'InheritanceDerivedComponent' });
    expect(child.stdout).toContain('InheritanceDerivedComponent [extends InheritanceBaseComponent]');
    expect(child.stdout).not.toContain('derived.component.ts#InheritanceDerivedComponent');
    expect(child.stdout).not.toContain('Inheritance:');

    const base = await invoke({ component: 'InheritanceBaseComponent', parents: true });
    expect(base.stdout).toContain('Inheritance:');
    expect(base.stdout).toContain('Extended by: InheritanceDerivedComponent');
    const treeSection = base.stdout.slice(0, base.stdout.indexOf('Inheritance:'));
    expect(treeSection).not.toContain('InheritanceDerivedComponent');
  });

  it('limits the depth and marks truncation', async () => {
    const { stdout } = await invoke({ component: 'AppComponent', depth: 1 });
    expect(stdout).toContain('ParentComponent');
    expect(stdout).not.toContain('ChildComponent');
    expect(stdout).toContain('[...]');
  });

  it('shows every occurrence with --why (PRD sections 8, 9)', async () => {
    const { stdout } = await invoke({ component: 'ChildComponent', why: true });
    const occurrences = stdout.split('\n').filter((line) => line.includes('[template]'));
    expect(occurrences).toHaveLength(4);
    expect(occurrences[0]).toContain('child.component.html:1');
    expect(occurrences[3]).toContain('child.component.html:4');
  });

  it('marks a cycle instead of recursing (PRD section 12)', async () => {
    const { stdout } = await invoke({ component: 'CycleAComponent' });
    expect(stdout).toContain('[cycle]');
  });

  it('prints every root tree and the unreachable components with --all', async () => {
    const { stdout } = await invoke({ all: true });
    expect(stdout).toContain('Angular Component Analysis (all)');
    expect(stdout).toContain('Unreachable:');
    expect(stdout).toContain('CycleAComponent');
    expect(stdout).toContain('Unowned ambiguous component usages:');
  });

  it('returns exit code 2 and the candidate list for an ambiguous name', async () => {
    const { code, stdout, stderr } = await invoke({ component: 'DuplicateClassComponent' });
    expect(code).toBe(EXIT.AMBIGUOUS);
    expect(stdout).toBe('');
    expect(stderr).toContain('Multiple components found:');
    expect(stderr).toContain('duplicate-a.component.ts#DuplicateClassComponent');
  });

  it('returns exit code 1 for an unknown component', async () => {
    const { code, stderr } = await invoke({ component: 'NoSuchComponent' });
    expect(code).toBe(EXIT.NOT_FOUND);
    expect(stderr).toContain('Component not found');
  });

  it('selects a component by selector and by ComponentId', async () => {
    const bySelector = await invoke({ component: 'basic-child' });
    expect(bySelector.stdout).toContain('ChildComponent');
    const byId = await invoke({ component: 'src/app/basic/child.component.ts#ChildComponent' });
    expect(byId.stdout).toContain('ChildComponent');
  });

  it('writes a file and prints only the saved path (PRD section 23)', async () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ngmaze-')), 'tree.txt');
    const { code, stdout } = await invoke({ component: 'ChildComponent', output: target }, true);
    expect(code).toBe(EXIT.OK);
    expect(stdout.trim()).toBe(`Saved: ${target}`);
    const written = fs.readFileSync(target, 'utf8');
    expect(written).toContain('LeafComponent');
    expect(written).not.toMatch(ANSI);
  });

  it('writes a linked Markdown tree in the analysis root with --md', async () => {
    const project = fixturePath('main');
    let target: string | undefined;
    try {
      const { code, stdout } = await invoke({ component: 'ChildComponent', project, md: true }, true);
      const saved = stdout.trim().match(/^Saved: (.+\/ng-maze-\d{8}-\d{6}\.md)$/);
      expect(code).toBe(EXIT.OK);
      expect(saved).not.toBeNull();
      target = saved![1]!;
      const written = fs.readFileSync(target, 'utf8');
      expect(written).toContain('[ChildComponent](<./src/app/basic/child.component.ts>)');
      expect(written).toContain('parent path: `./src/app/basic/`');
      expect(written).toContain('- [LeafComponent](<./src/app/basic/leaf.component.ts>)');
      expect(written).not.toMatch(ANSI);
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('calculates source links from the analysis root, including a nested workspace', async () => {
    const project = fixturePath('nested-workspace');
    let target: string | undefined;
    try {
      const { code, stdout } = await invoke({ component: 'NestedAppComponent', project, md: true });
      const saved = stdout.trim().match(/^Saved: (.+\/ng-maze-\d{8}-\d{6}\.md)$/);
      expect(code).toBe(EXIT.OK);
      expect(saved).not.toBeNull();
      target = saved![1]!;
      expect(fs.readFileSync(target, 'utf8')).toContain(
        '[NestedAppComponent](<./apps/web/src/nested-app.component.ts>)',
      );
      expect(fs.readFileSync(target, 'utf8')).toContain('parent path: `./apps/web/src/`');
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('writes a compact box-drawing tree with --mdc', async () => {
    const project = fixturePath('main');
    let target: string | undefined;
    try {
      const { code, stdout } = await invoke({ component: 'ChildComponent', project, mdc: true });
      const saved = stdout.trim().match(/^Saved: (.+\/ng-maze-\d{8}-\d{6}\.md)$/);
      expect(code).toBe(EXIT.OK);
      expect(saved).not.toBeNull();
      target = saved![1]!;
      expect(fs.readFileSync(target, 'utf8')).toContain(
        '└── [LeafComponent](<./src/app/basic/leaf.component.ts>)',
      );
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('writes a formatter-safe HTML box-drawing tree with --mdh', async () => {
    const project = fixturePath('main');
    let target: string | undefined;
    try {
      const { code, stdout } = await invoke({ component: 'ChildComponent', project, mdh: true });
      const saved = stdout.trim().match(/^Saved: (.+\/ng-maze-\d{8}-\d{6}\.md)$/);
      expect(code).toBe(EXIT.OK);
      expect(saved).not.toBeNull();
      target = saved![1]!;
      const written = fs.readFileSync(target, 'utf8');
      expect(written).toContain('<pre>');
      expect(written).toContain('parent path: `./src/app/basic/`');
      expect(written).toContain('└── <a href="./src/app/basic/leaf.component.ts">LeafComponent</a>');
      expect(written).toContain('</pre>');
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('keeps the edge kinds in the Markdown tree (issue 32, F-08)', async () => {
    const project = fixturePath('main');
    let target: string | undefined;
    try {
      const { stdout } = await invoke({ component: 'MixedHostComponent', project, md: true });
      target = stdout.trim().match(/^Saved: (.+\.md)$/)![1]!;
      const written = fs.readFileSync(target, 'utf8');
      expect(written).toContain('×2 [template×1, dialog×1]');
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('writes the root candidate list as a Markdown list (issue 32, F-09)', async () => {
    const project = fixturePath('main');
    let target: string | undefined;
    try {
      const { stdout } = await invoke({ project, md: true });
      target = stdout.trim().match(/^Saved: (.+\.md)$/)![1]!;
      const written = fs.readFileSync(target, 'utf8');
      const list = written.split('## Root / entry candidates')[1]!.trim().split('\n');
      expect(list.length).toBeGreaterThan(1);
      expect(list.every((line) => line.startsWith('- ') || line.trim() === '' || line.startsWith('#'))).toBe(true);
    } finally {
      if (target) fs.rmSync(target, { force: true });
    }
  });

  it('never overwrites a generated Markdown file (issue 32, F-14)', async () => {
    const project = fixturePath('main');
    const written: string[] = [];
    try {
      // Two runs inside the same second produce the same timestamped name.
      for (let attempt = 0; attempt < 2; attempt++) {
        const { stdout } = await invoke({ component: 'ChildComponent', project, md: true });
        written.push(stdout.trim().match(/^Saved: (.+\.md)$/)![1]!);
      }
      expect(new Set(written).size).toBe(2);
      expect(written.every((file) => fs.existsSync(file))).toBe(true);
    } finally {
      for (const file of written) fs.rmSync(file, { force: true });
    }
  });

  it('spells out the id of components that share a class name (issue 32, F-15)', async () => {
    const { stdout } = await invoke({ all: true });
    expect(stdout).toContain('DuplicateClassComponent src/app/symbols/duplicate-a.component.ts#DuplicateClassComponent');
    expect(stdout).toContain('DuplicateClassComponent src/app/symbols/duplicate-b.component.ts#DuplicateClassComponent');
  });

  it('prints resolution details only with --verbose', async () => {
    const quiet = await invoke({ component: 'ChildComponent' });
    expect(quiet.stderr).toBe('');
    const verbose = await invoke({ component: 'ChildComponent', verbose: true });
    expect(verbose.stderr).toContain('analysed files');
    expect(verbose.stderr).toContain('tsconfig seen   :');
    expect(verbose.stderr).toContain('timings (ms)');
    expect(verbose.stdout).not.toContain('timings');
  });
});

describe('CLI JSON output (plan section 32)', () => {
  it('separates global and result statistics', async () => {
    const { stdout } = await invoke({ component: 'ChildComponent', json: true });
    const document = JSON.parse(stdout);
    expect(document.global.stats.components).toBeGreaterThan(document.result.stats.components);
    expect(document.result.tree.className).toBe('ChildComponent');
    expect(document.error).toBeNull();
  });

  it('includes the resolved base component id in component JSON', async () => {
    const { stdout } = await invoke({ component: 'InheritanceDerivedComponent', json: true });
    const document = JSON.parse(stdout);
    expect(document.result.components[0].extendsComponent).toContain('#InheritanceBaseComponent');
  });

  it('still returns valid JSON when the component is ambiguous', async () => {
    const { code, stdout } = await invoke({ component: 'DuplicateClassComponent', json: true });
    expect(code).toBe(EXIT.AMBIGUOUS);
    const document = JSON.parse(stdout);
    expect(document.error.code).toBe('ambiguous');
    expect(document.error.candidates).toHaveLength(2);
    expect(document.result.components).toEqual([]);
  });

  it('still returns valid JSON when the component is missing', async () => {
    const { code, stdout } = await invoke({ component: 'NoSuchComponent', json: true });
    expect(code).toBe(EXIT.NOT_FOUND);
    const document = JSON.parse(stdout);
    expect(document.error.code).toBe('not-found');
  });

  it('contains no timing values so reruns diff cleanly', async () => {
    const { stdout } = await invoke({ json: true });
    expect(JSON.parse(stdout)).not.toHaveProperty('timings');
    expect(stdout).not.toMatch(/"(elapsedMs|durationMs|analysisTime)"/);
  });
});
