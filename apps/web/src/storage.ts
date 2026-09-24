import type { AppState } from './state.ts';

// Per-browser convenience only. Postgres-backed scenarios arrive with apps/api.
const CURRENT = 'sizing.current.v1';
const SAVED = 'sizing.saved.v1';

export interface SavedScenario {
  name: string;
  savedAt: string;
  state: AppState;
}

function read<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the app keeps working without persistence.
  }
}

export function isAppState(x: unknown): x is AppState {
  const s = x as Partial<AppState> | undefined;
  return !!s && s.version === 1 && !!s.fastForward && !!s.fastReverse && !!s.expertForward && !!s.expertReverse;
}

export function loadCurrent(): AppState | undefined {
  const s = read<unknown>(CURRENT);
  return isAppState(s) ? s : undefined;
}

export function saveCurrent(s: AppState): void {
  write(CURRENT, s);
}

export function listSaved(): SavedScenario[] {
  const list = read<SavedScenario[]>(SAVED) ?? [];
  return list.filter((x) => isAppState(x.state)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function saveNamed(s: AppState): SavedScenario[] {
  const rest = listSaved().filter((x) => x.name !== s.name);
  const next = [{ name: s.name, savedAt: new Date().toISOString(), state: s }, ...rest];
  write(SAVED, next);
  return next;
}

export function deleteNamed(name: string): SavedScenario[] {
  const next = listSaved().filter((x) => x.name !== name);
  write(SAVED, next);
  return next;
}
