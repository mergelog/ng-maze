import { Component } from '@angular/core';
import { LeafComponent } from '../basic/leaf.component';

@Component({
  selector: 'inline-host',
  template: `
    <basic-leaf />
    <!-- <basic-leaf /> -->
  `,
  imports: [LeafComponent],
})
export class InlineComponent {}
