import { EuiProvider } from '@elastic/eui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EuiProvider colorMode="light">
      <App />
    </EuiProvider>
  </StrictMode>,
);
