import { Component } from '@angular/core';
import { DialogTargetComponent } from './dialog-target.component';

class NotADialogService {
  open(component: unknown): void {
    void component;
  }

  createEmbeddedView(): void {}
}

@Component({ selector: 'false-positive-host', template: '' })
export class FalsePositiveHostComponent {
  private readonly notADialog = new NotADialogService();

  run(): void {
    this.notADialog.open(DialogTargetComponent);
    this.notADialog.createEmbeddedView();
  }
}
