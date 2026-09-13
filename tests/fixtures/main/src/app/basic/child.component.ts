import { Component } from '@angular/core';
import { LeafComponent } from './leaf.component';

@Component({
  selector: 'basic-child',
  templateUrl: './child.component.html',
  imports: [LeafComponent],
})
export class ChildComponent {}
