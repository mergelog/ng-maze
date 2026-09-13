import { Component, NgModule } from '@angular/core';

@Component({ selector: 'duplicated-declared', template: '', standalone: false })
export class DuplicatedDeclaredComponent {}

@NgModule({ declarations: [DuplicatedDeclaredComponent] })
export class FirstOwningModule {}

@NgModule({ declarations: [DuplicatedDeclaredComponent] })
export class SecondOwningModule {}
