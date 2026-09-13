import { Component } from '@angular/core';

@Component({ selector: 'sel-element', template: '' })
export class ElementSelectorComponent {}

@Component({ selector: '[selAttribute]', template: '' })
export class AttributeSelectorComponent {}

@Component({ selector: '.sel-class', template: '' })
export class ClassSelectorComponent {}

@Component({ selector: 'input[selType=text]', template: '' })
export class AttributeValueSelectorComponent {}

@Component({ selector: 'sel-not:not([skip])', template: '' })
export class NotSelectorComponent {}

@Component({ selector: 'sel-comma-one, sel-comma-two', template: '' })
export class CommaSelectorComponent {}

@Component({ selector: 'sel-multi, [selMulti]', template: '' })
export class MultiMatchComponent {}
