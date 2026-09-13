import { Component } from '@angular/core';

@Component({ selector: 'projection-child', template: '' })
export class ProjectionChildComponent {}

@Component({ selector: 'projection-wrapper', template: '<ng-content />' })
export class ProjectionWrapperComponent {}

@Component({
  selector: 'projection-host',
  imports: [ProjectionWrapperComponent, ProjectionChildComponent],
  template: '<projection-wrapper><projection-child /></projection-wrapper>',
})
export class ProjectionHostComponent {}
