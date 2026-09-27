import type { NodeGroup, Tier } from '@sizing/engine';

/** One color per data tier, used by the retention timeline, cluster map and node table so tiers read the same everywhere. */
export const TIER_COLOR: Record<Tier, string> = {
  hot: '#E7664C',
  warm: '#D6BF57',
  cold: '#6092C0',
  frozen: '#9170B8',
  content: '#54B399',
};

/** Overhead roles use distinct grays (ML its own hue) so the cluster map tells them apart without competing with the tiers. */
export const ROLE_COLOR: Record<string, string> = {
  ...TIER_COLOR,
  master: '#535966', coordinating: '#7A8291', kibana: '#98A2B3', fleet: '#B0B8C6', apm: '#C4CAD4', ml: '#D36086',
};
export const NEUTRAL_ROLE = '#98A2B3';

export const TIER_LABEL: Record<Tier, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen', content: 'Content' };

export const ROLE_LABEL: Record<NodeGroup['role'], string> = {
  ...TIER_LABEL, master: 'Master', ml: 'ML', coordinating: 'Coordinating', kibana: 'Kibana', fleet: 'Fleet Server', apm: 'APM Server',
};

export const DATA_TIERS: Tier[] = ['hot', 'warm', 'cold', 'frozen', 'content'];

export function roleColor(role: string): string {
  return ROLE_COLOR[role] ?? NEUTRAL_ROLE;
}
