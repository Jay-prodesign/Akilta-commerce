import { useEffect, useState } from 'react';
import { CONTROL_CENTER_ROUTES, type ControlCenterRoute } from './routes';
import { matchControlCenterRoute } from './route-matcher';
import { readinessPresentation } from './state';

function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function NavLink({ route }: { readonly route: ControlCenterRoute }) {
  return (
    <a
      href={route}
      onClick={(event) => {
        event.preventDefault();
        navigate(route);
      }}
    >
      {route}
    </a>
  );
}

/**
 * Real client-side routing over the staged, framework-independent route/state contracts
 * (route-matcher.ts, routes.ts, state.ts) -- not a fabricated screen. Per
 * CLIENT_AUTHORITY_POLICY (ux-presentation.ts) route params are display hints only and
 * grant no authority. No backend call is made: apps/api has no route-specific endpoint
 * yet, so every screen honestly reports NOT_STARTED via the existing readinessPresentation
 * function rather than a fabricated connected/available state.
 */
export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const matched = matchControlCenterRoute(pathname);
  const readiness = readinessPresentation('NOT_STARTED');

  return (
    <div>
      <nav>
        {CONTROL_CENTER_ROUTES.map((route) => (
          <NavLink key={route} route={route} />
        ))}
      </nav>
      <main>
        {matched ? (
          <section>
            <h1>{matched.route}</h1>
            {Object.keys(matched.params).length > 0 && (
              <p>Route params (display hint only, grants no authority): {JSON.stringify(matched.params)}</p>
            )}
            <p role="status">{readiness.label}</p>
          </section>
        ) : (
          <p role="status">No matching Control Center route for &quot;{pathname}&quot;.</p>
        )}
      </main>
    </div>
  );
}
