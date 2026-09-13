import { beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../src/model/types.js';
import { analyzeFixture, edgeLabels, edgesOf } from '../helpers/fixtures.js';
import { buildView } from '../../src/query/view.js';

/**
 * Integration coverage of the fixture groups listed in plan section 35.
 * Assertions target the graph model, not rendered text (plan section 36).
 */
describe('main fixture', () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    result = (await analyzeFixture('main')).result;
  });

  const byClass = (name: string) => result.components.filter((c) => c.className === name);
  const edgeTargets = (fromClass: string, kind?: string) =>
    edgesOf(result, fromClass)
      .filter((e) => (kind ? e.kind === kind : true))
      .map((e) => e.to.split('#')[1]!);

  describe('component detection (plan sections 7.7, 11, 12)', () => {
    it('finds components regardless of the file name', () => {
      expect(byClass('OddFilenameComponent')).toHaveLength(1);
    });

    it('finds components through an aliased and a namespaced decorator', () => {
      expect(byClass('AliasedDecoratorComponent')).toHaveLength(1);
      expect(byClass('NamespacedDecoratorComponent')).toHaveLength(1);
    });

    it('ignores a locally defined decorator that only shares the name', () => {
      expect(byClass('LocalDecoratedClass')).toHaveLength(0);
      expect(result.detectionGaps.some((gap) =>
        gap.code === 'decorated-but-not-catalogued' && gap.file.includes('local-component-decorator'))).toBe(false);
    });

    it('keeps a component without a selector in the catalog', () => {
      const noSelector = byClass('NoSelectorComponent')[0]!;
      expect(noSelector.selector).toBeNull();
      expect(noSelector.selectorUnresolved).toBe(false);
    });

    it('separates two classes with the same name by file', () => {
      const duplicates = byClass('DuplicateClassComponent');
      expect(duplicates).toHaveLength(2);
      expect(new Set(duplicates.map((c) => c.id)).size).toBe(2);
    });

    it('distinguishes the effective and the explicit standalone flag', () => {
      expect(byClass('LeafComponent')[0]).toMatchObject({ effectiveStandalone: true, standaloneExplicit: null });
      expect(byClass('ModuleLeafComponent')[0]).toMatchObject({ effectiveStandalone: false, standaloneExplicit: false });
    });

    it('excludes spec, testing and e2e sources from the analysis set', () => {
      expect(byClass('SpecOnlyComponent')).toHaveLength(0);
      expect(byClass('TestingHelperComponent')).toHaveLength(0);
      expect(byClass('E2eHelperComponent')).toHaveLength(0);
      expect(result.meta.excludedFileCount).toBeGreaterThan(0);
    });
  });

  describe('inheritance', () => {
    it('records an internal catalogued base component through a TypeChecker-resolved alias', () => {
      const base = byClass('InheritanceBaseComponent')[0]!;
      expect(byClass('InheritanceDerivedComponent')[0]!.extendsComponent).toBe(base.id);
    });

    it('ignores base classes that are not internal catalogued components', () => {
      expect(byClass('NonComponentBaseComponent')[0]!.extendsComponent).toBeNull();
      expect(byClass('ExternalBaseComponent')[0]!.extendsComponent).toBeNull();
    });

    it('does not turn inheritance into a component-use edge', () => {
      expect(edgeTargets('InheritanceDerivedComponent')).toEqual([]);
    });

    it('reports a dynamic extends expression instead of silently dropping it', () => {
      expect(result.detectionGaps.some((gap) =>
        gap.code === 'unsupported-angular-api' && gap.owner?.endsWith('#ComplexBaseComponent'))).toBe(true);
    });
  });

  describe('templates (plan sections 16, 19)', () => {
    it('builds one edge per occurrence', () => {
      expect(edgeTargets('ChildComponent')).toEqual(['LeafComponent', 'LeafComponent', 'LeafComponent', 'LeafComponent']);
    });

    it('keeps template source order', () => {
      const lines = edgesOf(result, 'ChildComponent').map((e) => e.location.line);
      expect(lines).toEqual([1, 2, 3, 4]);
    });

    it('reads self closing elements and skips commented out ones', () => {
      expect(edgeTargets('InlineComponent')).toEqual(['LeafComponent']);
    });

    it('walks every control flow and deferred block', () => {
      expect(edgeTargets('ControlFlowComponent')).toHaveLength(10);
    });

    it('counts an element with a structural directive once', () => {
      expect(edgeTargets('StructuralComponent')).toEqual(['LeafComponent', 'LeafComponent']);
    });

    it('gives both owners of a shared template their own edges', () => {
      expect(edgeTargets('SharedFirstComponent')).toEqual(['LeafComponent']);
      expect(edgeTargets('SharedSecondComponent')).toEqual(['LeafComponent']);
    });

    it('maps an inline template position back into the TypeScript file', () => {
      const edge = edgesOf(result, 'InlineComponent')[0]!;
      expect(edge.location.file).toMatch(/inline\.component\.ts$/);
      expect(edge.location.precision).toBe('exact');
      expect(edge.location.line).toBe(7);
    });

    it('marks an escaped inline template location as approximate', () => {
      const edge = edgesOf(result, 'EscapedInlineComponent')[0]!;
      expect(edge.location.precision).toBe('approximate');
    });

    it('keeps projected content as source composition, not as a child of the wrapper', () => {
      expect(edgeTargets('ProjectionHostComponent')).toEqual([
        'ProjectionWrapperComponent', 'ProjectionChildComponent',
      ]);
      expect(edgeTargets('ProjectionWrapperComponent')).toEqual([]);
    });
  });

  describe('selector matching (plan sections 17, 18)', () => {
    it('matches element, attribute, class, attribute value, :not and comma selectors', () => {
      expect(edgeTargets('SelectorsComponent')).toEqual([
        'ElementSelectorComponent',
        'AttributeSelectorComponent',
        'ClassSelectorComponent',
        'AttributeValueSelectorComponent',
        'NotSelectorComponent',
        'CommaSelectorComponent',
        'CommaSelectorComponent',
        'MultiMatchComponent',
      ]);
    });

    it('counts a component matching two selector parts of one node once', () => {
      expect(edgeTargets('SelectorsComponent').filter((n) => n === 'MultiMatchComponent')).toHaveLength(1);
    });

    it('ignores elements that are not project components', () => {
      expect(edgeTargets('ExternalHostComponent')).toEqual([]);
      expect(result.diagnostics.filter((d) => d.owner?.endsWith('#ExternalHostComponent'))).toEqual([]);
    });

    it('reports an ambiguous selector instead of guessing', () => {
      const ambiguous = result.diagnostics.filter((d) => d.code === 'ambiguous-selector');
      expect(ambiguous).toHaveLength(1);
      expect(ambiguous[0]!.owner).toContain('AmbiguousHostComponent');
      expect(edgeTargets('AmbiguousHostComponent')).toEqual([]);
    });

    it('resolves a duplicated selector when the scope makes it unique', () => {
      expect(edgeTargets('AmbiguousResolvedHostComponent')).toEqual(['AmbiguousFirstComponent']);
    });

    it('reports a project component used without importing it', () => {
      const outOfScope = result.diagnostics.filter((d) => d.code === 'selector-out-of-scope');
      expect(outOfScope.map((d) => d.owner!.split('#')[1]).sort()).toEqual([
        'AliasedDecoratorComponent', 'OutOfScopeHostComponent',
      ]);
      expect(edgeTargets('OutOfScopeHostComponent')).toEqual([]);
    });
  });

  describe('scope (plan sections 14, 15)', () => {
    it('expands an NgModule export scope recursively', () => {
      expect(edgeTargets('StandaloneModuleHostComponent')).toEqual(['ModuleLeafComponent']);
    });

    it('gives NgModule declarations access to their siblings', () => {
      expect(edgeTargets('ModuleInnerComponent')).toEqual(['ModuleLeafComponent']);
    });

    it('reports a non standalone component without an NgModule', () => {
      const unresolved = result.diagnostics.filter(
        (d) => d.code === 'unresolved-scope' && d.owner?.endsWith('#OrphanNonStandaloneComponent'),
      );
      expect(unresolved).toHaveLength(1);
    });

    it('does not treat an external import as an incomplete scope', () => {
      expect(result.diagnostics.filter((d) => d.owner?.endsWith('#ExternalHostComponent'))).toEqual([]);
    });

    it('reports an incomplete scope only for a project local gap', () => {
      const unresolved = result.diagnostics.filter(
        (d) => d.code === 'unresolved-scope' && d.owner?.endsWith('#UnresolvedImportsComponent'),
      );
      expect(unresolved).toHaveLength(1);
    });

    it('reports a component declared in two NgModules', () => {
      expect(result.diagnostics.filter((d) => d.code === 'multiple-ngmodule-declarations')).toHaveLength(1);
    });
  });

  describe('static evaluation (plan sections 9, 10)', () => {
    it('resolves a selector from a const and from a property access', () => {
      expect(byClass('MetadataConstComponent')[0]!.selector).toBe('metadata-const-host');
      expect(byClass('MetadataPropertyAccessComponent')[0]!.selector).toBe('metadata-property-host');
    });

    it('expands spread imports', () => {
      expect(edgeTargets('MetadataConstComponent')).toEqual(['LeafComponent']);
      expect(edgeTargets('MetadataPropertyAccessComponent')).toEqual(['LeafComponent']);
    });

    it('follows forwardRef through Angular identity', () => {
      expect(edgeTargets('ForwardRefHostComponent')).toEqual(['ForwardRefTargetComponent']);
    });

    it('reports an unresolvable selector as metadata diagnostic and keeps the component', () => {
      const component = byClass('UnresolvedMetadataComponent')[0]!;
      expect(component.selector).toBeNull();
      expect(component.selectorUnresolved).toBe(true);
      expect(result.diagnostics.some((d) => d.code === 'component-metadata' && d.owner === component.id)).toBe(true);
    });

    it('resolves barrels, re-export aliases and path aliases through the TypeChecker', () => {
      expect(edgeTargets('BarrelHostComponent')).toEqual(['BarrelLeafComponent']);
      expect(edgeTargets('PathsAliasHostComponent')).toEqual(['LeafComponent']);
    });
  });

  describe('routes (plan section 20)', () => {
    const routeMap = () => new Map(result.routes.map((r) => [r.path, r]));

    it('resolves eager, lazy, default export, children and lazy children routes', () => {
      const routes = routeMap();
      expect(routes.get('/page')).toMatchObject({ targetKind: 'component' });
      expect(routes.get('/page')!.target).toContain('RoutePageComponent');
      expect(routes.get('/lazy')).toMatchObject({ targetKind: 'loadComponent' });
      expect(routes.get('/default')!.target).toContain('DefaultExportPageComponent');
      expect(routes.get('/parent/child')!.target).toContain('RoutePageComponent');
      expect(routes.get('/lazy-children/deep')!.target).toContain('ChildPageComponent');
      expect(routes.get('/named')).toMatchObject({ outlet: 'side', targetKind: 'component' });
    });

    it('reads RouterModule.forChild route roots', () => {
      expect(routeMap().get('/module-route')!.target).toContain('ChildPageComponent');
    });

    it('never treats an arbitrary object with a path property as a route', () => {
      expect(result.routes.some((r) => r.path.includes('looks-like-a-route'))).toBe(false);
    });

    it('reports an unresolvable route target', () => {
      const unresolved = result.diagnostics.filter((d) => d.code === 'unresolved-route');
      expect(unresolved.some((item) => item.message.includes('/unresolved'))).toBe(true);
      expect(unresolved.some((item) => item.message.includes('/not-a-component'))).toBe(true);
      const conditional = result.detectionGaps.find((gap) => gap.message.includes('/conditional-lazy'));
      expect(conditional?.candidates.map((id) => id.split('#')[1]).sort()).toEqual([
        'LazyPageComponent', 'RoutePageComponent',
      ]);
    });

    it('keeps routes out of the component edge list', () => {
      expect(result.edges.some((e) => e.to.includes('RoutePageComponent'))).toBe(false);
    });
  });

  describe('dynamic components (plan sections 21, 22, 23)', () => {
    it('detects MatDialog.open through the receiver type, not the property name', () => {
      expect(edgeTargets('DialogHostComponent', 'dialog')).toEqual([
        'DialogTargetComponent', 'GenericDialogTargetComponent',
      ]);
    });

    it('takes the target from the first argument, never from a type argument', () => {
      const generic = edgesOf(result, 'DialogHostComponent')
        .filter((e) => e.to.includes('GenericDialogTargetComponent'));
      expect(generic).toHaveLength(1);
    });

    it('does not invent an edge for a runtime conditional, but returns its enumerable candidates', () => {
      const gaps = result.detectionGaps.filter((gap) =>
        gap.code === 'unresolved-dynamic-target' && gap.owner?.endsWith('#DialogHostComponent'));
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.candidates.map((id) => id.split('#')[1]).sort()).toEqual([
        'DialogTargetComponent', 'GenericDialogTargetComponent',
      ]);
      expect(edgeTargets('DialogHostComponent', 'dialog')).toEqual([
        'DialogTargetComponent', 'GenericDialogTargetComponent',
      ]);
    });

    it('detects ViewContainerRef.createComponent and the core createComponent', () => {
      expect(edgeTargets('DialogHostComponent', 'create-component')).toEqual([
        'CreatedTargetComponent', 'CreatedTargetComponent',
      ]);
    });

    it('resolves a static ngComponentOutlet target and reports a runtime one', () => {
      expect(edgeTargets('OutletHostComponent', 'ng-component-outlet')).toEqual([
        'OutletTargetComponent', 'OutletTargetComponent', 'OutletTargetComponent',
      ]);
      const unresolved = result.diagnostics.filter(
        (d) => d.code === 'unresolved-dynamic' && d.owner?.endsWith('#OutletHostComponent'),
      );
      expect(unresolved).toHaveLength(5);
      const candidates = result.ambiguousUsages
        .filter((usage) => usage.owner?.endsWith('#OutletHostComponent') && usage.candidates.length > 0)
        .map((usage) => usage.candidates.map((id) => id.split('#')[1]).sort());
      expect(candidates).toEqual([
        ['GenericDialogTargetComponent', 'OutletTargetComponent'],
        ['GenericDialogTargetComponent', 'OutletTargetComponent'],
        ['GenericDialogTargetComponent', 'OutletTargetComponent'],
        ['GenericDialogTargetComponent', 'OutletTargetComponent'],
      ]);
      expect(result.detectionGaps.some((gap) =>
        gap.code === 'view-relocation' && gap.owner?.endsWith('#OutletHostComponent'))).toBe(true);
    });

    it('shows ambiguous dynamic usages as non-component tree leaves and can hide them', () => {
      const owner = byClass('OutletHostComponent')[0]!;
      const visible = buildView(result, {}, owner.id).tree!;
      expect(visible.ambiguousChildren).toHaveLength(5);
      expect(buildView(result, { ignoreAmbiguous: true }, owner.id).tree!.ambiguousChildren).toEqual([]);
    });

    it('ignores an unrelated open() call', () => {
      expect(edgeTargets('FalsePositiveHostComponent')).toEqual([]);
      expect(result.detectionGaps.some((gap) => gap.location.file.includes('false-positive.component'))).toBe(false);
    });

    it('does not turn an external dynamic component into an edge or ambiguous usage', () => {
      expect(result.edges.some((edge) => edge.to.includes('ExternalWidgetComponent'))).toBe(false);
      expect(result.ambiguousUsages.some((usage) => usage.expression.includes('ExternalWidgetComponent'))).toBe(false);
    });

    it('detects unsupported Angular runtime APIs by their actual package and receiver types', () => {
      const gaps = result.detectionGaps.filter((gap) =>
        gap.code === 'unsupported-angular-api' && gap.owner?.endsWith('#UnsupportedApiHostComponent'));
      expect(gaps).toHaveLength(4);
      expect(gaps.map((gap) => gap.message.split(' ')[0]).sort()).toEqual([
        'compileModuleAndAllComponentsAsync', 'compileModuleAsync', 'createCustomElement', 'resolveComponentFactory',
      ]);
    });

    it('never turns TestBed.createComponent into an edge', () => {
      expect(result.edges.some((e) => e.location.file.includes('testbed-usage'))).toBe(false);
      expect(result.externalUsages.some((u) => u.location.file.includes('testbed-usage'))).toBe(false);
    });

    it('reports excluded decorated test sources as coverage gaps without cataloguing them', () => {
      const gaps = result.detectionGaps.filter((gap) => gap.code === 'excluded-source');
      expect(gaps.some((gap) => gap.file.includes('excluded.spec.ts'))).toBe(true);
      expect(gaps.every((gap) => gap.owner === null && gap.candidates.length === 0)).toBe(true);
    });

    it('keeps service and function callers out of the component tree', () => {
      expect(result.externalUsages.map((u) => `${u.callerKind}:${u.callerName}`).sort()).toEqual([
        'class:(anonymous)', 'class:ExternalUsageService', 'function:showDialogFromFunction',
      ]);
      expect(result.edges.some((e) => e.from.includes('dialog.service'))).toBe(false);
    });
  });

  describe('graph shapes and errors (plan sections 12, 19, 25, 26)', () => {
    it('keeps both directions of a cycle as edges', () => {
      expect(edgeLabels(edgesOf(result, 'CycleAComponent'))).toEqual(['CycleAComponent -> CycleBComponent [template]']);
      expect(edgeLabels(edgesOf(result, 'CycleBComponent'))).toEqual(['CycleBComponent -> CycleAComponent [template]']);
    });

    it('keeps a shared component reachable from several parents', () => {
      const parents = result.edges.filter((e) => e.to.includes('MultipathSharedComponent')).map((e) => e.from);
      expect(new Set(parents).size).toBe(2);
    });

    it('keeps both kinds when one parent uses one child twice', () => {
      expect(edgeLabels(edgesOf(result, 'MixedHostComponent'))).toEqual([
        'MixedHostComponent -> MixedChildComponent [template]',
        'MixedHostComponent -> MixedChildComponent [dialog]',
      ]);
    });

    it('reports a missing template and produces no edges for it', () => {
      const missing = result.diagnostics.filter((d) => d.code === 'missing-template');
      expect(missing).toHaveLength(1);
      expect(byClass('MissingTemplateComponent')[0]!.templateKind).toBe('none');
    });

    it('reports a broken template and never guesses edges from it', () => {
      const broken = result.diagnostics.filter((d) => d.code === 'template-parse-error');
      expect(broken).toHaveLength(1);
      expect(edgeTargets('BrokenTemplateComponent')).toEqual([]);
    });
  });

  describe('adversarial review regressions (issue 32)', () => {
    it('detects a route root written as `as Routes` (F-03)', () => {
      const route = result.routes.find((r) => r.path === '/as-routes');
      expect(route).toBeDefined();
      expect(route!.target).toContain('RoutePageComponent');
    });

    it('mounts a children array once, whatever the declaration order is (F-04)', () => {
      expect(result.routes.map((r) => r.path)).toContain('/shell/mounted');
      // `mountedChildRoutes` is declared before the array that mounts it.
      expect(result.routes.map((r) => r.path)).not.toContain('/mounted');
    });

    it('reports a component dropped by an id collision inside one file (F-05)', () => {
      const dup = byClass('DupComponent');
      expect(dup).toHaveLength(1);
      const gaps = result.detectionGaps.filter((gap) =>
        gap.code === 'decorated-but-not-catalogued' && gap.file.includes('duplicate-class-name'));
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.message).toContain('shares the component id');
      expect(gaps[0]!.location.line).not.toBe(dup[0]!.location.line);
    });

    it('never attributes an anonymous class to the default exported component (F-06)', () => {
      const owner = result.components.find((c) => c.file.endsWith('anonymous-owner.ts'))!;
      expect(owner.className).toBe('default');
      expect(result.edges.some((e) => e.from === owner.id)).toBe(false);
      const external = result.externalUsages.filter((usage) => usage.location.file.includes('anonymous-owner'));
      expect(external).toHaveLength(1);
      expect(external[0]!).toMatchObject({ callerKind: 'class', callerName: '(anonymous)', kind: 'create-component' });
    });

    it('reports a component that declares both template and templateUrl (F-21)', () => {
      const component = byClass('BothTemplatesComponent')[0]!;
      expect(component.templateKind).toBe('inline');
      expect(result.diagnostics.some((d) =>
        d.code === 'component-metadata' && d.owner === component.id
        && d.message.includes('both template and templateUrl'))).toBe(true);
    });
  });

  describe('determinism (PRD section 25)', () => {
    it('produces the same ordering on a second analysis', async () => {
      const second = (await analyzeFixture('main')).result;
      expect(second.edges.map((e) => `${e.from}|${e.to}|${e.kind}|${e.order}`))
        .toEqual(result.edges.map((e) => `${e.from}|${e.to}|${e.kind}|${e.order}`));
      expect(second.diagnostics.map((d) => `${d.code}|${d.file}|${d.location.line}`))
        .toEqual(result.diagnostics.map((d) => `${d.code}|${d.file}|${d.location.line}`));
      expect(second.detectionGaps.map((gap) => `${gap.code}|${gap.file}|${gap.location.line}`))
        .toEqual(result.detectionGaps.map((gap) => `${gap.code}|${gap.file}|${gap.location.line}`));
    });
  });
});
