import { Component } from '@angular/core';
import { LeafComponent } from '../basic/leaf.component';

@Component({
  selector: 'structural-host',
  templateUrl: './structural.component.html',
  imports: [LeafComponent],
})
export class StructuralComponent {
  flag = true;
}
