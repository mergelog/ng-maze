import { Component } from '@angular/core';
import { HeaderComponent } from '@web/header.component';
import { UiPanelComponent } from '@ui/ui-panel.component';

@Component({
  selector: 'app-root',
  template: '<app-header></app-header><ui-panel></ui-panel>',
  imports: [HeaderComponent, UiPanelComponent],
})
export class AppComponent {}
