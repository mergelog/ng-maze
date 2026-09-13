import { Component } from '@angular/core';
import { OneChildComponent } from './child.component';

@Component({
  selector: 'one-root',
  template: '<one-child></one-child>',
  imports: [OneChildComponent],
})
export class AppComponent {}
