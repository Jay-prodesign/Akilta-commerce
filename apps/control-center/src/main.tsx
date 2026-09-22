import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('CONTROL_CENTER_ROOT_ELEMENT_MISSING');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
