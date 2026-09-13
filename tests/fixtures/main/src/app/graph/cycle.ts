import { Component, forwardRef } from '@angular/core';

@Component({
  selector: 'cycle-a',
  template: '<cycle-b></cycle-b>',
  imports: [forwardRef(() => CycleBComponent)],
})
export class CycleAComponent {}

@Component({
  selector: 'cycle-b',
  template: '<cycle-a></cycle-a>',
  imports: [forwardRef(() => CycleAComponent)],
})
export class CycleBComponent {}
