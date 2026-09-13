import { Component } from '@angular/core';

function makeSelector(): string {
  return 'runtime-selector';
}

@Component({
  selector: makeSelector(),
  template: '',
})
export class UnresolvedMetadataComponent {}
