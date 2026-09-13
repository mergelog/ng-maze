# ngmaze

English | [日本語](README.ja.md)

`ngmaze` is a CLI that answers four questions about a large Angular codebase, fast:

```text
What lives under this component?
Where is this component used from?
How far does a change to it reach?
Why are these two components connected?
```

It is not a documentation generator. It is a `tree`-like tool for reading code.

```bash
npx mergelog/ng-maze ProjectsPageComponent
```

```text
ProjectsPageComponent
├── ProjectsListComponent
│   ├── ProjectCardComponent (参照元: 2)
│   │   ├── CardComponent (参照元: 8)
│   │   └── ProjectCardMenuExtendedComponent
│   │       ├── MenuComponent (参照元: 17)
│   │       └── MenuItemComponent (参照元: 31) ×4
│   └── SearchResultsTableComponent
└── RouterTabNavBarComponent
```

`参照元` is the number of **distinct components** that use it; `×4` is how often this
one parent uses it.

## Run from GitHub

```bash
npx mergelog/ng-maze --all --mdh -p .
```

This repository is not currently published to npm, so run it directly with
`npx mergelog/ng-maze`. The `-p .` option analyses the current directory.

Requires Node.js `^22.22.3 || ^24.15.0 || >=26`.

`ngmaze` resolves `typescript` and `@angular/compiler` from the analysed project
first and falls back to its own copies. `--verbose` prints which ones were used.

## Usage

```bash
npx mergelog/ng-maze                                  # project summary
npx mergelog/ng-maze ProjectsPageComponent            # children
npx mergelog/ng-maze MenuItemComponent --parents      # impact of a change
npx mergelog/ng-maze ProjectsPageComponent --depth 3  # limit the depth
npx mergelog/ng-maze MenuItemComponent --parents --why
npx mergelog/ng-maze --all                            # every root tree
npx mergelog/ng-maze --all --ignore-ambiguous         # hide unresolved dynamic placeholders
npx mergelog/ng-maze ProjectsPageComponent -o tree.txt
npx mergelog/ng-maze --json -o component-graph.json
npx mergelog/ng-maze ProjectsPageComponent --md        # deprecated: linked Markdown tree at <project>/ng-maze-YYYYMMDD-HHMMSS.md
npx mergelog/ng-maze ProjectsPageComponent --mdc       # deprecated: compact box-drawing Markdown tree
npx mergelog/ng-maze ProjectsPageComponent --mdh       # formatter-safe HTML box-drawing Markdown tree
npx mergelog/ng-maze ProjectsPageComponent -p /path/to/angular/project
```

A component can be named by class name, by selector, or by its full ComponentId
(`src/app/app.component.ts#AppComponent`). When a class name is ambiguous
`ngmaze` prints every candidate instead of picking one.

### Options

| Option | Meaning |
| --- | --- |
| `-p, --project <path>` | analysis root (default: current directory) |
| `--parents` | walk usages upwards |
| `--depth <number>` | limit tree depth (default: 1,000; see the node ceiling below) |
| `--why` | show kind, file and line for every relation |
| `--ignore-ambiguous` | hide unresolved dynamic-component placeholders from trees and result views |
| `--all` | print every root tree plus unreachable components |
| `--json` | machine readable output |
| `--mdh` | write a linked box-drawing tree inside HTML `<pre>`; recommended when the Markdown will be formatted |
| `--md` | deprecated: write a linked Markdown tree to `ng-maze-YYYYMMDD-HHMMSS.md` in the analysis root |
| `--mdc` | deprecated: write a linked box-drawing Markdown tree; use it before running a Markdown formatter |
| `-o, --output <file>` | write to a file (never with ANSI colours) |
| `--angular-project <name>` | analyse only this `angular.json` project |
| `--tsconfig <path>` | use this tsconfig as the source of compilerOptions |
| `--verbose` | resolution and timing details on stderr |
| `--help`, `--version` | |

Combination rules are checked, never silently ignored: `--all` excludes a
component argument, `--parents` needs one, `--why` needs a component or `--all`,
`--depth` must be an integer from 1 to 1,000, `--angular-project` cannot be
combined with `--tsconfig`, and `--md` / `--mdc` / `--mdh` cannot be combined with each
other, `--json`, or `--output`. The generated Markdown lives at the analysis
root so each component label can link to its source file with a relative path.
A generated Markdown file is never overwritten: a second run in the same second
writes `…-2.md`. Because these files land in the analysed project, adding
`ng-maze-*.md` to its `.gitignore` is usually what you want.

### The node ceiling

The default depth is 1,000. This keeps deeply chained projects from exhausting
the JavaScript stack and prevents indentation from creating unbounded output.
The tree is also an expansion of a graph: when components are shared by many
parents (a design system, for example), the number of tree nodes grows with the
number of paths, not with the number of components. Expansion therefore stops at
200,000 nodes. Either cut is marked `[...]` and reported on stderr. Use
`--depth <n>` to request a different bounded depth (up to 1,000); all tree walks are iterative.

## The tree is static analysis, not the runtime DOM

**What `ngmaze` prints is the set of component relations that can be established
statically from the source. It is not the browser's DOM and not the runtime
component instance tree.**

`@if`, `@for`, `@switch`, `@defer`, routes, `ng-content` and dynamic components
all decide at runtime what is actually on screen. A component inside `@if` is
listed because it *can* be used there, not because it is rendered at the same
time as its siblings.

An edge exists only when all three hold:

1. a selector matched,
2. the match is visible from the owner's Angular scope (standalone `imports` or
   NgModule compilation scope), and
3. exactly one project component is identified.

When a real dynamic Angular API is found but its target cannot be reduced to one
component, ngmaze adds a `? Ambiguous component` leaf. If a conservative
candidate set can be enumerated it is shown on that leaf; otherwise the source
expression and location remain visible. This leaf is not a component and does
not affect edges, reference counts, roots, reachability, or impact calculations.

An ambiguous call owned by a service, function, or file cannot be attached to a
component without inventing a parent, so it is shown under `Unowned ambiguous
component usages`. `--ignore-ambiguous` hides both forms. JSON keeps the complete
audit trail in `global.detectionGaps` even when result-view placeholders are
hidden.

Content projection is also source-oriented: a component written inside a
wrapper element remains a child of the template owner. ngmaze does not move it
under the wrapper to imitate the runtime DOM.

## Relations ngmaze reports

| Kind | Source |
| --- | --- |
| `template` | selector match in a template, including control flow and deferred blocks |
| `dialog` | `MatDialog.open(Component)` (verified by receiver type, not property name) |
| `create-component` | `ViewContainerRef.createComponent` and `createComponent` from `@angular/core` |
| `ng-component-outlet` | `[ngComponentOutlet]` resolving statically to a component class |

Routes and non-component callers are deliberately **not** component parents:

* `Route entries` list `component` / `loadComponent` targets,
* `External usages` list services, effects, plain functions and top level code
  that create components.

Both are printed in their own sections and are excluded from the `参照元` count.

If a component directly extends another internal component, its tree label is
annotated as `PipelineCardComponent [extends ProjectCardComponent]`. Inheritance
is not an edge and therefore does not affect the component tree, `参照元`, or root
candidates. A `--parents` query lists the direct base component and direct
derived components in a separate `Inheritance:` section.

## Warnings are not failures

The summary ends with a `Warnings:` block. In JSON the same information lives
under the `diagnostics` key of `global` and `result` — display word and JSON key
differ on purpose; they are the same data.

```text
Warnings:
  ambiguous selectors : 1
  unresolved dynamics : 2
```

A warning means "this could not be resolved statically", not "the analysis
failed". Exit code stays `0`. Use `--why` or `--json` for file and line.

| Code | Meaning |
| --- | --- |
| `component-metadata` | a metadata field could not be evaluated statically |
| `multiple-ngmodule-declarations` | a component is declared in more than one NgModule |
| `missing-template` | `templateUrl` points at a file that does not exist |
| `template-parse-error` | the template could not be parsed; no edges are invented from it |
| `unresolved-scope` | a project local dependency of the scope could not be resolved |
| `ambiguous-selector` | two or more project components match one element |
| `selector-out-of-scope` | a project component matches but is not imported |
| `unresolved-route` | a route target could not be resolved statically |
| `unresolved-dynamic` | a dynamic component target could not be resolved statically |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | success — warnings included |
| `1` | component not found |
| `2` | component name ambiguous |
| `3` | user side error: CLI input, project or tsconfig resolution, output path |
| `4` | internal ngmaze error |

`--json` always produces a valid JSON document, including for exit codes 1 and 2,
where `result` is empty and `error` carries the candidates.

## What ngmaze analyses

* every `application` and `library` project of `angular.json` that overlaps the
  analysis root, merged into one graph (each component keeps its project name)
* one TypeScript `Program` for that graph: its `compilerOptions` come from one
  primary tsconfig (the shallowest project, `application` before `library`), and
  the `paths` aliases of the other projects are merged into it so an import
  written through another project's alias still resolves. `--verbose` prints the
  primary tsconfig, the merged ones, and every tsconfig consulted
* the union of the tsconfig file list and every project `sourceRoot`, so a
  component that no entry point imports is still found
* spec, test, `testing/` and `e2e/` sources are excluded; `--verbose` prints how
  many files that dropped

If `@angular/core` cannot be resolved, `ngmaze` stops with exit code 3 instead of
reporting "0 components".

## What v1 deliberately does not do

* reimplement the Angular compiler
* expand components inside external npm packages (`<mat-icon>` is simply not part
  of your project graph)
* execute arbitrary functions or resolve runtime-decided components
* reproduce the runtime router configuration
* analyse runtime DI
* lint templates or check unknown HTML elements
* resolve the selectorless template syntax (`<MyComponent />`)

Nothing that cannot be established statically is filled in by guessing.

## JSON output

See [docs/JSON_SCHEMA.md](docs/JSON_SCHEMA.md) and the formal schema in
[docs/ngmaze.schema.json](docs/ngmaze.schema.json). The document contains no
timing values so that repeated runs diff cleanly, and all arrays are ordered
deterministically.

## Development

```bash
npm install
npm run build
npm test
```

`npm test` runs contract tests against the resolved `@angular/compiler`, unit,
integration, CLI and end-to-end tests.

## License

MIT
