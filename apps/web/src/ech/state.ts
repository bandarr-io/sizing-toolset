import type { ConstantSet } from '@sizing/constants';
import {
  echApm, echObservability, echSearch, echSecurity, echVector,
  type EchApmRequest, type EchData, type EchObservabilityRequest, type EchPlacement, type EchProvider, type EchResult,
  type EchSearchRequest, type EchSecurityRequest, type EchUseCase, type EchVectorRequest,
} from '@sizing/engine';

/**
 * D40: Elastic Cloud Hosted, priced like the ECH Ballpark Estimator. One placement (cloud, region, channel,
 * subscription) and a list of use cases; each use case is its own deployment and the totals add up, as the
 * spreadsheet's Summary does.
 */
type Placementless<T> = Omit<T, keyof EchPlacement>;
export type EchItem = { id: string; name: string } & (
  | { useCase: 'logs' | 'metrics'; req: Omit<Placementless<EchObservabilityRequest>, 'kind'> }
  | { useCase: 'siem' | 'endpoint'; req: Omit<Placementless<EchSecurityRequest>, 'kind'> }
  | { useCase: 'apm'; req: Placementless<EchApmRequest> }
  | { useCase: 'search'; req: Placementless<EchSearchRequest> }
  | { useCase: 'vector'; req: Placementless<EchVectorRequest> }
);

export interface EchState {
  placement: EchPlacement;
  items: EchItem[];
  /** Show totals with each line rounded up to $1,000, as the spreadsheet does. */
  roundLines: boolean;
}

export const USE_CASES: { value: EchUseCase; label: string; blurb: string; icon: string }[] = [
  { value: 'logs', label: 'Logs', blurb: 'Records of what apps and systems did', icon: 'logoLogging' },
  { value: 'metrics', label: 'Metrics', blurb: 'Numbers measured over time', icon: 'logoMetrics' },
  { value: 'siem', label: 'SIEM', blurb: 'Security events, by volume or events per second', icon: 'logoSecurity' },
  { value: 'endpoint', label: 'Endpoint security', blurb: 'Elastic Defend on laptops, servers and cloud workloads', icon: 'securityApp' },
  { value: 'apm', label: 'APM', blurb: 'Application traces, by traces per minute', icon: 'logoObservability' },
  { value: 'search', label: 'Search', blurb: 'Documents to search, by count and size', icon: 'search' },
  { value: 'vector', label: 'Vector search', blurb: 'Numeric fingerprints for AI search', icon: 'sparkles' },
];
export const useCaseLabel = (u: EchUseCase) => USE_CASES.find((x) => x.value === u)?.label ?? u;

/**
 * Starting inputs for each use case: the spreadsheet's worked examples, except logs and metrics, which start with
 * the same retention as Size a workload (7 days hot, 83 days frozen) instead of the sheet's 1 day hot.
 */
export function newEchItem(useCase: EchUseCase, taken: readonly string[] = []): EchItem {
  const base = useCaseLabel(useCase);
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  const id = `${useCase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  switch (useCase) {
    case 'logs': return { id, name, useCase, req: { gbPerDay: 1000, retentionDays: { hot: 7, frozen: 83 } } };
    case 'metrics': return { id, name, useCase, req: { datapointsPerSecond: 100_000, retentionDays: { hot: 7, frozen: 83 } } };
    case 'siem': return { id, name, useCase, req: { siemUseCase: 'enterprise', gbPerDay: 500, totalDays: 30, logsdb: true, availability: 'high' } };
    case 'endpoint': return { id, name, useCase, req: { endpointUseCase: 'complete_edr', endpoints: 7500, windowsPct: 75, linuxMacPct: 25, totalDays: 7, logsdb: true, availability: 'high' } };
    case 'apm': return { id, name, useCase, req: { tracesPerMinute: 43_000, retentionDays: { hot: 1, warm: 23 } } };
    case 'search': return { id, name, useCase, req: { documents: 1_000_000, avgDocKb: 20, peakOpsPerSecond: 40 } };
    case 'vector': return { id, name, useCase, req: { method: 'bbq', documents: 18_000_000, vectorsPerDoc: 10, dims: 512 } };
  }
}

/** A starting point for the Elastic Cloud use-case list; it replaces the current list. */
export interface EchTemplate { id: string; label: string; blurb: string; icon: string; build: () => EchItem[] }

export const ECH_TEMPLATES: EchTemplate[] = [
  {
    id: 'siem', label: 'SIEM: 500 GB/day for 30 days', blurb: 'Security events with LogsDB and high availability', icon: 'logoSecurity',
    build: () => [newEchItem('siem')],
  },
  {
    id: 'observability', label: 'Observability: logs, metrics and APM', blurb: 'Logs 200 GB/day, 100,000 metric datapoints a second and 5,000 traces a minute', icon: 'logoObservability',
    build: () => {
      const logs = newEchItem('logs');
      const metrics = newEchItem('metrics', [logs.name]);
      const apm = newEchItem('apm', [logs.name, metrics.name]);
      return [
        logs.useCase === 'logs' ? { ...logs, req: { ...logs.req, gbPerDay: 200 } } : logs,
        metrics,
        apm.useCase === 'apm' ? { ...apm, req: { ...apm.req, tracesPerMinute: 5000, retentionDays: { hot: 7, frozen: 23 } } } : apm,
      ];
    },
  },
  {
    id: 'search', label: 'Search app: 1 million documents', blurb: '20 KB documents, 40 searches and writes a second at peak', icon: 'search',
    build: () => [newEchItem('search')],
  },
  {
    id: 'vector', label: 'Vector search: 180 million vectors', blurb: '18 million documents with 10 vectors each, 512 dimensions, BBQ', icon: 'sparkles',
    build: () => [newEchItem('vector')],
  },
];

export function applyEchTemplate(id: string): EchItem[] {
  const t = ECH_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t.build();
}

export function defaultEch(): EchState {
  return {
    placement: { provider: 'aws', region: 'AWS-us-east-1 (N. Virginia)', channel: 'Elastic Direct', tier: 'Enterprise' },
    items: [newEchItem('logs')],
    roundLines: false,
  };
}

/** One use case priced at the placement. */
export function runEchItem(c: ConstantSet, data: EchData, p: EchPlacement, item: EchItem): EchResult {
  switch (item.useCase) {
    case 'logs':
    case 'metrics': return echObservability(c, data, { ...item.req, ...p, kind: item.useCase });
    case 'siem':
    case 'endpoint': return echSecurity(c, data, { ...item.req, ...p, kind: item.useCase });
    case 'apm': return echApm(c, data, { ...item.req, ...p });
    case 'search': return echSearch(c, data, { ...item.req, ...p });
    case 'vector': return echVector(c, data, { ...item.req, ...p });
  }
}

export type EchOutcome = { item: EchItem; result: EchResult } | { item: EchItem; error: string };

export function runEch(c: ConstantSet, data: EchData, s: EchState): EchOutcome[] {
  return s.items.map((item) => {
    try {
      return { item, result: runEchItem(c, data, s.placement, item) };
    } catch (e) {
      return { item, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Totals across use cases, exact or with each line rounded up to $1,000. */
export function echTotals(outcomes: readonly EchOutcome[], rounded: boolean): { annual: number; y1: number } {
  let annual = 0;
  let y1 = 0;
  for (const o of outcomes) {
    if (!('result' in o)) continue;
    annual += rounded ? o.result.totalRounded : o.result.total;
    y1 += rounded ? o.result.y1SpendRounded : o.result.y1Spend;
  }
  return { annual, y1 };
}

// ---- Choices that depend on the data ----------------------------------------------------------------

export const PROVIDERS: { value: EchProvider; text: string }[] = [
  { value: 'aws', text: 'AWS' }, { value: 'gcp', text: 'Google Cloud' }, { value: 'azure', text: 'Azure' },
];

/** Regions the price table covers for the provider, launched ones first. */
export function regionsFor(data: EchData, provider: EchProvider): { name: string; launched: boolean }[] {
  const priced = new Set(Object.keys(data.prices).map((k) => k.split('|')[1]!));
  return data.regions
    .filter((r) => r.provider === provider && priced.has(r.name))
    .map((r) => ({ name: r.name, launched: r.status === 'Launched' }))
    .sort((a, b) => Number(b.launched) - Number(a.launched) || a.name.localeCompare(b.name));
}

export function channelsFor(data: EchData, provider: EchProvider): string[] {
  return [...new Set(data.channelTiers.filter((x) => x.provider === provider).map((x) => x.channel))];
}

export function tiersFor(data: EchData, provider: EchProvider, channel: string): string[] {
  const order = ['Standard', 'Gold', 'Platinum', 'Enterprise'];
  return [...new Set(data.channelTiers.filter((x) => x.provider === provider && x.channel.toUpperCase() === channel.toUpperCase()).map((x) => x.tier))]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** A placement kept valid when the provider or channel changes. */
export function withPlacement(data: EchData, p: EchPlacement, patch: Partial<EchPlacement>): EchPlacement {
  const next = { ...p, ...patch };
  const regions = regionsFor(data, next.provider);
  if (!regions.some((r) => r.name === next.region)) next.region = regions[0]?.name ?? '';
  const channels = channelsFor(data, next.provider);
  if (!channels.some((ch) => ch.toUpperCase() === next.channel.toUpperCase())) next.channel = (channels[0] ?? 'Elastic Direct') as EchPlacement['channel'];
  const tiers = tiersFor(data, next.provider, next.channel);
  if (!tiers.includes(next.tier)) next.tier = (tiers.includes('Enterprise') ? 'Enterprise' : tiers.at(-1) ?? 'Enterprise') as EchPlacement['tier'];
  return next;
}

/** Instance types offered for a role's type (Specs col C, e.g. data_hot) at the placement. */
export function skusFor(data: EchData, p: EchPlacement, type: string): { id: string; offered: boolean }[] {
  return data.skus
    .filter((s) => s.provider === p.provider && s.type.replace(/\*$/, '') === type)
    .map((s) => ({ id: s.id, offered: !s.excludedRegions.includes(p.region) && data.prices[`${s.id}|${p.region}|${p.tier}`] !== undefined }));
}

export function placementSummary(p: EchPlacement): string {
  const cloud = PROVIDERS.find((x) => x.value === p.provider)?.text ?? p.provider;
  return [cloud, p.region.replace(/^[A-Z]+-/, ''), p.channel, p.tier].join(' · ');
}
