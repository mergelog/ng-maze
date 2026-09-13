import { Compiler, Component, ComponentFactoryResolver, inject } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { DialogTargetComponent } from './dialog-target.component';

@Component({ selector: 'unsupported-api-host', template: '' })
export class UnsupportedApiHostComponent {
  private readonly resolver = inject(ComponentFactoryResolver);
  private readonly compiler = inject(Compiler);

  exercise(): void {
    this.resolver.resolveComponentFactory(DialogTargetComponent);
    this.compiler.compileModuleAsync(DialogTargetComponent);
    this.compiler.compileModuleAndAllComponentsAsync(DialogTargetComponent);
    createCustomElement(DialogTargetComponent, { injector: null });
  }
}
