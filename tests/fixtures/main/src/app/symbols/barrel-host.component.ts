import { Component } from '@angular/core';
import { BarrelAliasComponent } from './barrel';

@Component({
  selector: 'barrel-host',
  template: '<barrel-leaf></barrel-leaf>',
  imports: [BarrelAliasComponent],
})
export class BarrelHostComponent {}
