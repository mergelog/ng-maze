import { Component } from '@angular/core';
import { LeafComponent } from '@app/basic/leaf.component';

@Component({
  selector: 'paths-alias-host',
  template: '<basic-leaf></basic-leaf>',
  imports: [LeafComponent],
})
export class PathsAliasHostComponent {}
