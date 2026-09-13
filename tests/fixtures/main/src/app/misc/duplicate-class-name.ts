import { Component } from '@angular/core';

// Two components with the same class name in one file share a ComponentId, so
// the second one cannot be catalogued. It must still be visible as a detection
// gap instead of disappearing (issue 32, F-05).
export namespace Alpha {
  @Component({ selector: 'dup-alpha', template: '' })
  export class DupComponent {}
}

export namespace Beta {
  @Component({ selector: 'dup-beta', template: '' })
  export class DupComponent {}
}
