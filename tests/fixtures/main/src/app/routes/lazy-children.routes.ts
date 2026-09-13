import { Routes } from '@angular/router';
import { ChildPageComponent } from './child-page.component';

export const lazyChildRoutes: Routes = [
  { path: 'deep', component: ChildPageComponent },
];
