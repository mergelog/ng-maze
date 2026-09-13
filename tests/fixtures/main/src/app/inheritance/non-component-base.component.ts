import { Component } from '@angular/core';

class InternalBase {}

@Component({ selector: 'inheritance-non-component-base', template: '' })
export class NonComponentBaseComponent extends InternalBase {}

@Component({ selector: 'inheritance-external-base', template: '' })
export class ExternalBaseComponent extends Error {}

type Constructor = new (...args: any[]) => object;
const withFeature = <T extends Constructor>(base: T): T => base;

@Component({ selector: 'inheritance-complex-base', template: '' })
export class ComplexBaseComponent extends withFeature(InternalBase) {}
