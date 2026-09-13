import { Component } from '@angular/core';
import { ChildComponent } from './child.component';
import { LeafComponent } from './leaf.component';

@Component({
  selector: 'basic-parent',
  templateUrl: './parent.component.html',
  imports: [ChildComponent, LeafComponent],
})
export class ParentComponent {}
