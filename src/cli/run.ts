import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyze } from '../analysis/analyze.js';
import { EXIT, UserError } from '../model/errors.js';
import { buildView } from '../query/view.js';
import { selectComponent } from '../query/select.js';
import { renderJson, type JsonError } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderCandidates, renderText } from '../render/text.js';
import { absPosix, realPathSafe } from '../util/paths.js';
import type { CliOptions } from './options.js';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTty: boolean;
  env: NodeJS.ProcessEnv;
}

/** Plan section 33: never colour a file or a redirected stream. */
export function useColor(io: Io, options: CliOptions): boolean {
  if (options.output || options.md || options.mdc || options.mdh) return false;
  if (options.json) return false;
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== '') return false;
  return io.isTty;
}

function markdownFileName(now = new Date()): string {
  const number = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `ng-maze-${number(now.getFullYear(), 4)}${number(now.getMonth() + 1)}${number(now.getDate())}`
    + `-${number(now.getHours())}${number(now.getMinutes())}${number(now.getSeconds())}.md`;
}

/**
 * The generated Markdown name has second precision, so two runs started in the
 * same second would otherwise report "Saved" twice for one surviving file.
 * `wx` makes the check and the write one atomic step, which also holds between
 * concurrent processes.
 */
export function writeWithoutOverwriting(target: string, payload: string): string {
  const extension = path.extname(target);
  const base = target.slice(0, target.length - extension.length);
  for (let attempt = 1; attempt <= 100; attempt++) {
    const candidate = attempt === 1 ? target : `${base}-${attempt}${extension}`;
    try {
      fs.writeFileSync(candidate, payload, { encoding: 'utf8', flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new UserError(`Cannot write ${target}: 100 files with that name already exist.`);
}

export async function run(options: CliOptions, io: Io, version: string): Promise<number> {
  const markdown = options.md || options.mdc || options.mdh;
  const run = await analyze({
    project: options.project,
    angularProject: options.angularProject,
    tsconfig: options.tsconfig,
  });
  const { result, timings, warnings, context } = run;

  for (const warning of warnings) io.stderr(`warning: ${warning}\n`);

  if (options.verbose) {
    io.stderr(`ngmaze ${version}\n`);
    io.stderr(`  analysis root   : ${result.meta.analysisRoot}\n`);
    io.stderr(`  workspace root  : ${result.meta.workspaceRoot}\n`);
    io.stderr(`  angular projects: ${result.meta.angularProjects.join(', ') || '(none)'}\n`);
    io.stderr(`  tsconfig        : ${context.tsconfig.primary}\n`);
    if (context.tsconfig.merged.length > 0) {
      io.stderr(`  tsconfig merged : ${context.tsconfig.merged.join(', ')}\n`);
    }
    io.stderr(`  tsconfig seen   : ${context.tsconfig.considered.join(', ')}\n`);
    io.stderr(`  typescript      : ${result.meta.typescriptVersion} (${result.meta.typescriptSource})\n`);
    io.stderr(`  @angular/compiler: ${result.meta.angularCompilerVersion} (${result.meta.angularCompilerSource})\n`);
    io.stderr(`  analysed files  : ${result.meta.sourceFileCount} (excluded ${result.meta.excludedFileCount})\n`);
    io.stderr(`  templates parsed: ${result.meta.templateFileCount}\n`);
    io.stderr(`  timings (ms)    : ${Object.entries(timings).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
  }

  const color = useColor(io, options);
  let exitCode: number = EXIT.OK;
  let text: string | null = null;
  let jsonError: JsonError | null = null;
  let view = null as ReturnType<typeof buildView> | null;

  if (options.component) {
    const selection = selectComponent(result, options.component);
    if (selection.kind === 'found') {
      view = buildView(result, options, selection.id);
    } else if (selection.kind === 'ambiguous') {
      exitCode = EXIT.AMBIGUOUS;
      jsonError = {
        code: 'ambiguous',
        message: `Multiple components match "${options.component}".`,
        candidates: selection.candidates,
      };
      if (!options.json) text = renderCandidates(selection.candidates, color);
    } else {
      exitCode = EXIT.NOT_FOUND;
      jsonError = { code: 'not-found', message: `Component "${options.component}" not found.`, candidates: [] };
      if (!options.json) text = `Component not found: ${options.component}\n`;
    }
  } else {
    view = buildView(result, options);
  }

  if (options.json) {
    text = renderJson(view, result, {
      component: options.component ?? null,
      direction: options.parents ? 'parents' : 'children',
      depth: options.depth ?? null,
      all: options.all,
      why: options.why,
      ignoreAmbiguous: options.ignoreAmbiguous,
    }, version, jsonError);
  } else if (markdown && view) {
    text = renderMarkdown(view, {
      // The document is physically written through this path. When -p is a
      // symlink, resolve it so links are relative to the document's real
      // directory rather than to the symlink's unrelated parent.
      outputRoot: realPathSafe(result.meta.analysisRoot),
      treeStyle: options.mdh ? 'html' : options.mdc ? 'box' : 'list',
    });
  } else if (view) {
    text = renderText(view, { why: options.why, color });
  }

  if (view?.nodeBudgetExceeded) {
    io.stderr(
      `warning: the expanded tree hit the ${view.nodeBudgetLimit} node ceiling and was truncated ([...]).\n`
      + '         Shared components multiply the number of paths; rerun with --depth <n> for a bounded view.\n',
    );
  }
  if (view?.defaultDepthExceeded) {
    io.stderr(
      `warning: the expanded tree hit the default ${view.defaultDepthLimit} depth ceiling and was truncated ([...]).\n`
      + '         Rerun with --depth <n> to request a deeper bounded view.\n',
    );
  }

  const payload = text ?? '';

  if (exitCode !== EXIT.OK && !options.json) {
    // Component selection problems are user facing errors (plan section 34).
    io.stderr(payload);
    return exitCode;
  }

  if (options.output || markdown) {
    const target = markdown
      ? absPosix(path.join(result.meta.analysisRoot, markdownFileName()))
      : absPosix(path.resolve(options.output!));
    let written = target;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // `-o` names an exact file and may overwrite; a generated name may not.
      if (markdown) written = writeWithoutOverwriting(target, payload);
      else fs.writeFileSync(target, payload, 'utf8');
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError(`Cannot write ${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
    io.stdout(`Saved: ${written}\n`);
    return exitCode;
  }

  io.stdout(payload);
  return exitCode;
}
