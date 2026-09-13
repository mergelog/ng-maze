import { Component } from '@angular/core';
import { LeafComponent } from '../basic/leaf.component';

@Component({
  selector: 'escaped-inline-host',
  template: '<div title="a\tb">\n<basic-leaf />\n</div>',
  imports: [LeafComponent],
})
export class EscapedInlineComponent {}
