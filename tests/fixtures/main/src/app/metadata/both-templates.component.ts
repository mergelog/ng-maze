import { Component } from '@angular/core';

// Angular rejects this at compile time; ngmaze uses the inline template and has
// to say that templateUrl was dropped (issue 32, F-21).
@Component({
  selector: 'both-templates',
  template: '<span>inline</span>',
  templateUrl: './both-templates.component.html',
})
export class BothTemplatesComponent {}
