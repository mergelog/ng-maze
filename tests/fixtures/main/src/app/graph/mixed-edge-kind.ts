import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

@Component({ selector: 'mixed-child', template: '' })
export class MixedChildComponent {}

@Component({
  selector: 'mixed-host',
  template: '<mixed-child></mixed-child>',
  imports: [MixedChildComponent],
})
export class MixedHostComponent {
  private readonly dialog = inject(MatDialog);

  open(): void {
    this.dialog.open(MixedChildComponent);
  }
}
