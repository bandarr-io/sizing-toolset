import { EuiProvider } from '@elastic/eui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ConstantsProvider } from './constantsStore.tsx';
import { CostDefaultsProvider } from './costStore.tsx';
import { ServiceCatalogProvider } from './servicesStore.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EuiProvider colorMode="light">
      <ConstantsProvider>
        <CostDefaultsProvider>
        <ServiceCatalogProvider>
          <App />
        </ServiceCatalogProvider>
        </CostDefaultsProvider>
      </ConstantsProvider>
    </EuiProvider>
  </StrictMode>,
);
