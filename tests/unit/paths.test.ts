import { describe, expect, it } from 'vitest';
import { compareCodePoint, hasNodeModulesSegment, isInside, toPosix } from '../../src/util/paths.js';
import { computeIsInternal, isDeclaredInPackage } from '../../src/analysis/symbols.js';
import { isExcludedSourceFile } from '../../src/project/tsconfig.js';

describe('path helpers', () => {
  it('normalises separators', () => {
    expect(toPosix('a\\b\\c.ts')).toBe('a/b/c.ts');
  });

  it('detects containment without prefix collisions', () => {
    expect(isInside('/repo/apps/web', '/repo/apps/web/src/a.ts')).toBe(true);
    expect(isInside('/repo/apps/web', '/repo/apps/web')).toBe(true);
    expect(isInside('/repo/apps/web', '/repo/apps/web-extra/src/a.ts')).toBe(false);
  });

  it('only accepts a whole node_modules segment', () => {
    expect(hasNodeModulesSegment('/repo/node_modules/@angular/core/index.d.ts')).toBe(true);
    expect(hasNodeModulesSegment('/repo/src/my_node_modules_helper.ts')).toBe(false);
  });

  it('compares by code point, not by locale', () => {
    expect(compareCodePoint('A', 'a')).toBe(-1);
    expect(compareCodePoint('a', 'a')).toBe(0);
  });
});

/** Plan section 5: the order of the two rules is what makes pnpm work. */
describe('internal / external boundary', () => {
  const workspaceRoot = '/repo/apps/web';

  it('treats project sources as internal', () => {
    expect(computeIsInternal('/repo/apps/web/src/app/a.component.ts', workspaceRoot)).toBe(true);
  });

  it('treats node_modules as external even when the real path is inside the repo', () => {
    // pnpm layout: the real path of the package lives under the repo root.
    expect(computeIsInternal('/repo/node_modules/.pnpm/@angular+core@22.1.5/node_modules/@angular/core/index.d.ts', '/repo')).toBe(false);
    expect(computeIsInternal('/repo/apps/web/node_modules/@angular/core/index.d.ts', workspaceRoot)).toBe(false);
  });

  it('treats files outside the workspace as external', () => {
    expect(computeIsInternal('/elsewhere/lib/a.ts', workspaceRoot)).toBe(false);
  });

  it('recognises a package declaration path in both layouts', () => {
    expect(isDeclaredInPackage('/repo/node_modules/@angular/material/dialog/index.d.ts', '@angular/material')).toBe(true);
    expect(isDeclaredInPackage('/repo/node_modules/.pnpm/@angular+material@22.1.5/node_modules/@angular/material/dialog/index.d.ts', '@angular/material')).toBe(true);
    expect(isDeclaredInPackage('/repo/src/material/dialog.ts', '@angular/material')).toBe(false);
  });
});

/** Plan section 7.3: the analysis set drops test code, never by component naming. */
describe('analysis set exclusions', () => {
  it('drops spec, test and testing sources', () => {
    expect(isExcludedSourceFile('src/app/a.spec.ts')).toBe(true);
    expect(isExcludedSourceFile('src/app/a.test.ts')).toBe(true);
    expect(isExcludedSourceFile('src/app/testing/helper.ts')).toBe(true);
    expect(isExcludedSourceFile('e2e/run.ts')).toBe(true);
  });

  it('drops build output directories', () => {
    expect(isExcludedSourceFile('dist/main.ts')).toBe(true);
    expect(isExcludedSourceFile('out-tsc/app/main.ts')).toBe(true);
    expect(isExcludedSourceFile('node_modules/x/index.ts')).toBe(true);
  });

  it('keeps ordinary sources regardless of their file name', () => {
    expect(isExcludedSourceFile('src/app/weird-name.ts')).toBe(false);
    expect(isExcludedSourceFile('src/app/a.component.ts')).toBe(false);
    expect(isExcludedSourceFile('src/app/latest/build-config.ts')).toBe(false);
  });
});
