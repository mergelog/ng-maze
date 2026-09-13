import { Component } from '@angular/core';
import { ExtWidgetsModule } from 'ext-widgets';

@Component({
  selector: 'external-host',
  template: '<ext-widget></ext-widget><div class="mat-icon"></div>',
  imports: [ExtWidgetsModule],
})
export class ExternalHostComponent {}
