import { Component } from '@angular/core';
import { ReExportingModule } from './module-components';

@Component({
  selector: 'standalone-module-host',
  template: '<module-leaf></module-leaf>',
  imports: [ReExportingModule],
})
export class StandaloneModuleHostComponent {}
