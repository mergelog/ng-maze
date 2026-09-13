import type { ComponentId, Diagnostic, SourceLocation } from '../model/types.js';
import type { Catalog, ScopeRef } from './catalog.js';

/**
 * "Which project components can this component's template use" (plan section 14).
 * External packages never contribute project components, so they never make a
 * scope incomplete (plan section 15).
 */
export interface ScopeResult {
  components: Set<ComponentId>;
  complete: boolean;
  reasons: { reason: string; location: SourceLocation }[];
}

const EMPTY_SCOPE: ScopeResult = { components: new Set(), complete: true, reasons: [] };

export class ScopeEngine {
  private readonly scopeCache = new Map<ComponentId, ScopeResult>();
  private readonly exportCache = new Map<ComponentId, ScopeResult>();
  private readonly computing = new Set<ComponentId>();
  private readonly declaringModules: Map<ComponentId, ComponentId[]>;
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly catalog: Catalog) {
    this.declaringModules = new Map();
    for (const record of catalog.ngModules.values()) {
      for (const declared of record.info.declarations) {
        const list = this.declaringModules.get(declared) ?? [];
        list.push(record.info.id);
        this.declaringModules.set(declared, list);
      }
    }
  }

  scopeOf(componentId: ComponentId): ScopeResult {
    const cached = this.scopeCache.get(componentId);
    if (cached) return cached;

    const record = this.catalog.components.get(componentId);
    if (!record) return EMPTY_SCOPE;

    const result: ScopeResult = { components: new Set(), complete: true, reasons: [] };
    this.scopeCache.set(componentId, result);

    if (record.info.effectiveStandalone) {
      this.applyRefs(record.imports, result);
    } else {
      const modules = this.declaringModules.get(componentId) ?? [];
      if (modules.length === 0) {
        result.complete = false;
        result.reasons.push({
          reason: `${record.info.className} is declared "standalone: false" but no NgModule declaring it was found.`,
          location: record.info.location,
        });
        this.diagnostics.push({
          code: 'unresolved-scope',
          message: `${record.info.className} is "standalone: false" but its NgModule could not be determined.`,
          file: record.info.location.file,
          location: record.info.location,
          owner: componentId,
        });
      }
      for (const moduleId of modules) {
        const module = this.catalog.ngModules.get(moduleId);
        if (!module) continue;
        for (const declared of module.info.declarations) {
          if (this.catalog.components.has(declared)) result.components.add(declared);
        }
        this.applyRefs(module.imports, result);
      }
    }

    return result;
  }

  /** Plan section 14 "NgModule export scope", recursive with cycle detection. */
  exportScopeOf(moduleId: ComponentId): ScopeResult {
    const cached = this.exportCache.get(moduleId);
    if (cached) return cached;
    if (this.computing.has(moduleId)) return EMPTY_SCOPE;

    const module = this.catalog.ngModules.get(moduleId);
    if (!module) return EMPTY_SCOPE;

    this.computing.add(moduleId);
    const result: ScopeResult = { components: new Set(), complete: true, reasons: [] };
    try {
      this.applyRefs(module.exports, result);
    } finally {
      this.computing.delete(moduleId);
    }
    this.exportCache.set(moduleId, result);
    return result;
  }

  /**
   * A reference is either a project component (added directly), an NgModule
   * (its export scope is expanded), something external (ignored), or a
   * project-local gap (scope becomes incomplete).
   */
  private applyRefs(refs: ScopeRef[], result: ScopeResult): void {
    for (const ref of refs) {
      if (ref.kind === 'external') continue;
      if (ref.kind === 'unresolved') {
        result.complete = false;
        result.reasons.push({ reason: ref.reason, location: ref.location });
        continue;
      }
      if (this.catalog.components.has(ref.id)) {
        // A standalone component contributes only itself; its own imports are
        // not inherited by the importer (plan section 14).
        result.components.add(ref.id);
        continue;
      }
      if (this.catalog.ngModules.has(ref.id)) {
        const exported = this.exportScopeOf(ref.id);
        for (const id of exported.components) result.components.add(id);
        if (!exported.complete) {
          result.complete = false;
          result.reasons.push(...exported.reasons);
        }
        continue;
      }
      // Project directive / pipe / unanalysed class: no component contribution.
    }
  }
}
