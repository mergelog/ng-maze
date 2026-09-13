import { beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import type * as TS from 'typescript';
import { loadToolchain } from '../../src/toolchain/load.js';
import { StaticEvaluator, asString, flatten, objectGet, type StaticValue } from '../../src/analysis/evaluator.js';
import { SymbolResolver } from '../../src/analysis/symbols.js';
import type { ProgramContext } from '../../src/project/program.js';
import { fixturePath } from '../helpers/fixtures.js';

/**
 * Plan sections 9 and 10: the evaluator evaluates values, the TypeChecker
 * resolves names, and arbitrary functions are never executed.
 */
describe('static evaluator', () => {
  let evaluator: StaticEvaluator;
  let samples: Map<string, StaticValue>;
  let ts: typeof TS;
  let cycleFile: TS.SourceFile;
  let symbols: SymbolResolver;

  beforeAll(async () => {
    const root = fixturePath('evaluator');
    const toolchain = await loadToolchain(root);
    ts = toolchain.ts;
    const rootNames = [path.join(root, 'src', 'values.ts'), path.join(root, 'src', 'cycle.ts')];
    const options: TS.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      experimentalDecorators: true,
      skipLibCheck: true,
      noEmit: true,
    };
    const program = ts.createProgram({ rootNames, options, host: ts.createCompilerHost(options, false) });
    const checker = program.getTypeChecker();
    const context = {
      ts,
      program,
      checker,
      workspace: { workspaceRoot: root, analysisRoot: root, projects: [], allProjects: [], angularJsonPath: null },
    } as unknown as ProgramContext;

    symbols = new SymbolResolver(context);
    evaluator = new StaticEvaluator(ts, symbols);

    const valuesFile = program.getSourceFile(rootNames[0]!)!;
    cycleFile = program.getSourceFile(rootNames[1]!)!;

    let objectLiteral: TS.ObjectLiteralExpression | undefined;
    const find = (node: TS.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'samples'
        && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        objectLiteral = node.initializer;
      }
      ts.forEachChild(node, find);
    };
    ts.forEachChild(valuesFile, find);
    const evaluated = evaluator.evaluate(objectLiteral!);
    samples = evaluated.k === 'object' ? evaluated.props : new Map();
  }, 60_000);

  const value = (key: string): StaticValue => samples.get(key)!;

  it('evaluates literals', () => {
    expect(value('stringLiteral')).toEqual({ k: 'prim', v: 'text' });
    expect(value('templateLiteral')).toEqual({ k: 'prim', v: 'no-substitution' });
    expect(value('numberLiteral')).toEqual({ k: 'prim', v: 42 });
    expect(value('negativeNumber')).toEqual({ k: 'prim', v: -7 });
    expect(value('booleanLiteral')).toEqual({ k: 'prim', v: true });
    expect(value('nullLiteral')).toEqual({ k: 'prim', v: null });
  });

  it('follows const bindings inside and across files', () => {
    expect(asString(value('localConst'))).toBe('local');
    expect(asString(value('importedConst'))).toBe('from-other-file');
  });

  it('refuses a mutable binding', () => {
    expect(value('mutableBinding').k).toBe('unknown');
  });

  it('evaluates arrays, spreads and nested arrays', () => {
    expect(flatten(value('array')).map((v) => (v.k === 'prim' ? v.v : v.k))).toEqual([1, 2, 3]);
    expect(flatten(value('spreadArray')).map((v) => (v.k === 'prim' ? v.v : v.k))).toEqual([1, 2, 3]);
  });

  it('evaluates objects, object spreads and property access', () => {
    expect(asString(objectGet(value('object'), 'b'))).toBe('two');
    expect(objectGet(value('spreadObject'), 'a')).toEqual({ k: 'prim', v: 1 });
    expect(asString(value('propertyAccess'))).toBe('deep');
    expect(value('elementAccess')).toEqual({ k: 'prim', v: 2 });
  });

  it('sees through as const, satisfies and parentheses', () => {
    expect(asString(value('asConst'))).toBe('as-const');
    expect(asString(value('satisfies'))).toBe('satisfied');
    expect(asString(value('parenthesized'))).toBe('parens');
  });

  it('resolves a conditional only when the condition is static', () => {
    expect(asString(value('staticConditional'))).toBe('yes');
    expect(value('runtimeConditional').k).toBe('unknown');
  });

  it('never executes an arbitrary function', () => {
    expect(value('functionCall').k).toBe('unknown');
  });

  it('returns class references for local and imported classes', () => {
    const local = value('localClass');
    expect(local.k).toBe('class');
    expect(local.k === 'class' && local.ref.name).toBe('LocalClass');
    const imported = value('importedClass');
    expect(imported.k === 'class' && imported.ref.name).toBe('ExportedClass');
    expect(imported.k === 'class' && imported.ref.file.endsWith('constants.ts')).toBe(true);
  });

  it('follows forwardRef only when it really is the Angular one', () => {
    expect(value('forwardRef').k).toBe('class');
    expect(value('forwardRefBlock').k).toBe('class');
    expect(value('fakeForwardRef').k).toBe('unknown');
  });

  it('stops on a circular value instead of recursing forever', () => {
    const results: StaticValue[] = [];
    const visit = (node: TS.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) results.push(evaluator.evaluate(node.initializer));
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(cycleFile, visit);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r !== undefined)).toBe(true);
  });
});
