import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { DialogTargetComponent } from './dialog-target.component';

@Component({ selector: 'spec-only', template: '' })
export class SpecOnlyComponent {}

export function setup(): unknown {
  return TestBed.createComponent(DialogTargetComponent);
}
