import { Component, ViewContainerRef, createComponent, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ExternalWidgetComponent } from 'ext-widgets';
import { CreatedTargetComponent, DialogTargetComponent, GenericDialogTargetComponent } from './dialog-target.component';

@Component({
  selector: 'dialog-host',
  template: '',
})
export class DialogHostComponent {
  private readonly dialog = inject(MatDialog);
  private readonly matDialog = inject(MatDialog);
  private readonly viewContainer = inject(ViewContainerRef);

  openPlain(): void {
    this.dialog.open(DialogTargetComponent);
  }

  openGeneric(): void {
    this.matDialog.open<GenericDialogTargetComponent, { id: string }, boolean>(
      GenericDialogTargetComponent,
      { data: { id: '1' } },
    );
  }

  createInView(): void {
    this.viewContainer.createComponent(CreatedTargetComponent);
  }

  createStandalone(): void {
    createComponent(CreatedTargetComponent, {});
  }

  openConditionally(runtimeFlag: boolean): void {
    this.dialog.open(runtimeFlag ? DialogTargetComponent : GenericDialogTargetComponent);
  }

  openExternal(): void {
    this.dialog.open(ExternalWidgetComponent);
  }
}
