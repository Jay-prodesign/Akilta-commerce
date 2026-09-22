import { CONTROL_CENTER_ROUTES, type ControlCenterRoute } from './routes';

/**
 * Framework-independent route matching (no React/DOM dependency) so it stays unit-testable
 * the same way as routes.ts/state.ts/ux-presentation.ts. Route params are presentation
 * routing hints only -- per CLIENT_AUTHORITY_POLICY (ux-presentation.ts) they never
 * authorize tenant/resource/action access; the server always rechecks.
 */
export interface MatchedControlCenterRoute {
  readonly route: ControlCenterRoute;
  readonly params: Readonly<Record<string, string>>;
}

function toSegments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

export function matchControlCenterRoute(pathname: string): MatchedControlCenterRoute | null {
  const pathSegments = toSegments(pathname);

  for (const route of CONTROL_CENTER_ROUTES) {
    const routeSegments = toSegments(route);
    if (routeSegments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < routeSegments.length; index += 1) {
      const routeSegment = routeSegments[index];
      const pathSegment = pathSegments[index];
      if (routeSegment === undefined || pathSegment === undefined) {
        matched = false;
        break;
      }
      if (routeSegment.startsWith(':')) {
        if (pathSegment.length === 0) {
          matched = false;
          break;
        }
        params[routeSegment.slice(1)] = pathSegment;
      } else if (routeSegment !== pathSegment) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
