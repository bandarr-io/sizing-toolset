import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseCatalog, SEED_CATALOG, upgradeCatalog, type ServiceItem } from './services.ts';

// The service catalog and its default prices live in this browser only, like the cost defaults (D46).
const STORAGE_KEY = 'sizing.serviceCatalog.v1';

function load(): ServiceItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? parseCatalog(JSON.parse(raw)) : undefined;
    return saved ? upgradeCatalog(saved) : SEED_CATALOG;
  } catch {
    return SEED_CATALOG;
  }
}

interface ServiceCatalogState {
  catalog: ServiceItem[];
  setCatalog: (c: ServiceItem[]) => void;
}

const Ctx = createContext<ServiceCatalogState>({ catalog: SEED_CATALOG, setCatalog: () => {} });

export function ServiceCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setState] = useState<ServiceItem[]>(load);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog)); } catch { /* storage unavailable */ }
  }, [catalog]);
  const setCatalog = useCallback((c: ServiceItem[]) => setState(c), []);
  const value = useMemo(() => ({ catalog, setCatalog }), [catalog, setCatalog]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useServiceCatalog(): ServiceCatalogState {
  return useContext(Ctx);
}
