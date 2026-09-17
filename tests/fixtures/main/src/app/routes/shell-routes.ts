import { Routes } from '@angular/router';
import { ChildPageComponent } from './child-page.component';
import { RoutePageComponent } from './page.component';
import { LazyPageComponent } from './lazy-page.component';
import DefaultExportPageComponent from './default-export-page.component';

// Declared before the array that mounts it, on purpose: the mount point of a
// route array must not depend on declaration order (issue 32, F-04).
export const mountedChildRoutes: Routes = [
  { path: 'mounted', component: ChildPageComponent },
];

export const shellRoutes: Routes = [
  {
    path: 'shell',
    component: RoutePageComponent,
    children: [
      // A component-less route must retain Shell's host for its descendants.
      { path: '', canActivate: [], children: mountedChildRoutes },
      { path: 'named', outlet: 'side', component: DefaultExportPageComponent },
      { path: 'lazy', loadChildren: () => import('./lazy-children.routes').then((m) => m.lazyChildRoutes) },
    ],
  },
  // The same child collection can be mounted beneath multiple component hosts.
  { path: 'alternate-shell', component: LazyPageComponent, children: mountedChildRoutes },
];
