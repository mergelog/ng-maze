import { Component, NgModule } from '@angular/core';

@Component({ selector: 'module-leaf', template: '', standalone: false })
export class ModuleLeafComponent {}

@Component({ selector: 'module-inner', template: '<module-leaf></module-leaf>', standalone: false })
export class ModuleInnerComponent {}

@NgModule({
  declarations: [ModuleLeafComponent, ModuleInnerComponent],
  exports: [ModuleLeafComponent],
})
export class LeafModule {}

@NgModule({
  imports: [LeafModule],
  exports: [LeafModule],
})
export class ReExportingModule {}
