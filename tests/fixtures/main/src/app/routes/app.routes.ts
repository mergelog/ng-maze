import { Routes } from '@angular/router';
import { RoutePageComponent } from './page.component';

export const appRoutes: Routes = [
  {
    path: 'conditional-lazy',
    loadComponent: routeFlag
      ? () => import('./lazy-page.component').then((m) => m.LazyPageComponent)
      : () => import('./page.component').then((m) => m.RoutePageComponent),
  },
  { path: 'not-a-component', component: PlainRouteClass },
  { path: 'named', outlet: 'side', component: RoutePageComponent },
  { path: 'page', component: RoutePageComponent },
  {
    path: 'lazy',
    loadComponent: () => import('./lazy-page.component').then((m) => m.LazyPageComponent),
  },
  {
    path: 'default',
    loadComponent: () => import('./default-export-page.component').then((m) => m.default),
  },
  {
    path: 'parent',
    children: [
      { path: 'child', component: RoutePageComponent },
    ],
  },
  {
    path: 'lazy-children',
    loadChildren: () => import('./lazy-children.routes').then((m) => m.lazyChildRoutes),
  },
  {
    path: 'unresolved',
    loadComponent: () => resolveLazyComponent(),
  },
];

declare function resolveLazyComponent(): unknown;
declare const routeFlag: boolean;
class PlainRouteClass {}
