import { Component } from '@angular/core';
import { UiButtonComponent } from '@ui/ui-button.component';

@Component({
  selector: 'ui-panel',
  template: '<ui-button></ui-button>',
  imports: [UiButtonComponent],
})
export class UiPanelComponent {}
