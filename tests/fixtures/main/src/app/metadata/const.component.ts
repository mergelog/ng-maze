import { Component } from '@angular/core';
import { METADATA_SELECTOR, SHARED_IMPORTS } from './constants';

@Component({
  selector: METADATA_SELECTOR,
  template: '<basic-leaf></basic-leaf>',
  imports: [...SHARED_IMPORTS],
})
export class MetadataConstComponent {}
