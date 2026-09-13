import { Component } from '@angular/core';

@Component({ selector: 'multipath-shared', template: '' })
export class MultipathSharedComponent {}

@Component({
  selector: 'multipath-left',
  template: '<multipath-shared></multipath-shared>',
  imports: [MultipathSharedComponent],
})
export class MultipathLeftComponent {}

@Component({
  selector: 'multipath-right',
  template: '<multipath-shared></multipath-shared>',
  imports: [MultipathSharedComponent],
})
export class MultipathRightComponent {}

@Component({
  selector: 'multipath-root',
  template: '<multipath-left></multipath-left><multipath-right></multipath-right>',
  imports: [MultipathLeftComponent, MultipathRightComponent],
})
export class MultipathRootComponent {}
