import { Component } from '@angular/core';

@Component({ selector: 'solution-one', template: '<solution-two></solution-two>', imports: [SolutionTwoComponent] })
export class SolutionOneComponent {}

@Component({ selector: 'solution-two', template: '' })
export class SolutionTwoComponent {}
