import { describe, expect, it } from 'vitest';
import { parseArgs, validate, type CliOptions } from '../../src/cli/options.js';
import { UserError } from '../../src/model/errors.js';
import { useColor } from '../../src/cli/run.js';

const base = (overrides: Partial<CliOptions> = {}): CliOptions => ({
  component: undefined,
  project: undefined,
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

describe('CLI parsing (plan section 33.1)', () => {
  it('keeps the short forms required by PRD section 28', () => {
    const options = parseArgs(['Foo', '-p', '/tmp/project', '-o', 'out.txt'], '0.0.0');
    expect(options.component).toBe('Foo');
    expect(options.project).toBe('/tmp/project');
    expect(options.output).toBe('out.txt');
  });

  it('parses every first version flag', () => {
    const options = parseArgs(['Foo', '--parents', '--depth', '3', '--why', '--ignore-ambiguous', '--json', '--verbose'], '0.0.0');
    expect(options).toMatchObject({ parents: true, depth: 3, why: true, ignoreAmbiguous: true, json: true, verbose: true });
  });

  it('parses --md', () => {
    expect(parseArgs(['Foo', '--md'], '0.0.0').md).toBe(true);
    expect(parseArgs(['Foo', '--mdc'], '0.0.0').mdc).toBe(true);
    expect(parseArgs(['Foo', '--mdh'], '0.0.0').mdh).toBe(true);
  });

  it('parses the analysis scope flags', () => {
    expect(parseArgs(['--angular-project', 'two'], '0.0.0').angularProject).toBe('two');
    expect(parseArgs(['--tsconfig', 'tsconfig.app.json'], '0.0.0').tsconfig).toBe('tsconfig.app.json');
  });
});

describe('CLI option combinations', () => {
  const invalid = (options: Partial<CliOptions>) => () => validate(base(options));

  it('rejects --all together with a component', () => {
    expect(invalid({ all: true, component: 'Foo' })).toThrow(UserError);
  });

  it('rejects --parents without a component', () => {
    expect(invalid({ parents: true })).toThrow(UserError);
  });

  it('rejects --why without a component and without --all', () => {
    expect(invalid({ why: true })).toThrow(UserError);
    expect(() => validate(base({ why: true, all: true }))).not.toThrow();
    expect(() => validate(base({ why: true, component: 'Foo' }))).not.toThrow();
  });

  it('rejects --angular-project together with --tsconfig', () => {
    expect(invalid({ angularProject: 'a', tsconfig: 'b' })).toThrow(UserError);
  });

  it('rejects --md with another output format or destination', () => {
    expect(invalid({ md: true, json: true })).toThrow(UserError);
    expect(invalid({ md: true, output: 'tree.md' })).toThrow(UserError);
    expect(invalid({ md: true, mdc: true })).toThrow(UserError);
    expect(invalid({ mdc: true, json: true })).toThrow(UserError);
    expect(invalid({ mdh: true, json: true })).toThrow(UserError);
    expect(invalid({ mdc: true, mdh: true })).toThrow(UserError);
  });

  it('rejects a depth that is not a positive integer', () => {
    expect(invalid({ depth: 0 })).toThrow(UserError);
    expect(invalid({ depth: -1 })).toThrow(UserError);
    expect(invalid({ depth: 1.5 })).toThrow(UserError);
    expect(invalid({ depth: 1001 })).toThrow(UserError);
    expect(() => parseArgs(['Foo', '--depth', 'abc'], '0.0.0')).toThrow(UserError);
    expect(() => validate(base({ depth: 1, component: 'Foo' }))).not.toThrow();
  });
});

describe('colour control (plan section 33)', () => {
  const io = (isTty: boolean, env: NodeJS.ProcessEnv = {}) => ({ stdout: () => {}, stderr: () => {}, isTty, env });

  it('colours only an interactive stdout', () => {
    expect(useColor(io(true), base())).toBe(true);
    expect(useColor(io(false), base())).toBe(false);
  });

  it('never colours a file, JSON, or NO_COLOR output', () => {
    expect(useColor(io(true), base({ output: 'x.txt' }))).toBe(false);
    expect(useColor(io(true), base({ md: true }))).toBe(false);
    expect(useColor(io(true), base({ mdc: true }))).toBe(false);
    expect(useColor(io(true), base({ mdh: true }))).toBe(false);
    expect(useColor(io(true), base({ json: true }))).toBe(false);
    expect(useColor(io(true, { NO_COLOR: '1' }), base())).toBe(false);
  });
});
