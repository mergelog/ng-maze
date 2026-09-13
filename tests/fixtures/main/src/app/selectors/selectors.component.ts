import { Component } from '@angular/core';
import {
  AttributeSelectorComponent,
  AttributeValueSelectorComponent,
  ClassSelectorComponent,
  CommaSelectorComponent,
  ElementSelectorComponent,
  MultiMatchComponent,
  NotSelectorComponent,
} from './targets';

@Component({
  selector: 'selectors-host',
  templateUrl: './selectors.component.html',
  imports: [
    ElementSelectorComponent,
    AttributeSelectorComponent,
    ClassSelectorComponent,
    AttributeValueSelectorComponent,
    NotSelectorComponent,
    CommaSelectorComponent,
    MultiMatchComponent,
  ],
})
export class SelectorsComponent {}
