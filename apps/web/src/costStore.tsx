import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CostRates } from './cost.ts';

// Default prices live in this browser only. List prices have no public source, so they never enter packages/constants.
const STORAGE_KEY = 'sizing.costDefaults.v1';
const SEED: CostRates = { amortYears: 3 };

function load(): CostRates {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CostRates) : SEED;
  } catch {
    return SEED;
  }
}

interface CostDefaultsState {
  defaults: CostRates;
  setDefaults: (r: CostRates) => void;
}

const Ctx = createContext<CostDefaultsState>({ defaults: SEED, setDefaults: () => {} });

export function CostDefaultsProvider({ children }: { children: ReactNode }) {
  const [defaults, setState] = useState<CostRates>(load);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults)); } catch { /* storage unavailable */ }
  }, [defaults]);
  const setDefaults = useCallback((r: CostRates) => setState(r), []);
  const value = useMemo(() => ({ defaults, setDefaults }), [defaults, setDefaults]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCostDefaults(): CostDefaultsState {
  return useContext(Ctx);
}
