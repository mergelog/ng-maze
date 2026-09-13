import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ChildPageComponent } from './child-page.component';

const moduleRoutes: Routes = [
  { path: 'module-route', component: ChildPageComponent },
];

@NgModule({
  imports: [RouterModule.forChild(moduleRoutes)],
})
export class RoutingModule {}
