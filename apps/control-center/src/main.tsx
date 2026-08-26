import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * React/Vite dependency-admission build proof only (FRONTEND_STAGING_STATUS.json
 * current_stage). This is not a real screen: no server call, no auth, no route, no
 * domain/UX-presentation contract is wired here yet. The staged framework-independent
 * contracts in ./ux-presentation.ts, ./routes.ts, ./state.ts and
 * ./api-client-contract.ts are authoritative for the actual SPA shell that follows in
 * the next framework stage.
 */
function AdmissionProofPlaceholder() {
  return (
    <main>
      <p>AI Commerce Control Center — React/Vite dependency admission build proof.</p>
      <p>No real screen, server call or authority is wired here yet.</p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('CONTROL_CENTER_ROOT_ELEMENT_MISSING');
}

createRoot(container).render(
  <StrictMode>
    <AdmissionProofPlaceholder />
  </StrictMode>,
);
