import { Component } from '@angular/core';
import { LeafComponent } from '../basic/leaf.component';

@Component({
  selector: 'control-flow-host',
  templateUrl: './control-flow.component.html',
  imports: [LeafComponent],
})
export class ControlFlowComponent {
  items: number[] = [];
  flag = false;
  mode = 1;
}
