import { Component } from '@angular/core';
import { LeafComponent } from '../basic/leaf.component';

@Component({
  selector: 'shared-first',
  templateUrl: './shared.html',
  imports: [LeafComponent],
})
export class SharedFirstComponent {}
