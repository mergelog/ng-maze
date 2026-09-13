import { Component } from '@angular/core';
import { AmbiguousFirstComponent } from './first.component';
import { AmbiguousSecondComponent } from './second.component';

@Component({
  selector: 'ambiguous-host',
  template: '<ambiguous-target></ambiguous-target>',
  imports: [AmbiguousFirstComponent, AmbiguousSecondComponent],
})
export class AmbiguousHostComponent {}
