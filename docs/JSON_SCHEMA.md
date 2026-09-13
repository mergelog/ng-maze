# ngmaze JSON output

`ngmaze --json` prints one JSON document to stdout (or to `-o <file>`). The
formal contract is [`ngmaze.schema.json`](./ngmaze.schema.json); this page
explains what the parts mean.

The document never contains timing values, and every array has a deterministic
order, so two runs over unchanged code produce byte identical output.

```jsonc
{
  "ngmazeVersion": "0.1.0",
  "query":  { /* what was asked */ },
  "meta":   { /* how the project was resolved */ },
  "global": { /* the whole project */ },
  "result": { /* this query only */ },
  "error":  null
}
```

## `query`

Echoes the request so a stored document explains itself.

| Field | Meaning |
| --- | --- |
| `component` | the component argument, or `null` |
| `direction` | `children` or `parents` (`--parents`) |
| `depth` | `--depth`, or `null` when the default depth ceiling (1,000) is used |
| `all` | whether `--all` was used |
| `why` | whether `--why` was used (the JSON always carries every occurrence) |
| `ignoreAmbiguous` | whether `--ignore-ambiguous` was used; `global.detectionGaps` keeps the audit trail either way |

## `meta`

Resolution facts, useful when a result is surprising.

| Field | Meaning |
| --- | --- |
| `workspaceRoot` | base of every ComponentId |
| `analysisRoot` | where the analysis started (`-p`) |
| `angularProjects` | `angular.json` projects that were analysed |
| `tsconfigFiles` | the tsconfig that owns `compilerOptions`, followed by the other project tsconfigs whose `paths` were merged into it |
| `typescriptVersion` / `typescriptSource` | version used and whether it came from the analysed `project` or from ngmaze's `bundled` copy |
| `angularCompilerVersion` / `angularCompilerSource` | the same for `@angular/compiler` |
| `sourceFileCount` | analysed TypeScript files |
| `excludedFileCount` | files dropped by the spec / build output rules |
| `templateFileCount` | distinct external template files parsed |

## `global` vs `result`

`global` always describes the **whole project**; `result` describes **this query**.
Asking about one component must never make the project look smaller.

Both carry `stats` and `diagnostics`:

```jsonc
"global": {
  "stats": { "components": 352, "templateUsages": 704, "dynamicUsages": 66,
             "routeEntries": 157, "externalUsages": 20 },
  "diagnostics":   [ /* every diagnostic in the project */ ],
  "detectionGaps": [ /* everything the analysis could not see, project wide */ ]
}
```

All three keys are always present. `diagnostics` is the JSON name of what the
text output prints under `Warnings:`. They are the same data; a diagnostic is not
a failure.

`global.detectionGaps` is the audit trail: it lists what ngmaze could **not**
resolve, so a consumer can tell "there is no such relation" from "the relation
could not be seen". It is never filtered by the query, and `--ignore-ambiguous`
does not remove anything from it.

`result` additionally carries the query payload:

| Field | Meaning |
| --- | --- |
| `rootCandidates` | components with no component parent (routes and external usages do not count) |
| `components` | components inside this result |
| `edges` | component to component relations inside this result |
| `routes` | route entries for the queried component, or all of them |
| `externalUsages` | non component callers, same scoping |
| `ambiguousUsages` | dynamic component usages whose target is not one component; empty when `--ignore-ambiguous` was used |
| `tree` | the query tree, or `null` |
| `trees` | one tree per root for `--all` |
| `unreachable` | components no root reaches (`--all`), including pure cycles |
| `diagnostics` | diagnostics owned by components in this result |

## Core objects

### Component

```jsonc
{
  "id": "src/app/app.component.ts#AppComponent",
  "className": "AppComponent",
  "extendsComponent": null,
  "selector": "app-root",
  "selectorUnresolved": false,
  "templateKind": "external",
  "templateFile": "/abs/path/app.component.html",
  "effectiveStandalone": true,
  "standaloneExplicit": null,
  "angularProject": "stackup",
  "file": "/abs/path/app.component.ts",
  "location": { "file": "src/app/app.component.ts", "line": 57, "column": 14, "precision": "exact" }
}
```

`id` is `workspace-relative-path#ClassName`, always `/` separated so the output
does not change between operating systems. An anonymous `export default class`
uses `default` as its class part.

`effectiveStandalone` is Angular's semantics (anything but an explicit
`standalone: false`); `standaloneExplicit` is what the metadata actually said.
`extendsComponent` is the immediate base class's ComponentId when TypeScript
resolves it to another internal component in the catalog; otherwise it is
`null`. Inheritance is metadata, not an edge, so it does not affect trees,
reference counts or root candidates.

### Edge

```jsonc
{ "from": "…#AppComponent", "to": "…#HeaderComponent", "kind": "template",
  "location": { "file": "src/app/app.component.html", "line": 12, "column": 1, "precision": "exact" },
  "order": 3 }
```

One edge per **occurrence**: four usages in one template are four edges. `kind`
is `template`, `ng-component-outlet`, `dialog` or `create-component`, and `order`
is the display order inside `from` (kind groups in that order, source order
inside a group).

### Location and `precision`

`file` is workspace relative, `line` and `column` are 1 based. `precision` is
`exact`, or `approximate` for an inline template whose string literal contains
escapes, where the offset cannot be mapped back exactly.

### Route entry

```jsonc
{ "path": "/projects/:projectId/overview", "target": "…#ProjectInfoComponent",
  "targetKind": "loadComponent", "location": { … }, "angularProject": "stackup" }
```

Routes are never component parents. `path` is the best effort static path, not a
reproduction of the router runtime configuration.

### External usage

```jsonc
{ "callerKind": "class", "callerName": "ProjectsEffects", "target": "…#ConfirmDialogComponent",
  "kind": "dialog", "location": { … } }
```

Components created from services, effects, functions or top level code. Kept out
of the component tree and out of the reference count on purpose.

### Diagnostic

```jsonc
{ "code": "ambiguous-selector", "message": "…", "file": "src/…/a.html",
  "location": { … }, "owner": "…#HostComponent", "detail": "id-a, id-b" }
```

`owner` is the component the diagnostic belongs to, or `null` (route diagnostics).
`detail` is optional extra context, such as the competing component ids.

### Ambiguous usage

```jsonc
{ "owner": "…#HostComponent", "callerKind": "class", "callerName": "HostComponent",
  "kind": "dialog", "expression": "flag ? AComponent : BComponent",
  "message": "MatDialog.open target could not be resolved statically.",
  "location": { … }, "candidates": ["…#AComponent", "…#BComponent"] }
```

A real Angular dynamic-component call whose target cannot be reduced to one
component. It is deliberately **not** an edge: the relation stays visible without
claiming that any candidate is rendered. `owner` is the component that contains
the call, or `null` when a service, function or top level code made it (those are
printed under `Unowned ambiguous component usages`). `candidates` are the
statically enumerable internal components, never a guess. `kind` is one of
`ng-component-outlet`, `dialog`, `create-component`.

### Detection gap

```jsonc
{ "code": "unresolved-dynamic-target", "message": "…", "file": "src/…/host.ts",
  "location": { … }, "owner": "…#HostComponent", "detail": "dynamic expression",
  "candidates": ["…#AComponent"] }
```

Deliberately separate from `diagnostics`: a gap says "something may not have been
detected", a diagnostic says "a detected relation has a problem". `code` is one of

| Code | Meaning |
| --- | --- |
| `decorated-but-not-catalogued` | a class carrying `@Component` that the catalog does not contain (no stable class name, an id collision inside one file, or an unparsable selector) |
| `excluded-source` | a component that lives in an excluded file (spec, e2e, testing helper) |
| `unresolved-dynamic-target` | a dynamic component API whose target could not be resolved |
| `unresolved-route-loader` | a route `component` / `loadComponent` / `loadChildren` that could not be resolved |
| `view-relocation` | `createEmbeddedView`, which moves a view at runtime and is not a component edge |
| `unsupported-angular-api` | a runtime Angular API (`createCustomElement`, `resolveComponentFactory`, `Compiler`, `hostDirectives`, a dynamic `extends`) that cannot be a static edge |
| `nested-workspace` | a nested `angular.json` deliberately excluded because it requires an independent TypeScript Program |

### Tree node

```jsonc
{ "id": "…#ChildComponent", "className": "ChildComponent",
  "cycle": false, "truncated": false,
  "occurrences": [ { "kind": "template", "location": { … } } ],
  "children": [ … ],
  "ambiguousChildren": [ /* AmbiguousUsage objects owned by this component */ ] }
```

`occurrences` are the edges connecting this node to its parent in the tree.
`cycle` marks a node that closes a cycle on the current path; `truncated` marks a
node whose children were cut by `--depth`, the default 1,000 depth ceiling, or by the 200,000 node ceiling that
stops a heavily shared graph from expanding without bound (the CLI prints a
warning on stderr when the ceiling is reached). `ambiguousChildren` holds the
`AmbiguousUsage` objects owned by this component, so a tree consumer sees the
same "? Ambiguous component" leaves the text renderer prints; it is empty when
`--ignore-ambiguous` was used.

## Errors

For exit codes 1 and 2 the document is still valid JSON: `result` is empty and

```jsonc
"error": { "code": "ambiguous", "message": "…", "candidates": ["…#AppComponent", "…#AppComponent"] }
```

carries the reason. `code` is `not-found` or `ambiguous`.
