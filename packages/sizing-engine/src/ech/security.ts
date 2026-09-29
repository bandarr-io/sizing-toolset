// ECH Ballpark Estimator v4.6: SIEM and Endpoint security sheets (D40), reproduced formula for formula.
// Cell references point at the engine sheets `SIEM Security` / `Endpoint Security` (same layout) and at
// `Security - Data Validation`. The front ends only feed these inputs; the hidden "(Default)" copies only feed a
// "default RAM" readback and are not reproduced.
import { num, val, type ConstantSet } from '@sizing/constants';
import { ceilEps, fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import {
  checkPlacement, defaultSku, dtsPrice, type EchPlacement, EchUnavailable, fitStep, fitToIncrements, monthlyPerGb, placementNotes, roundLine, skuOf,
} from './common.ts';
import type { EchData, EchLine, EchResult, EchRole } from './types.ts';

type DataTier = 'hot' | 'warm' | 'cold' | 'frozen';
type Fixed = 'master' | 'coordinating' | 'ml' | 'kibana';
const DATA_TIERS: DataTier[] = ['hot', 'warm', 'cold', 'frozen'];
const FIXED: Fixed[] = ['master', 'coordinating', 'ml', 'kibana'];

export type EchAvailability = 'standard' | 'high' | 'maximum';
export type EchSiemUseCase = 'ultra_small' | 'small' | 'soc' | 'enterprise';
export type EchEndpointUseCase = 'ngav' | 'essential_edr' | 'complete_edr' | 'cwp_protect' | 'cwp_monitor' | 'cwp_comprehensive';

export interface EchSecurityRequest extends EchPlacement {
  kind: 'siem' | 'endpoint';
  /** SIEM front end D3. */
  siemUseCase?: EchSiemUseCase;
  /** SIEM D5: daily volume. */
  gbPerDay?: number;
  /** SIEM D8: events per second; the larger of this and gbPerDay is used (I29). */
  eventsPerSecond?: number;
  /** SIEM D14, D15: only size "SIEM - enterprise" ML and Kibana. */
  detectionRuleInstances?: number;
  analystsPerShift?: number;
  /** Endpoint front end D3. */
  endpointUseCase?: EchEndpointUseCase;
  /** Endpoint D5: endpoints or workloads. */
  endpoints?: number;
  /** Endpoint D7, D8: % Windows and % Linux or macOS (not checked to add to 100, as in the sheet). */
  windowsPct?: number;
  linuxMacPct?: number;
  /** D10: total days searchable → 1 hot + 6 cold + the rest frozen (totals under 7 are sized as 7). */
  totalDays: number;
  /** D11: use LogsDB (E113 = 100% or 0%). */
  logsdb: boolean;
  /** SIEM D17 / Endpoint D14: sets zones and replicas per tier. */
  availability: EchAvailability;
  /** Engine E24:E34; blank uses the spreadsheet's default for the provider. */
  skus?: Partial<Record<EchRole, string>>;
  /** Override the use case's master, coordinating, ML and Kibana RAM (GB, all zones). */
  fixedRamGb?: Partial<Record<Fixed, number>>;
  reservedStorage?: number;
  indexFactor?: number;
  reservedCpu?: number;
  frozenRamToBlob?: number;
  /** D50/D55:D57: price the rounded node RAM (the sheet's default) or the raw need. */
  useRoundedRam?: boolean;
}

const LABEL: Record<DataTier | Fixed, string> = {
  hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen', master: 'Master', coordinating: 'Coordinating', ml: 'Machine learning', kibana: 'Kibana',
};

// Same rule as observability.ts (not exported there): the sheet's own default, else the first production SKU.
/** Master, coordinating, ML and Kibana RAM for the use case (Data Validation AD:AG, rows 4:13). */
function fixedRam(c: ConstantSet, req: EchSecurityRequest): { ram: Record<Fixed, number>; keys: string[]; expr: Record<Fixed, string> } {
  const base = val<{ master: number; coordinating: number }>(c, 'ech.security.fixed_ram_gb');
  if (req.kind === 'siem') {
    const uc = req.siemUseCase ?? 'enterprise';
    if (uc === 'enterprise') {
      // AF13 = MAX(16, rules × 8); AG13 = MAX(16, rules × 8) + ROUNDUP(analysts / 10) × 8.
      const e = val<{ min_gb: number; gb_per_rule_instance: number; analysts_per_step: number; gb_per_analyst_step: number }>(c, 'ech.security.siem_enterprise_ram');
      const rules = req.detectionRuleInstances ?? num(c, 'ech.security.siem_default_rule_instances');
      const analysts = req.analystsPerShift ?? num(c, 'ech.security.siem_default_analysts');
      const ml = Math.max(e.min_gb, rules * e.gb_per_rule_instance);
      const kibana = ml + ceilEps(analysts / e.analysts_per_step) * e.gb_per_analyst_step;
      return {
        ram: { ...base, ml, kibana },
        keys: ['ech.security.fixed_ram_gb', 'ech.security.siem_enterprise_ram', ...(req.detectionRuleInstances === undefined ? ['ech.security.siem_default_rule_instances'] : []), ...(req.analystsPerShift === undefined ? ['ech.security.siem_default_analysts'] : [])],
        expr: {
          master: `${base.master} GB, fixed`, coordinating: `${base.coordinating} GB, fixed`,
          ml: `MAX(${e.min_gb}, ${fmt(rules)} rule instances × ${e.gb_per_rule_instance})`,
          kibana: `${fmt(ml)} + ROUNDUP(${fmt(analysts)} analysts / ${e.analysts_per_step}) × ${e.gb_per_analyst_step}`,
        },
      };
    }
    const t = val<Record<Exclude<EchSiemUseCase, 'enterprise'>, { ml: number; kibana: number }>>(c, 'ech.security.siem_ram')[uc];
    return { ram: { ...base, ...t }, keys: ['ech.security.fixed_ram_gb', 'ech.security.siem_ram'], expr: { master: `${base.master} GB, fixed`, coordinating: `${base.coordinating} GB, fixed`, ml: `${t.ml} GB for ${uc}`, kibana: `${t.kibana} GB for ${uc}` } };
  }
  // Endpoint: AF = (base + ROUNDUP(endpoints / 10,000)) × 8 (NGAV has no ML); AG fixed per use case.
  const uc = req.endpointUseCase ?? 'complete_edr';
  const e = val<{ ml_base_steps: Record<EchEndpointUseCase, number | null>; endpoints_per_step: number; gb_per_step: number; kibana_gb: Record<EchEndpointUseCase, number> }>(c, 'ech.security.endpoint_ram');
  const n = req.endpoints ?? 0;
  const b = e.ml_base_steps[uc];
  const ml = b === null ? 0 : (b + ceilEps(n / e.endpoints_per_step)) * e.gb_per_step;
  return {
    ram: { ...base, ml, kibana: e.kibana_gb[uc] }, keys: ['ech.security.fixed_ram_gb', 'ech.security.endpoint_ram'],
    expr: { master: `${base.master} GB, fixed`, coordinating: `${base.coordinating} GB, fixed`, ml: b === null ? 'none for this use case' : `(${b} + ROUNDUP(${fmt(n, 0)} / ${e.endpoints_per_step})) × ${e.gb_per_step}`, kibana: `${e.kibana_gb[uc]} GB for ${uc}` },
  };
}

export function echSecurity(c: ConstantSet, data: EchData, req: EchSecurityRequest): EchResult {
  checkPlacement(data, req);
  const siem = req.kind === 'siem';
  const warnings: string[] = placementNotes(c, req);
  const enterprise = req.tier === 'Enterprise';

  // Availability → zones and replicas (Data Validation B24:L26).
  const avail = val<Record<EchAvailability, { zones: Record<DataTier, number>; replicas: Record<'hot' | 'warm' | 'cold', number> }>>(c, 'ech.security.availability')[req.availability];
  const reserve = req.reservedStorage ?? num(c, 'ech.reserved_storage');
  const f = req.indexFactor ?? num(c, 'ech.security.index_factor');
  const reservedCpu = req.reservedCpu ?? num(c, 'ech.reserved_cpu_search');
  const L = req.logsdb ? 1 : 0;
  // K151: LogsDB reduction, 60% SIEM / 22% Endpoint on Enterprise, else 19%. M155: 15% ingest impact off Enterprise.
  const reductions = val<{ siem: number; endpoint: number; non_enterprise: number }>(c, 'ech.security.logsdb_reduction');
  const R = enterprise ? reductions[req.kind] : reductions.non_enterprise;
  const ingestImpact = enterprise ? 0 : num(c, 'ech.security.logsdb_ingest_impact_non_enterprise');
  const rounded = req.useRoundedRam ?? true;
  const skuId = (r: EchRole) => req.skus?.[r] ?? defaultSku(data, req, r);

  // Ingest per day V (K150 = K128).
  let V: number;
  let dailyStep: MathStep;
  const facts: NonNullable<EchResult['facts']> = [];
  const bytesPerEvent = num(c, 'ech.security.bytes_per_event');
  if (siem) {
    // I29 = MAX(GB/day, EPS × 500 bytes × 86,400 / 1e9); J29 = I29 as events/s at 500 bytes.
    const gb = req.gbPerDay ?? 0;
    const eps = req.eventsPerSecond ?? 0;
    const fromEps = (eps * bytesPerEvent * 86_400) / 1e9;
    V = Math.max(gb, fromEps);
    dailyStep = step('ingest per day', `MAX(${fmt(gb)} GB/day, ${fmt(eps, 0)} events/s × ${bytesPerEvent} bytes × 86,400 / 1e9)`, V, ['ech.security.bytes_per_event']);
    facts.push({ label: 'Events per second equivalent', value: (V / 86_400 / bytesPerEvent) * 1e9, unit: 'events/s' });
  } else {
    // K = (Win% × Windows MB/day + LinMac% × blended Linux/macOS MB/day) / 100; V = endpoints × K / 1000 (+ 0 non-agent).
    const e = val<{ mb_per_day: Record<EchEndpointUseCase, { windows: number; linux: number; macos: number }>; linux_mac_weights: { linux: number; macos: number } }>(c, 'ech.security.endpoint_ingest');
    const uc = req.endpointUseCase ?? 'complete_edr';
    const row = e.mb_per_day[uc];
    const w = e.linux_mac_weights;
    const linMac = (row.linux * w.linux + row.macos * w.macos) / (w.linux + w.macos);
    const mix = val<{ windows: number; linux_mac: number }>(c, 'ech.security.endpoint_default_mix');
    const win = req.windowsPct ?? mix.windows;
    const lin = req.linuxMacPct ?? mix.linux_mac;
    const mb = (win * row.windows + lin * linMac) / 100;
    const n = req.endpoints ?? 0;
    V = (n * mb) / 1000;
    dailyStep = step('ingest per day', `${fmt(n, 0)} endpoints × (${fmt(win)}% × ${fmt(row.windows)} + ${fmt(lin)}% × ${fmt(linMac)}) MB / 100 / 1000`, V,
      ['ech.security.endpoint_ingest', ...(req.windowsPct === undefined || req.linuxMacPct === undefined ? ['ech.security.endpoint_default_mix'] : [])]);
    facts.push({ label: 'Data per endpoint', value: mb, unit: 'MB/day' });
  }

  // Retention (Data Validation Q:T): 1 hot + 0 warm + 6 cold + (total − 7) frozen when total > 7.
  const base = val<{ hot: number; warm: number; cold: number }>(c, 'ech.security.retention_days');
  const fixedDays = base.hot + base.warm + base.cold;
  const retention: Record<DataTier, number> = { ...base, frozen: req.totalDays > fixedDays ? req.totalDays - fixedDays : 0 };
  if (req.totalDays < fixedDays) warnings.push(`Totals under ${fixedDays} days are sized as ${fixedDays} (1 hot and 6 cold), as in the spreadsheet.`);
  const days = (t: DataTier) => retention[t];
  const retentionStep = step('retention', `${base.hot} hot + ${base.warm} warm + ${base.cold} cold + ${fmt(retention.frozen)} frozen days`, DATA_TIERS.reduce((s, t) => s + days(t), 0), ['ech.security.retention_days']);

  /** K160, K200, K237: one copy of a tier's data with LogsDB. */
  const oneCopy = (t: DataTier) => V * days(t) * L * (1 - R) + (1 - L) * V * days(t);
  const reductionKeys = L > 0 ? ['ech.security.logsdb_reduction'] : [];
  const oneCopyStep = (t: DataTier) => step(`${t} data, one copy`, `${fmt(V)} × ${fmt(days(t))} days × (${L} × (1 − ${R}) + ${1 - L})`, oneCopy(t), reductionKeys);
  const reserveKeys = req.reservedStorage === undefined ? ['ech.reserved_storage'] : [];
  const fKeys = req.indexFactor === undefined ? ['ech.security.index_factor'] : [];

  const lines: EchLine[] = [];
  const priced = (key: string, label: string, id: string, ramGb: number, extra: Partial<EchLine>, math: MathStep[]) => {
    try {
      const sku = skuOf(data, id);
      const price = monthlyPerGb(c, data, sku, req);
      const annual = price.value * ramGb * 12;
      lines.push({
        key, label, sku: sku.id, ramGb, monthlyPerGb: price.value, annual, annualRounded: roundLine(c, annual), ...extra,
        math: [...math, price.math, step(`${label} per year`, `$${fmt(price.value)} × ${fmt(ramGb)} GB × 12`, annual, [])],
      });
    } catch (e) {
      if (!(e instanceof EchUnavailable)) throw e;
      warnings.push(`${label}: ${e.message} The spreadsheet shows #NA and leaves this line out of the total.`);
      lines.push({ key, label, sku: id, ramGb, annual: 0, annualRounded: 0, math, error: e.message, ...extra });
    }
  };

  for (const t of DATA_TIERS) {
    if (days(t) <= 0) continue;
    const sku = skuOf(data, skuId(t));
    const z = avail.zones[t];
    const math: MathStep[] = [dailyStep, retentionStep, oneCopyStep(t)];
    let need: number;
    let constraint: 'disk' | 'cpu' | undefined;
    if (t === 'frozen') {
      // K276 blob = one copy × f (no replicas, no reserve); K277 RAM = blob / 1,600.
      const ratio = req.frozenRamToBlob ?? num(c, 'ech.frozen_ram_to_blob');
      const blob = oneCopy(t) * f;
      need = blob / ratio;
      math.push(
        step('frozen snapshot data', `${fmt(oneCopy(t))} × ${fmt(f)} index factor`, blob, fKeys),
        step('frozen RAM needed', `${fmt(blob)} / ${fmt(ratio)}`, need, req.frozenRamToBlob === undefined ? ['ech.frozen_ram_to_blob'] : []),
      );
    } else {
      // K161:K166: replicas, index factor, reserve, then disk / RAM:Disk.
      const r = avail.replicas[t];
      const disk = (oneCopy(t) * (1 + r) * f) / (1 - reserve);
      const diskRam = disk / sku.ramDisk;
      math.push(
        step(`${t} disk needed`, `${fmt(oneCopy(t))} × (1 + ${r}) × ${fmt(f)} / (1 − ${fmt(reserve)})`, disk, ['ech.security.availability', ...fKeys, ...reserveKeys]),
        step(`${t} RAM for disk`, `${fmt(disk)} / ${fmt(sku.ramDisk)} (${sku.id} RAM:Disk)`, diskRam, []),
      );
      need = diskRam;
      constraint = 'disk';
      if (t === 'hot') {
        // K158, M156, K167: CPU path ignores replicas (quirk kept); LogsDB share uses the impact-adjusted rate.
        const rate = sku.ingestPerGbRamPerDay * (1 - reservedCpu);
        const rateLogsdb = sku.ingestPerGbRamPerDay * (1 - ingestImpact) * (1 - reservedCpu);
        const cpuRam = rateLogsdb === 0 ? V / rate : (1 - L) * (V / rate) + (L * V) / rateLogsdb;
        math.push(step('hot RAM for ingest', `${fmt(V)} / (${fmt(sku.ingestPerGbRamPerDay)}${ingestImpact && L ? ` × (1 − ${ingestImpact})` : ''} × (1 − ${fmt(reservedCpu)}))`, cpuRam,
          [...(req.reservedCpu === undefined ? ['ech.reserved_cpu_search'] : []), ...(ingestImpact && L ? ['ech.security.logsdb_ingest_impact_non_enterprise'] : [])]));
        if (cpuRam > need) { need = cpuRam; constraint = 'cpu'; }
        math.push(step('hot RAM needed', 'max(RAM for disk, RAM for ingest)', need, []));
      }
    }
    const fit = fitToIncrements(need, z, sku.increments);
    math.push(fitStep(`${t} nodes`, need, fit));
    const ram = rounded ? fit.roundedGb : need;
    priced(t, LABEL[t], sku.id, ram, {
      nodesPerZone: fit.nodesPerZone, nodeSizeGb: fit.nodeSizeGb, zones: z, diskGb: ram * sku.ramDisk, ...(constraint ? { constraint } : {}),
    }, math);
  }

  // Master, coordinating, ML, Kibana: use-case RAM, total across zones, no increment rounding (J35:J38).
  const fixed = fixedRam(c, req);
  for (const role of FIXED) {
    const ram = req.fixedRamGb?.[role] ?? fixed.ram[role];
    if (ram <= 0) continue;
    priced(role, LABEL[role], skuId(role), ram, {}, [step(`${LABEL[role]} RAM`, req.fixedRamGb?.[role] === undefined ? fixed.expr[role] : `${fmt(ram)} GB, set`, ram, req.fixedRamGb?.[role] === undefined ? fixed.keys : [])]);
  }

  // Data transfer and storage (rows 84:97). No region overrides on these sheets.
  const rawToJson = num(c, 'ech.security.raw_to_json');
  const n2n = num(c, 'ech.node_to_node_compression');
  const dataIn = (V * rawToJson * 365) / 12;
  const coordToHot = dataIn * (1 - n2n);
  const hotToHot = dataIn * avail.replicas.hot * (1 - n2n);
  // J90: multiplies by the LogsDB reduction R where the stored share (1 − R) belongs; kept to match.
  const hotToBlob = L > 0 ? (dataIn / rawToJson) * f * R * L + (dataIn / rawToJson) * f * (1 - L) : (dataIn / rawToJson) * f;
  const interNodeGb = coordToHot + hotToHot + hotToBlob;
  // I94: LogsDB-reduced one copy of every tier × f; without LogsDB, V × f × total days.
  const totalDays = DATA_TIERS.reduce((s, t) => s + days(t), 0);
  const snapshotGb = L > 0 ? DATA_TIERS.reduce((s, t) => s + oneCopy(t), 0) * f : V * f * totalDays;
  const dataOutGb = snapshotGb * num(c, 'ech.security.data_out_share');
  const apiCalls = num(c, 'ech.storage_api_calls_per_hour') * num(c, 'ech.hours_per_month');
  const pInter = dtsPrice(data, req, 'Data inter-node', false);
  const pOut = dtsPrice(data, req, 'Data out', false);
  const pSnap = dtsPrice(data, req, 'Snapshot storage', false);
  const pApi = dtsPrice(data, req, 'Storage api', false);
  const transfer = (interNodeGb * pInter + dataOutGb * pOut) * 12;
  const storage = (snapshotGb * pSnap + apiCalls * pApi) * 12;
  lines.push({
    key: 'transfer', label: 'Data transfer', annual: transfer, annualRounded: roundLine(c, transfer),
    math: [
      step('data in per month (JSON)', `${fmt(V)} × ${rawToJson} × 365 / 12`, dataIn, ['ech.security.raw_to_json']),
      step('between nodes per month', `coordinating→hot ${fmt(coordToHot)} + replication ${fmt(hotToHot)} + hot→snapshot ${fmt(hotToBlob)}`, interNodeGb, ['ech.node_to_node_compression', 'ech.security.availability', ...reductionKeys, ...fKeys]),
      step('data out per month', `${fmt(snapshotGb)} GB snapshots × ${num(c, 'ech.security.data_out_share')}`, dataOutGb, ['ech.security.data_out_share']),
      step('data transfer per year', `(${fmt(interNodeGb)} × $${pInter} + ${fmt(dataOutGb)} × $${pOut}) × 12`, transfer, []),
    ],
  });
  lines.push({
    key: 'storage', label: 'Snapshot storage and API calls', annual: storage, annualRounded: roundLine(c, storage),
    math: [
      step('snapshot storage', L > 0 ? `Σ tier data one copy × ${fmt(f)}` : `${fmt(V)} × ${fmt(f)} × ${fmt(totalDays)} days`, snapshotGb, [...reductionKeys, ...fKeys]),
      step('storage API calls per month (thousands)', `${num(c, 'ech.storage_api_calls_per_hour')} × ${num(c, 'ech.hours_per_month')}`, apiCalls, ['ech.storage_api_calls_per_hour', 'ech.hours_per_month']),
      step('storage per year', `(${fmt(snapshotGb)} × $${pSnap} + ${fmt(apiCalls)} × $${pApi}) × 12`, storage, []),
    ],
  });

  // J41 total, J43 year-one spend.
  const total = lines.reduce((s, l) => s + l.annual, 0);
  const totalRounded = lines.reduce((s, l) => s + l.annualRounded, 0);
  const ratio = totalDays / 365;
  const y1 = (T: number, S: number) => (ratio > 1 ? T - S / 2 : T - S + (S / 2) * ratio + S * (1 - ratio));

  if (req.tier === 'Standard') warnings.push('Standard is not offered for annual deals.');
  if ((days('cold') > 0 || days('frozen') > 0) && !enterprise) warnings.push('Cold and frozen tiers need the Enterprise subscription.');

  return {
    kind: req.kind, dailyGb: V, lines, total, totalRounded,
    y1Spend: y1(total, storage), y1SpendRounded: y1(totalRounded, roundLine(c, storage)),
    warnings, source: data.source, facts,
  };
}
