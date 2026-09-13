import { Command, Option } from 'commander';
import { UserError } from '../model/errors.js';
import { MAX_TREE_DEPTH } from '../query/tree.js';

export interface CliOptions {
  component: string | undefined;
  project: string | undefined;
  parents: boolean;
  depth: number | undefined;
  why: boolean;
  ignoreAmbiguous: boolean;
  all: boolean;
  json: boolean;
  md: boolean;
  mdc: boolean;
  mdh: boolean;
  output: string | undefined;
  angularProject: string | undefined;
  tsconfig: string | undefined;
  verbose: boolean;
}

export function buildCommand(version: string): Command {
  const command = new Command();
  command
    .name('npx mergelog/ng-maze')
    .description('Static analysis of Angular component relationships')
    .argument('[component]', 'component class name, selector or ComponentId (path#ClassName)')
    .option('-p, --project <path>', 'analysis root (default: current directory)')
    .option('--parents', 'walk usages upwards instead of downwards', false)
    .option('--depth <number>', 'limit tree depth (default: 1000)')
    .option('--why', 'show why each relation exists (kind, file, line)', false)
    .option('--ignore-ambiguous', 'hide unresolved dynamic-component placeholders from trees', false)
    .option('--all', 'print the tree of every root component', false)
    .option('--json', 'print the result as JSON', false)
    .option('--md', 'write a linked Markdown tree to ng-maze-YYYYMMDD-HHMMSS.md in the analysis root', false)
    .option('--mdc', 'write a compact box-drawing Markdown tree to ng-maze-YYYYMMDD-HHMMSS.md', false)
    .option('--mdh', 'write a formatter-safe HTML <pre> box-drawing Markdown tree to ng-maze-YYYYMMDD-HHMMSS.md', false)
    .option('-o, --output <file>', 'write the result to a file instead of stdout')
    .addOption(new Option('--angular-project <name>', 'analyse only this angular.json project'))
    .addOption(new Option('--tsconfig <path>', 'use this tsconfig as the source of compilerOptions'))
    .option('--verbose', 'print resolution and timing details on stderr', false)
    .version(version, '--version', 'print the ngmaze version')
    .helpOption('--help', 'show this help')
    .showHelpAfterError(false)
    // commander writes parse errors to stderr itself before throwing; the CLI
    // owns that output, so silencing it here keeps one message per failure.
    .configureOutput({ writeErr: () => {} })
    .exitOverride();
  return command;
}

/** Option combination rules, plan section 33.1. Violations exit with code 3. */
export function validate(options: CliOptions): void {
  const markdown = options.md || options.mdc || options.mdh;
  if (options.all && options.component) {
    throw new UserError('--all cannot be combined with a component argument.');
  }
  if (options.parents && !options.component) {
    throw new UserError('--parents needs a component argument.');
  }
  if (options.why && !options.component && !options.all) {
    throw new UserError('--why needs a component argument or --all.');
  }
  if (options.angularProject && options.tsconfig) {
    throw new UserError('--angular-project and --tsconfig cannot be combined.');
  }
  if ([options.md, options.mdc, options.mdh].filter(Boolean).length > 1) {
    throw new UserError('--md, --mdc, and --mdh cannot be combined.');
  }
  if (markdown && options.json) {
    throw new UserError('--md, --mdc, and --mdh cannot be combined with --json.');
  }
  if (markdown && options.output) {
    throw new UserError('--md, --mdc, and --mdh write ng-maze-YYYYMMDD-HHMMSS.md in the analysis root and cannot be combined with --output.');
  }
  if (options.depth !== undefined && (!Number.isInteger(options.depth) || options.depth < 1 || options.depth > MAX_TREE_DEPTH)) {
    throw new UserError(`--depth must be an integer from 1 to ${MAX_TREE_DEPTH}.`);
  }
}

export function parseArgs(argv: string[], version: string): CliOptions {
  const command = buildCommand(version);
  command.parse(argv, { from: 'user' });
  const raw = command.opts();
  const depthRaw = raw.depth as string | undefined;

  let depth: number | undefined;
  if (depthRaw !== undefined) {
    depth = /^-?\d+$/.test(depthRaw.trim()) ? Number(depthRaw.trim()) : Number.NaN;
  }

  const options: CliOptions = {
    component: command.args[0],
    project: raw.project as string | undefined,
    parents: Boolean(raw.parents),
    depth,
    why: Boolean(raw.why),
    ignoreAmbiguous: Boolean(raw.ignoreAmbiguous),
    all: Boolean(raw.all),
    json: Boolean(raw.json),
    md: Boolean(raw.md),
    mdc: Boolean(raw.mdc),
    mdh: Boolean(raw.mdh),
    output: raw.output as string | undefined,
    angularProject: raw.angularProject as string | undefined,
    tsconfig: raw.tsconfig as string | undefined,
    verbose: Boolean(raw.verbose),
  };

  validate(options);
  return options;
}
