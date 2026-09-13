import { Component, ViewContainerRef, inject } from '@angular/core';
import { CreatedTargetComponent } from './dialog-target.component';

@Component({ selector: 'anon-default-host', template: 'anon' })
export default class {}

// Not the default export and not a component: its calls belong to nobody, and
// must never be attributed to the default exported component (issue 32, F-06).
export const anonymousHelper = class {
  private readonly viewContainer = inject(ViewContainerRef);

  create(): void {
    this.viewContainer.createComponent(CreatedTargetComponent);
  }
};
