import { apmDefaultSku } from './apm.ts';
import { defaultSku, EchUnavailable, type EchPlacement } from './common.ts';
import { searchDefaultSku, vectorDefaultSku } from './search.ts';
import type { EchData, EchRole, EchUseCase } from './types.ts';

/**
 * The instance type a use case uses for a role when none is chosen, so the pickers can show it by name.
 * Undefined when the provider offers none for that role.
 */
export function echDefaultSku(data: EchData, p: EchPlacement, useCase: EchUseCase, role: string): string | undefined {
  try {
    switch (useCase) {
      case 'apm': return apmDefaultSku(data, p, role as Parameters<typeof apmDefaultSku>[2]);
      case 'search': return searchDefaultSku(data, p, role as Parameters<typeof searchDefaultSku>[2]);
      case 'vector': return vectorDefaultSku(data, p);
      default: return defaultSku(data, p, role as EchRole);
    }
  } catch (e) {
    if (e instanceof EchUnavailable) return undefined;
    throw e;
  }
}
