import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, type AnalysisRun } from '../../src/analysis/analyze.js';
import type { AnalysisResult, ComponentId, Edge } from '../../src/model/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const fixturePath = (name: string): string => path.resolve(here, '..', 'fixtures', name);
export const isolatedFixturePath = (name: string): string => path.resolve(here, '..', 'fixtures-isolated', name);

const cache = new Map<string, Promise<AnalysisRun>>();

/** Analyses a fixture once per worker; every test file may call it freely. */
export function analyzeFixture(name: string, options: { tsconfig?: string; angularProject?: string } = {}): Promise<AnalysisRun> {
  const key = `${name}|${options.tsconfig ?? ''}|${options.angularProject ?? ''}`;
  let run = cache.get(key);
  if (!run) {
    run = analyze({
      project: fixturePath(name),
      ...(options.tsconfig ? { tsconfig: options.tsconfig } : {}),
      ...(options.angularProject ? { angularProject: options.angularProject } : {}),
    });
    cache.set(key, run);
  }
  return run;
}

export const componentIds = (result: AnalysisResult): ComponentId[] => result.components.map((c) => c.id);

export const classNames = (result: AnalysisResult): string[] => result.components.map((c) => c.className).sort();

export const edgesOf = (result: AnalysisResult, fromClass: string): Edge[] =>
  result.edges.filter((e) => e.from.endsWith(`#${fromClass}`));

export const edgeLabels = (edges: Edge[]): string[] =>
  edges.map((e) => `${e.from.split('#')[1]} -> ${e.to.split('#')[1]} [${e.kind}]`);

export const diagnosticsOf = (result: AnalysisResult, code: string) =>
  result.diagnostics.filter((d) => d.code === code);
