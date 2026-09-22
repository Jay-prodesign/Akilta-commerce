import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dependency-admission step only (per FRONTEND_STAGING_STATUS.json). Cloudflare Vite
 * plugin / Workers Static Assets deployment integration (doc 30 sec. 4) is deliberately
 * deferred to the next framework stage rather than coupling this standalone React/Vite
 * build proof to the separate apps/api Worker's own dependency graph.
 */
export default defineConfig({
  plugins: [react()],
});
