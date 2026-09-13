import { Component } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { GenericDialogTargetComponent, OutletTargetComponent } from './dialog-target.component';

declare const runtimeFlag: boolean;
declare const runtimeKey: string;
const OUTLET_MAP = {
  primary: OutletTargetComponent,
  generic: GenericDialogTargetComponent,
} as const;

@Component({
  selector: 'outlet-host',
  templateUrl: './outlet-host.component.html',
  imports: [NgComponentOutlet],
})
export class OutletHostComponent {
  readonly outletComponent = OutletTargetComponent;
  readonly runtimeComponent = resolveComponent();
  readonly conditionalComponent = runtimeFlag ? OutletTargetComponent : GenericDialogTargetComponent;
  readonly mappedComponent = OUTLET_MAP[runtimeKey];
  readonly staticMappedComponent = OUTLET_MAP.primary;
  readonly firstComponent = OutletTargetComponent;
  readonly secondComponent = GenericDialogTargetComponent;
  readonly componentMap = OUTLET_MAP;

  get outletFromGetter(): typeof OutletTargetComponent {
    return OutletTargetComponent;
  }
}

declare function resolveComponent(): unknown;
