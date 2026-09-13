import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as TS from 'typescript';
import { UserError } from '../model/errors.js';
import { absPosix, compareCodePoint, toPosix } from '../util/paths.js';
import type { AngularProject, WorkspaceInfo } from './workspace.js';

/** Default analysis-set exclusions, plan section 7.3. */
export const DEFAULT_EXCLUDE_DIRS = ['node_modules', 'dist', 'out-tsc', 'coverage', '.angular', '.git'];
export const SPEC_FILE_PATTERN = /(\.spec|\.test)\.tsx?$/;
export const TEST_DIR_PATTERN = /(^|\/)(testing|e2e|__tests__|__mocks__)\//;

export interface TsConfigResolution {
  /** The tsconfig whose compilerOptions are authoritative (plan section 7.2). */
  primary: string;
  parsed: TS.ParsedCommandLine;
  /** Every tsconfig consulted, for `--verbose`. */
  considered: string[];
  /** Other project tsconfigs whose `paths` were merged into `options`. */
  merged: string[];
  /** The compilerOptions the program is actually created with. */
  options: TS.CompilerOptions;
  /** Path aliases that could not be merged because the primary defines them differently. */
  warnings: string[];
}

function parseTsconfig(ts: typeof TS, file: string): TS.ParsedCommandLine {
  const read = ts.readConfigFile(file, (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  });
  if (read.error) {
    throw new UserError(`Failed to read ${toPosix(file)}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  }
  return ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
}

/** `references` only, no own input files (plan section 7.4). */
function isSolutionStyle(parsed: TS.ParsedCommandLine): boolean {
  const references = parsed.projectReferences ?? [];
  if (references.length === 0) return false;
  const raw = parsed.raw ?? {};
  const hasFiles = Array.isArray(raw.files) && raw.files.length > 0;
  const hasInclude = Array.isArray(raw.include) && raw.include.length > 0;
  return !hasFiles && !hasInclude;
}

/** Selection order of plan section 7.1. */
function candidatesFor(project: AngularProject): string[] {
  const candidates: string[] = [];
  if (project.buildTsConfig) candidates.push(project.buildTsConfig);
  candidates.push(path.join(project.root, 'tsconfig.app.json'));
  candidates.push(path.join(project.root, 'tsconfig.json'));
  return candidates.map(absPosix);
}

/** Where a tsconfig's `paths` values are resolved from (`baseUrl`, else the config's directory). */
function pathsBaseOf(parsed: TS.ParsedCommandLine, file: string): string {
  const options = parsed.options as TS.CompilerOptions & { pathsBasePath?: string };
  return absPosix(String(options.baseUrl ?? options.pathsBasePath ?? path.dirname(file)));
}

/** Rewrites one `paths` target so it means the same thing relative to another base. */
function rebaseTarget(target: string, from: string, to: string): string {
  if (from === to) return target;
  const absolute = path.resolve(from, target);
  const rebased = toPosix(path.relative(to, absolute));
  return rebased === '' ? '.' : rebased;
}

/**
 * One program is created for the whole workspace, so its single set of
 * compilerOptions has to know every project's aliases. Without this, an import
 * written through another project's alias does not resolve and the edge
 * silently disappears (a `library` tsconfig winning over an `application` one
 * used to be decided by path-string length).
 */
function mergeProjectPaths(
  ts: typeof TS,
  workspace: WorkspaceInfo,
  primary: string,
  parsed: TS.ParsedCommandLine,
  considered: string[],
): { options: TS.CompilerOptions; merged: string[]; warnings: string[] } {
  const primaryBase = pathsBaseOf(parsed, primary);
  const paths: Record<string, string[]> = {};
  for (const [key, targets] of Object.entries(parsed.options.paths ?? {})) paths[key] = [...targets];
  const merged: string[] = [];
  const warnings: string[] = [];
  let changed = false;

  for (const project of workspace.projects) {
    for (const candidate of candidatesFor(project)) {
      if (!fs.existsSync(candidate)) continue;
      if (!considered.includes(candidate)) considered.push(candidate);
      if (candidate === primary) break;

      let other: TS.ParsedCommandLine;
      try {
        other = parseTsconfig(ts, candidate);
      } catch {
        // A broken sibling tsconfig must not stop the analysis.
        break;
      }
      merged.push(candidate);
      const otherBase = pathsBaseOf(other, candidate);
      for (const [key, targets] of Object.entries(other.options.paths ?? {})) {
        const rebased = targets.map((target) => rebaseTarget(target, otherBase, primaryBase));
        const existing = paths[key];
        if (existing) {
          if (existing.join('|') !== rebased.join('|')) {
            warnings.push(
              `path alias "${key}" is defined differently in ${toPosix(primary)} and ${toPosix(candidate)}; `
              + 'the first definition is used.',
            );
          }
          continue;
        }
        paths[key] = rebased;
        changed = true;
      }
      break;
    }
  }

  if (!changed) return { options: parsed.options, merged, warnings };
  // `pathsBasePath` is what TypeScript resolves `paths` against when no
  // `baseUrl` is set; pinning it keeps the rebased targets meaningful.
  return {
    options: { ...parsed.options, paths, pathsBasePath: primaryBase } as TS.CompilerOptions,
    merged,
    warnings,
  };
}

export function resolveTsconfig(
  ts: typeof TS,
  workspace: WorkspaceInfo,
  explicitTsconfig: string | undefined,
): TsConfigResolution {
  const considered: string[] = [];

  const pickPrimaryProject = (): AngularProject | undefined => {
    const projects = workspace.projects;
    const atWorkspaceRoot = projects.find((p) => p.root === workspace.workspaceRoot);
    if (atWorkspaceRoot) return atWorkspaceRoot;

    // When `-p` names a repository that contains a workspace and a nested
    // application/library, neither root is necessarily `workspaceRoot`.
    // `workspace.projects` is sorted by name, so taking its first entry could
    // make a nested project's tsconfig govern the whole workspace and hide
    // components that require the parent app's path/compiler settings.  The
    // shallowest project is the workspace-level application in this shape.
    // Directory depth, not path-string length: `apps/web` and `libs/ui` sit at
    // the same level, and a one-character rename must never flip the winner.
    // An `application` owns the workspace-level compilerOptions before a
    // `library` does.
    const depthOf = (root: string): number => root.split('/').filter(Boolean).length;
    const typeRank = (project: AngularProject): number => (project.projectType === 'application' ? 0 : 1);
    return [...projects].sort((a, b) =>
      depthOf(a.root) - depthOf(b.root)
      || typeRank(a) - typeRank(b)
      || compareCodePoint(a.name, b.name)
      || compareCodePoint(a.root, b.root),
    )[0];
  };

  let primary: string | undefined;
  if (explicitTsconfig) {
    primary = absPosix(explicitTsconfig);
  } else {
    const project = pickPrimaryProject();
    if (project) {
      for (const candidate of candidatesFor(project)) {
        considered.push(candidate);
        if (fs.existsSync(candidate)) {
          primary = candidate;
          break;
        }
      }
    }
  }

  if (!primary) {
    throw new UserError(
      `No tsconfig found for the analysed project. Looked at: ${considered.join(', ') || '(nothing)'}. Use --tsconfig.`,
    );
  }
  if (!considered.includes(primary)) considered.push(primary);

  let parsed = parseTsconfig(ts, primary);

  // Solution style tsconfig: follow references instead of returning an empty
  // program (plan section 7.4).
  if (isSolutionStyle(parsed)) {
    const seen = new Set<string>([primary]);
    const queue = [...(parsed.projectReferences ?? [])];
    let replacement: { file: string; parsed: TS.ParsedCommandLine } | undefined;

    while (queue.length > 0) {
      const reference = queue.shift()!;
      const referencePath = absPosix(reference.path);
      const file = fs.existsSync(referencePath) && fs.statSync(referencePath).isDirectory()
        ? absPosix(path.join(referencePath, 'tsconfig.json'))
        : referencePath;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!fs.existsSync(file)) continue;
      considered.push(file);
      const referenced = parseTsconfig(ts, file);
      if (isSolutionStyle(referenced)) {
        queue.push(...(referenced.projectReferences ?? []));
        continue;
      }
      if (!replacement) replacement = { file, parsed: referenced };
    }

    if (!replacement) {
      throw new UserError(
        `${toPosix(primary)} is a solution style tsconfig and none of its references could be resolved. ` +
        'Pass a concrete tsconfig with --tsconfig.',
      );
    }
    primary = replacement.file;
    parsed = replacement.parsed;
  }

  const { options, merged, warnings } = explicitTsconfig
    ? { options: parsed.options, merged: [] as string[], warnings: [] as string[] }
    : mergeProjectPaths(ts, workspace, primary, parsed, considered);

  considered.sort(compareCodePoint);
  return { primary, parsed, considered: [...new Set(considered)], merged: merged.sort(compareCodePoint), options, warnings };
}

export function isExcludedSourceFile(workspaceRelative: string): boolean {
  const p = toPosix(workspaceRelative);
  if (SPEC_FILE_PATTERN.test(p)) return true;
  if (TEST_DIR_PATTERN.test('/' + p)) return true;
  const segments = p.split('/');
  return segments.some((segment) => DEFAULT_EXCLUDE_DIRS.includes(segment));
}
