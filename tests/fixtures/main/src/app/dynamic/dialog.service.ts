import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { DialogTargetComponent } from './dialog-target.component';

@Injectable({ providedIn: 'root' })
export class ExternalUsageService {
  private readonly dialog = inject(MatDialog);

  show(): void {
    this.dialog.open(DialogTargetComponent);
  }

  showUnknown(component: unknown): void {
    this.dialog.open(component);
  }
}

export function showDialogFromFunction(dialog: MatDialog): void {
  dialog.open(DialogTargetComponent);
}
