import { Component } from '@angular/core';

function buildImports(): unknown[] {
  return [];
}

@Component({
  selector: 'unresolved-imports-host',
  template: '<basic-leaf></basic-leaf>',
  imports: [...buildImports()],
})
export class UnresolvedImportsComponent {}
