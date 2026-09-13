import { Routes } from '@angular/router';
import { ChildPageComponent } from './child-page.component';

// Declared before the array that mounts it, on purpose: the mount point of a
// route array must not depend on declaration order (issue 32, F-04).
export const mountedChildRoutes: Routes = [
  { path: 'mounted', component: ChildPageComponent },
];

export const shellRoutes: Routes = [
  { path: 'shell', children: mountedChildRoutes },
];
