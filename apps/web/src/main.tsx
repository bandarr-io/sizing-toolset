import { EuiProvider } from '@elastic/eui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ConstantsProvider } from './constantsStore.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EuiProvider colorMode="light">
      <ConstantsProvider>
        <App />
      </ConstantsProvider>
    </EuiProvider>
  </StrictMode>,
);
