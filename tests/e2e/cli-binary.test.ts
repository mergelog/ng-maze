import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixturePath } from '../helpers/fixtures.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = path.join(repoRoot, 'dist', 'cli', 'index.js');
const project = fixturePath('main');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function ngmaze(args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: repoRoot,
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe('ngmaze binary', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }, 120_000);

  it('prints help and version without analysing anything', () => {
    const help = ngmaze(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('-p, --project <path>');
    expect(help.stdout).toContain('--parents');
    expect(help.stdout).toContain('--ignore-ambiguous');

    const version = ngmaze(['--version']);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('runs a component query and exits 0', () => {
    const run = ngmaze(['ChildComponent', '-p', project]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('LeafComponent');
    expect(run.stderr).toBe('');
  });

  it('produces plain text when stdout is redirected (PRD section 23)', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ngmaze-e2e-')), 'result.txt');
    const run = ngmaze(['ChildComponent', '-p', project]);
    fs.writeFileSync(target, run.stdout, 'utf8');
    expect(fs.readFileSync(target, 'utf8')).not.toMatch(new RegExp(String.fromCharCode(27) + '\\['));
  });

  it('reports CLI option violations with exit code 3', () => {
    expect(ngmaze(['--parents', '-p', project]).status).toBe(3);
    expect(ngmaze(['Foo', '--all', '-p', project]).status).toBe(3);
    expect(ngmaze(['--depth', '0', 'Foo', '-p', project]).status).toBe(3);
    const combined = ngmaze(['--angular-project', 'a', '--tsconfig', 'b', '-p', project]);
    expect(combined.status).toBe(3);
    expect(combined.stderr).toContain('cannot be combined');
  });

  it('reports a commander parse error exactly once (issue 32, F-10)', () => {
    const tooMany = ngmaze(['ChildComponent', 'Garbage', '-p', project]);
    expect(tooMany.status).toBe(3);
    expect(tooMany.stderr.trim().split('\n')).toEqual(['error: too many arguments. Expected 1 argument but got 2.']);

    const unknown = ngmaze(['--bogus', '-p', project]);
    expect(unknown.status).toBe(3);
    expect(unknown.stderr.trim().split('\n')).toHaveLength(1);
    expect(unknown.stderr).toContain('--bogus');
  });

  it('reports an unresolvable project with exit code 3', () => {
    const run = ngmaze(['-p', path.join(os.tmpdir(), 'definitely-not-here-ngmaze')]);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('not found');
  });

  it('exits 2 for an ambiguous component and 1 for a missing one', () => {
    expect(ngmaze(['DuplicateClassComponent', '-p', project]).status).toBe(2);
    expect(ngmaze(['NoSuchComponent', '-p', project]).status).toBe(1);
  });

  it('writes a file and keeps stdout to the saved line', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ngmaze-e2e-')), 'impact.txt');
    const run = ngmaze(['LeafComponent', '--parents', '--why', '-o', target, '-p', project]);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`Saved: ${target}`);
    expect(fs.readFileSync(target, 'utf8')).toContain('[template]');
  });

  it('writes JSON to a file when --json and -o are combined', () => {
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ngmaze-e2e-')), 'graph.json');
    const run = ngmaze(['--json', '-o', target, '-p', project]);
    expect(run.status).toBe(0);
    const document = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(document.global.stats.components).toBeGreaterThan(0);
  });

  it('honours NO_COLOR', () => {
    const run = ngmaze(['ChildComponent', '-p', project], { NO_COLOR: '1' });
    expect(run.stdout).not.toMatch(new RegExp(String.fromCharCode(27) + '\\['));
  });

  it('accepts --tsconfig for a workspace without angular.json', () => {
    const solution = fixturePath('solution');
    const run = ngmaze(['-p', solution, '--tsconfig', path.join(solution, 'tsconfig.json')]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Components');
  });
});
