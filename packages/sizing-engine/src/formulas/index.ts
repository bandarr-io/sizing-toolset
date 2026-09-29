import { FORMULAS as ech } from './ech.ts';
import { FORMULAS as reverse } from './reverse.ts';
import { FORMULAS as sizing } from './sizing.ts';
import { FORMULAS as topology } from './topology.ts';
import type { Formula } from './types.ts';

export type { Formula, FormulaArea } from './types.ts';

/** Every engine formula, in page order. Web-only formulas (Total cost) are added by the web app. */
export const ENGINE_FORMULAS: readonly Formula[] = [...sizing, ...reverse, ...topology, ...ech];
