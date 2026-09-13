import { Component } from '@angular/core';
import { ParentComponent } from './basic/parent.component';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  imports: [ParentComponent],
})
export class AppComponent {}
