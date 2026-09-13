import { Routes } from '@angular/router';
import { RoutePageComponent } from './page.component';

// `as Routes` is as statically certain as `satisfies Routes` (issue 32, F-03).
export const asRoutes = [
  { path: 'as-routes', component: RoutePageComponent },
] as Routes;
