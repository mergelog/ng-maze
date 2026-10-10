import { describe, expect, it } from 'vitest';
import { loadToolchain, supportedToolchain } from '../../src/toolchain/load.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('Angular 20/22 toolchain compatibility', () => {
  it.each([
    ['20.0.7', '5.8.3', true], ['20.1.7', '5.9.3', false],
    ['20.2.4', '5.9.3', true], ['20.3.33', '5.8.3', true],
    ['20.3.33', '5.9.3', true], ['20.3.33', '6.0.3', false],
    ['22.1.5', '6.0.3', true], ['22.1.5', '5.9.3', false],
    ['21.0.0', '5.9.3', false],
  ])('checks Angular %s with TS %s', (angular, typescript, expected) => {
    expect(supportedToolchain(angular as string, typescript as string)).toBe(expected);
  });

  it('loads the Node 22.22.0 compatible bundled fallback without warnings', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ngmaze-toolchain-'));
    try {
      const toolchain = await loadToolchain(root);
      expect(toolchain.ngVersion).toBe('20.3.33');
      expect(toolchain.tsVersion).toBe('5.9.3');
      expect(toolchain.ngSource).toBe('bundled');
      expect(toolchain.tsSource).toBe('bundled');
      expect(toolchain.warnings).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
