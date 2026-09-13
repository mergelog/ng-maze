import { Component, NgModule, forwardRef } from '@angular/core';

@Component({ selector: 'cycle-module-leaf', template: '', standalone: false })
export class CycleModuleLeafComponent {}

@NgModule({
  declarations: [CycleModuleLeafComponent],
  imports: [forwardRef(() => ModuleB)],
  exports: [CycleModuleLeafComponent],
})
export class ModuleA {}

@NgModule({
  imports: [ModuleA],
  exports: [ModuleA],
})
export class ModuleB {}
