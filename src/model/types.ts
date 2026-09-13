/**
 * Core graph model. See plan sections 24 / 26.
 *
 * ComponentId is `workspace-relative-path#ClassName`, `/` separated so the same
 * source tree produces the same JSON on any OS.
 */
export type ComponentId = string;

export type LocationPrecision = 'exact' | 'approximate';

export interface SourceLocation {
  /** Workspace relative, `/` separated. */
  file: string;
  /** 1 based. */
  line: number;
  /** 1 based. */
  column: number;
  precision: LocationPrecision;
}

export type TemplateKind = 'inline' | 'external' | 'none';

export interface ComponentInfo {
  id: ComponentId;
  className: string;
  /** Immediate base class when it is an internal component in this catalog. */
  extendsComponent: ComponentId | null;
  /** `null` when the component declares no selector (still a valid component). */
  selector: string | null;
  /** `true` when a selector was present in metadata but could not be evaluated. */
  selectorUnresolved: boolean;
  templateKind: TemplateKind;
  /** Absolute path of the external template, when resolvable. */
  templateFile: string | null;
  effectiveStandalone: boolean;
  standaloneExplicit: boolean | null;
  /** Angular project the declaring file belongs to (plan section 6.1). */
  angularProject: string | null;
  /** Absolute path of the declaring `.ts` file. */
  file: string;
  location: SourceLocation;
}

export interface NgModuleInfo {
  id: ComponentId;
  className: string;
  declarations: ComponentId[];
  /** Imported NgModules / standalone components inside the project. */
  imports: ComponentId[];
  exports: ComponentId[];
  file: string;
  location: SourceLocation;
  angularProject: string | null;
  /** Project-local symbols in declarations/imports/exports we could not resolve. */
  unresolved: boolean;
}

export type EdgeKind = 'template' | 'ng-component-outlet' | 'dialog' | 'create-component';

/** Display / ordering precedence of edge kinds (plan section 28.1). */
export const EDGE_KIND_ORDER: readonly EdgeKind[] = [
  'template',
  'ng-component-outlet',
  'dialog',
  'create-component',
];

export interface Edge {
  from: ComponentId;
  to: ComponentId;
  kind: EdgeKind;
  location: SourceLocation;
  /** Stable order index inside `from` (source order, kind grouped). */
  order: number;
}

export type RouteTargetKind = 'component' | 'loadComponent';

export interface RouteEntry {
  /** Best effort route path as written in source (not the runtime full URL). */
  path: string;
  target: ComponentId;
  targetKind: RouteTargetKind;
  /** Named RouterOutlet, or null for Angular's primary outlet. */
  outlet: string | null;
  location: SourceLocation;
  angularProject: string | null;
}

export type ExternalCallerKind = 'class' | 'function' | 'file';

export interface ExternalUsage {
  callerKind: ExternalCallerKind;
  /** Class / function name, or the file name for top level usage. */
  callerName: string;
  target: ComponentId;
  kind: EdgeKind;
  location: SourceLocation;
}

/**
 * A real Angular dynamic-component API call whose target cannot be reduced to
 * one component.  This is deliberately not an Edge: the relationship remains
 * visible without pretending that any candidate is definitely rendered.
 */
export interface AmbiguousUsage {
  owner: ComponentId | null;
  callerKind: ExternalCallerKind;
  callerName: string;
  kind: Exclude<EdgeKind, 'template'>;
  expression: string;
  message: string;
  location: SourceLocation;
  candidates: ComponentId[];
}

export type DiagnosticCode =
  | 'component-metadata'
  | 'multiple-ngmodule-declarations'
  | 'missing-template'
  | 'template-parse-error'
  | 'unresolved-scope'
  | 'ambiguous-selector'
  | 'selector-out-of-scope'
  | 'unresolved-route'
  | 'unresolved-dynamic';

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  /** Workspace relative, `/` separated. */
  file: string;
  location: SourceLocation;
  owner: ComponentId | null;
  detail?: string;
}

/**
 * Potential coverage holes are deliberately separate from diagnostics about a
 * relationship.  Consumers can therefore tell "not catalogued" from "a
 * catalogued relationship could not be resolved" without parsing messages.
 */
export type DetectionGapCode =
  | 'decorated-but-not-catalogued'
  | 'excluded-source'
  | 'unresolved-dynamic-target'
  | 'unresolved-route-loader'
  | 'view-relocation'
  | 'unsupported-angular-api'
  | 'nested-workspace';

export interface DetectionGap {
  code: DetectionGapCode;
  message: string;
  file: string;
  location: SourceLocation;
  owner: ComponentId | null;
  detail?: string;
  /** Statically enumerable internal component candidates; never guessed. */
  candidates: ComponentId[];
}

export interface AnalysisMeta {
  workspaceRoot: string;
  analysisRoot: string;
  angularProjects: string[];
  tsconfigFiles: string[];
  typescriptVersion: string;
  typescriptSource: 'project' | 'bundled';
  angularCompilerVersion: string;
  angularCompilerSource: 'project' | 'bundled';
  sourceFileCount: number;
  excludedFileCount: number;
  templateFileCount: number;
}

export interface AnalysisResult {
  meta: AnalysisMeta;
  components: ComponentInfo[];
  ngModules: NgModuleInfo[];
  edges: Edge[];
  routes: RouteEntry[];
  externalUsages: ExternalUsage[];
  ambiguousUsages: AmbiguousUsage[];
  diagnostics: Diagnostic[];
  detectionGaps: DetectionGap[];
}
