import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as TS from 'typescript';
import { UserError } from '../model/errors.js';
import { absPosix, compareCodePoint, existsDir, existsFile, isInside, realPathSafe, toPosix } from '../util/paths.js';

/** One `application` / `library` entry of angular.json (plan section 6). */
export interface AngularProject {
  name: string;
  projectType: string;
  /** Absolute. `root: ""` means the workspace root itself. */
  root: string;
  /** Absolute. Falls back to `<root>/src` and then `<root>`. */
  sourceRoot: string;
  /** Absolute path from `architect.build.options.tsConfig`, when present. */
  buildTsConfig: string | null;
}

export interface WorkspaceInfo {
  /** Where the analysis was started from (`--project`, default cwd). */
  analysisRoot: string;
  /** Canonical path used for discovery, module resolution, and source ownership. */
  resolvedAnalysisRoot: string;
  /** Base of every ComponentId (plan section 24). */
  workspaceRoot: string;
  angularJsonPath: string | null;
  /** Projects selected for this run. */
  projects: AngularProject[];
  /** Everything angular.json declared, for error messages. */
  allProjects: AngularProject[];
  /** Nested workspaces deliberately excluded from the single-program run. */
  skippedNestedWorkspacePaths: string[];
}

export interface WorkspaceOptions {
  project?: string | undefined;
  angularProject?: string | undefined;
  tsconfig?: string | undefined;
}

function findUp(startDir: string, fileName: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, fileName);
    if (existsFile(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Directories which cannot contain an Angular workspace that should be analysed. */
const WORKSPACE_SEARCH_EXCLUDE_DIRS = new Set([
  '.angular',
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'out-tsc',
]);

/**
 * Finds Angular workspaces nested below an analysis root. This makes a repository
 * root usable with `-p` when its Angular applications live under directories
 * such as `apps/web`. `node_modules` and generated output are deliberately not
 * searched: their contents are dependencies, not projects owned by the caller.
 */
function findAngularJsonBelow(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // An unreadable nested directory must not make the whole project unusable.
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'angular.json')) {
      found.push(absPosix(path.join(dir, 'angular.json')));
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || WORKSPACE_SEARCH_EXCLUDE_DIRS.has(entry.name)) continue;
      visit(path.join(dir, entry.name));
    }
  };

  visit(root);
  return found.sort(compareCodePoint);
}

/** angular.json allows comments and trailing commas, so parse it with the TS reader. */
function readWorkspaceJson(ts: typeof TS, file: string): any {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(file, text);
  if (parsed.error || !parsed.config) {
    throw new UserError(`Failed to parse ${toPosix(file)}.`);
  }
  return parsed.config;
}

function readProjects(ts: typeof TS, angularJsonPath: string): AngularProject[] {
  const root = path.dirname(angularJsonPath);
  const config = readWorkspaceJson(ts, angularJsonPath);
  const projects: AngularProject[] = [];

  for (const [name, raw] of Object.entries<any>(config.projects ?? {})) {
    const projectType = String(raw?.projectType ?? 'application');
    if (projectType !== 'application' && projectType !== 'library') continue;

    const projectRoot = path.resolve(root, String(raw?.root ?? ''));
    const sourceRootRaw = raw?.sourceRoot ? path.resolve(root, String(raw.sourceRoot)) : null;
    const sourceRoot = sourceRootRaw
      ?? (existsDir(path.join(projectRoot, 'src')) ? path.join(projectRoot, 'src') : projectRoot);

    const targets = raw?.architect ?? raw?.targets ?? {};
    const tsConfigRaw = targets?.build?.options?.tsConfig;
    const buildTsConfig = typeof tsConfigRaw === 'string' ? path.resolve(root, tsConfigRaw) : null;

    projects.push({
      name,
      projectType,
      root: absPosix(projectRoot),
      sourceRoot: absPosix(sourceRoot),
      buildTsConfig: buildTsConfig ? absPosix(buildTsConfig) : null,
    });
  }

  projects.sort((a, b) => compareCodePoint(a.name, b.name));
  return projects;
}

/**
 * Selection rules, plan section 6.1.
 *
 * - `--angular-project` wins and must exist
 * - `--tsconfig` makes angular.json optional
 * - otherwise every project that overlaps the analysis root is analysed, and
 *   the catalogs of all of them are merged into one graph
 */
export function resolveWorkspace(ts: typeof TS, options: WorkspaceOptions): WorkspaceInfo {
  const analysisRoot = absPosix(options.project ?? process.cwd());
  if (!existsDir(analysisRoot)) {
    throw new UserError(`Project path not found: ${analysisRoot}`);
  }
  const resolvedAnalysisRoot = realPathSafe(analysisRoot);

  const explicitTsconfig = options.tsconfig ? realPathSafe(absPosix(options.tsconfig)) : null;
  if (explicitTsconfig && !existsFile(explicitTsconfig)) {
    throw new UserError(`tsconfig not found: ${explicitTsconfig}`);
  }

  const angularJsonPath = findUp(resolvedAnalysisRoot, 'angular.json');
  const nestedAngularJsonPaths = explicitTsconfig ? [] : findAngularJsonBelow(resolvedAnalysisRoot)
    .filter((file) => file !== angularJsonPath);
  // An explicit tsconfig already supplies the source set, so avoid walking a
  // potentially large non-Angular repository in that mode.
  const angularJsonPaths = angularJsonPath
    ? [angularJsonPath]
    : explicitTsconfig
      ? []
      : findAngularJsonBelow(resolvedAnalysisRoot);
  const allProjects = angularJsonPaths.flatMap((file) => readProjects(ts, file));
  allProjects.sort((a, b) => compareCodePoint(a.name, b.name) || compareCodePoint(a.root, b.root));

  let projects: AngularProject[];
  if (options.angularProject) {
    const picked = allProjects.find((p) => p.name === options.angularProject);
    if (!picked) {
      const known = allProjects.map((p) => p.name).join(', ') || '(none)';
      throw new UserError(`Angular project "${options.angularProject}" not found. Known projects: ${known}`);
    }
    projects = [picked];
  } else {
    projects = allProjects.filter((p) => isInside(resolvedAnalysisRoot, p.root) || isInside(p.root, resolvedAnalysisRoot));
  }

  if (projects.length === 0 && !explicitTsconfig) {
    throw new UserError(
      angularJsonPaths.length > 0
        ? `No Angular project of angular.json overlaps ${analysisRoot}. Use --angular-project or --tsconfig.`
        : `No angular.json found above ${analysisRoot}. Use --tsconfig to analyse a project without angular.json.`,
    );
  }

  const workspaceRoot = angularJsonPath
    ? absPosix(path.dirname(angularJsonPath))
    : angularJsonPaths.length > 0
      ? resolvedAnalysisRoot
      : explicitTsconfig
      ? absPosix(path.dirname(explicitTsconfig))
      : resolvedAnalysisRoot;

  return {
    analysisRoot,
    resolvedAnalysisRoot,
    workspaceRoot,
    angularJsonPath: angularJsonPaths[0] ?? null,
    projects,
    allProjects,
    // Combining an enclosing workspace's compiler options with a separately
    // rooted child workspace is unsound. Surface the coverage boundary instead
    // of silently pretending the child was analysed.
    skippedNestedWorkspacePaths: angularJsonPath ? nestedAngularJsonPaths : [],
  };
}

/**
 * The project a source file belongs to. The most specific root wins so a nested
 * project (report-widgets) is not attributed to the workspace root project.
 */
export function projectOfFile(projects: AngularProject[], file: string): string | null {
  let best: AngularProject | null = null;
  for (const project of projects) {
    const base = project.sourceRoot || project.root;
    if (!isInside(base, file)) continue;
    if (!best || base.length > (best.sourceRoot || best.root).length) best = project;
  }
  return best ? best.name : null;
}
