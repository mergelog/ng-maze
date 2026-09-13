import { Component, forwardRef } from '@angular/core';

@Component({
  selector: 'forward-ref-host',
  template: '<forward-ref-target></forward-ref-target>',
  imports: [forwardRef(() => ForwardRefTargetComponent)],
})
export class ForwardRefHostComponent {}

@Component({ selector: 'forward-ref-target', template: '' })
export class ForwardRefTargetComponent {}
