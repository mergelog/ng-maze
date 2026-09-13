import { Component } from '@angular/core';
import { SELECTORS, SHARED_IMPORTS } from './constants';

@Component({
  selector: SELECTORS.property,
  template: '<basic-leaf></basic-leaf>',
  imports: SHARED_IMPORTS,
})
export class MetadataPropertyAccessComponent {}
