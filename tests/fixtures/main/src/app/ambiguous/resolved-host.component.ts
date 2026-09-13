import { Component } from '@angular/core';
import { AmbiguousFirstComponent } from './first.component';

@Component({
  selector: 'ambiguous-resolved-host',
  template: '<ambiguous-target></ambiguous-target>',
  imports: [AmbiguousFirstComponent],
})
export class AmbiguousResolvedHostComponent {}
