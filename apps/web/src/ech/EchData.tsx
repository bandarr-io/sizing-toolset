import type { EchData } from '@sizing/engine';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * D40: ECH prices are internal, so they are never bundled. The app reads the file the import script writes
 * (public/ech-data.local.json, served in development) or one the viewer uploads (kept in this browser).
 */
const KEY = 'sizing.ech-data.v1';
const URL = `${import.meta.env.BASE_URL}ech-data.local.json`;

type Status = 'loading' | 'ready' | 'missing';
interface Ctx { data: EchData | undefined; status: Status; from: 'file' | 'upload' | undefined; upload: (f: File) => Promise<void>; forget: () => void }
const EchDataContext = createContext<Ctx | undefined>(undefined);

function isEchData(x: unknown): x is EchData {
  const d = x as Partial<EchData> | undefined;
  return !!d && Array.isArray(d.skus) && !!d.prices && typeof d.prices === 'object' && Array.isArray(d.regions) && !!d.source;
}

function readStored(): EchData | undefined {
  try {
    const raw = window.localStorage.getItem(KEY);
    const d = raw ? JSON.parse(raw) : undefined;
    return isEchData(d) ? d : undefined;
  } catch {
    return undefined;
  }
}

export function EchDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EchData | undefined>(readStored);
  const [from, setFrom] = useState<'file' | 'upload' | undefined>(() => (readStored() ? 'upload' : undefined));
  const [status, setStatus] = useState<Status>(data ? 'ready' : 'loading');

  useEffect(() => {
    if (data) return;
    let live = true;
    fetch(URL)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d: unknown) => {
        if (!live) return;
        if (isEchData(d)) { setData(d); setFrom('file'); setStatus('ready'); } else setStatus('missing');
      })
      .catch(() => live && setStatus('missing'));
    return () => { live = false; };
  }, [data]);

  const upload = useCallback(async (f: File) => {
    const d: unknown = JSON.parse(await f.text());
    if (!isEchData(d)) throw new Error('this is not an ECH data file from the import script');
    try { window.localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* too big or blocked: keep it for this visit */ }
    setData(d);
    setFrom('upload');
    setStatus('ready');
  }, []);
  const forget = useCallback(() => {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
    setData(undefined);
    setFrom(undefined);
    setStatus('loading');
  }, []);

  return <EchDataContext.Provider value={{ data, status, from, upload, forget }}>{children}</EchDataContext.Provider>;
}

export function useEchData(): Ctx {
  const c = useContext(EchDataContext);
  if (!c) throw new Error('useEchData outside EchDataProvider');
  return c;
}
