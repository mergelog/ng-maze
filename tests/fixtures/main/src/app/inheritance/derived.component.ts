import { Component } from '@angular/core';
import { InheritanceBaseComponent as Base } from './base.component';

@Component({ selector: 'inheritance-derived', template: '' })
export class InheritanceDerivedComponent extends Base {}
