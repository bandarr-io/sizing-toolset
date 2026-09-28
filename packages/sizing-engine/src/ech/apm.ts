// ECH Ballpark Estimator v4.6: APM sheet, reproduced formula for formula (D40). Cell references point at the APM sheet.
// The sheet is the Logs template with the ingest switched to APM traces, an APM (Integrations Server) line sized
// from events/s, and data transfer as a flat share of the data tiers plus APM.
import { num, val, type ConstantSet } from '@sizing/constants';
import { fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import {
  checkPlacement, type EchPlacement, EchUnavailable, fitStep, fitToIncrements, monthlyPerGb, placementNotes, roundLine, skuOf,
} from './common.ts';
import type { EchData, EchLine, EchResult } from './types.ts';

type DataTier = 'hot' | 'warm' | 'cold' | 'frozen';
type Fixed = 'master' | 'coordinating' | 'ml' | 'kibana';
type ApmRole = DataTier | Fixed | 'apm';
const DATA_TIERS: DataTier[] = ['hot', 'warm', 'cold', 'frozen'];
const FIXED: Fixed[] = ['master', 'coordinating', 'ml', 'kibana'];

/** data.extras.apm, written by scripts/ech-import/apm.mjs. */
export interface EchApmExtras {
  /** Specs!B1164: events/s one GB of APM Server RAM serves. */
  eventsPerSecPerGb: number;
  /** Specs!X1168:X1858: APM Server sizes, GB (1, 2, 4, 8, 15, 30, then +30). */
  ladder: number[];
  /** Specs!AF1168:AF1858: sizes for the instance types in `secondLadderSkus` (1, 2, 4, 8, 16, 32, then +32). */
  secondLadder: number[];
  /** APM!K148: instance types that use the second ladder. */
  secondLadderSkus: string[];
  /** APM!E24:E34 (the sheet's provider) and Logs!E29 (AWS APM Server): default instance per role. */
  defaults: Partial<Record<string, Partial<Record<ApmRole, string>>>>;
}

export interface EchApmRequest extends EchPlacement {
  /** E14: traces per minute. */
  tracesPerMinute: number;
  /** E15: trace sampling rate, 0 to 1. */
  samplingRate?: number;
  /** E106, E107: average transaction and span document sizes, bytes. */
  transactionDocBytes?: number;
  spanDocBytes?: number;
  /** E108: share of chatty applications (500 spans per transaction). */
  chattyShare?: number;
  retentionDays: Partial<Record<DataTier, number>>;
  /** Instance type per role (E24:E34); blank uses the sheet's default for the provider. */
  skus?: Partial<Record<ApmRole, string>>;
  zones?: Partial<Record<DataTier, number>>;
  replicas?: Partial<Record<'hot' | 'warm' | 'cold', number>>;
  fixedRamGb?: Partial<Record<Fixed, number>>;
  reservedStorage?: number;
  indexFactor?: number;
  /** E113: share of data in LogsDB indices. */
  logsdbShare?: number;
  reservedCpu?: number;
  frozenRamToBlob?: number;
  /** E110: data transfer and storage as a share of the data tiers plus APM. */
  dtsShare?: number;
  /** D51/D56:D58: price the rounded node RAM (true, the sheet's default) or the raw need. */
  useRoundedRam?: boolean;
}

const LABEL: Record<ApmRole, string> = {
  hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen', apm: 'APM Server',
  master: 'Master', coordinating: 'Coordinating', ml: 'Machine learning', kibana: 'Kibana',
};

function extrasOf(data: EchData): EchApmExtras {
  const x = data.extras?.apm as EchApmExtras | undefined;
  if (!x?.ladder?.length) throw new EchUnavailable('The ECH data file has no APM tables. Re-run scripts/ech-import.mjs.');
  return x;
}

function defaultSku(data: EchData, x: EchApmExtras, p: EchPlacement, role: ApmRole): string {
  const d = x.defaults[p.provider]?.[role] ?? (role === 'apm' ? undefined : data.defaults[p.provider]?.[role]);
  if (d) return d;
  const sel = `${role === 'ml' ? 'ML' : role === 'apm' ? 'APM' : role[0]!.toUpperCase() + role.slice(1)}_in_Production`;
  const s = data.skus.find((k) => k.provider === p.provider && k.selection === sel);
  if (!s) throw new EchUnavailable(`No ${role} instance type for ${p.provider}.`);
  return s.id;
}

/**
 * K148: the APM Server size whose throughput (events/s per GB × size) covers the events/s.
 * The sheet tests `previous < events < this` with strict inequalities, so a value exactly on a step matches nothing
 * and the line silently drops out (#N/A). Here a value on a step takes that step.
 */
export function apmServerGb(eventsPerSec: number, ladder: readonly number[], perGb: number): number | undefined {
  if (!(eventsPerSec > 0)) return undefined;
  return ladder.find((gb) => eventsPerSec <= perGb * gb + 1e-9);
}

export function echApm(c: ConstantSet, data: EchData, req: EchApmRequest): EchResult {
  checkPlacement(data, req);
  const x = extrasOf(data);
  const warnings: string[] = placementNotes(c, req);
  const zonesDefault = val<Record<DataTier, number>>(c, 'ech.zones');
  const replicasDefault = val<Record<'hot' | 'warm' | 'cold', number>>(c, 'ech.replicas');
  const fixedDefault = val<Record<Fixed, number>>(c, 'ech.fixed_ram_gb');
  const reserve = req.reservedStorage ?? num(c, 'ech.reserved_storage');
  const idx = req.indexFactor ?? num(c, 'ech.apm.index_factor');
  const share = req.logsdbShare ?? num(c, 'ech.logsdb_share');
  const reductions = val<{ enterprise: number; other: number }>(c, 'ech.apm.logsdb_reduction');
  const red = req.tier === 'Enterprise' ? reductions.enterprise : reductions.other;
  const reservedCpu = req.reservedCpu ?? num(c, 'ech.reserved_cpu_search');
  const rounded = req.useRoundedRam ?? true;
  const days = (t: DataTier) => req.retentionDays[t] ?? 0;
  const zones = (t: DataTier) => req.zones?.[t] ?? zonesDefault[t];
  const reps = (t: 'hot' | 'warm' | 'cold') => req.replicas?.[t] ?? replicasDefault[t];
  const skuId = (r: ApmRole) => req.skus?.[r] ?? defaultSku(data, x, req, r);
  const idxKeys = req.indexFactor === undefined ? ['ech.apm.index_factor'] : [];
  const reserveKeys = req.reservedStorage === undefined ? ['ech.reserved_storage'] : [];

  // APM ingest model (K132:K147).
  const txn = num(c, 'ech.apm.transactions_per_trace');
  const spans = num(c, 'ech.apm.spans_per_transaction');
  const chattySpans = num(c, 'ech.apm.chatty_spans_per_transaction');
  const extraBytes = num(c, 'ech.apm.metrics_errors_bytes_per_trace');
  const txnBytes = req.transactionDocBytes ?? num(c, 'ech.apm.transaction_doc_bytes');
  const spanBytes = req.spanDocBytes ?? num(c, 'ech.apm.span_doc_bytes');
  const chatty = req.chattyShare ?? num(c, 'ech.apm.chatty_share');
  const sampling = req.samplingRate ?? num(c, 'ech.apm.sampling_rate');
  const tpm = req.tracesPerMinute;
  const avgTrace = (txn * txnBytes + txn * spans * spanBytes) * sampling + extraBytes;
  const chattyTrace = (txn * txnBytes + txn * chattySpans * spanBytes) * sampling + extraBytes;
  const avgGb = (avgTrace * tpm * (1 - chatty) * 60 * 24) / 1e9;
  const chattyGb = (chattyTrace * tpm * chatty * 60 * 24) / 1e9;
  const D = avgGb + chattyGb;
  // K147: sampling applies to spans only here, unlike the trace size (K135), which samples transactions too.
  const eps = ((txn + txn * spans * sampling) * (1 - chatty) + (txn + txn * chattySpans * sampling) * chatty) * tpm / 60;
  const ingestKeys = [
    'ech.apm.transactions_per_trace', 'ech.apm.spans_per_transaction', 'ech.apm.chatty_spans_per_transaction', 'ech.apm.metrics_errors_bytes_per_trace',
    ...(req.transactionDocBytes === undefined ? ['ech.apm.transaction_doc_bytes'] : []),
    ...(req.spanDocBytes === undefined ? ['ech.apm.span_doc_bytes'] : []),
    ...(req.chattyShare === undefined ? ['ech.apm.chatty_share'] : []),
    ...(req.samplingRate === undefined ? ['ech.apm.sampling_rate'] : []),
  ];
  const ingestMath: MathStep[] = [
    step('average trace size (bytes)', `(${txn} × ${fmt(txnBytes)} + ${txn} × ${spans} × ${fmt(spanBytes)}) × ${fmt(sampling)} sampling + ${extraBytes}`, avgTrace, ingestKeys),
    step('chatty trace size (bytes)', `(${txn} × ${fmt(txnBytes)} + ${txn} × ${chattySpans} × ${fmt(spanBytes)}) × ${fmt(sampling)} sampling + ${extraBytes}`, chattyTrace, ingestKeys),
    step('ingest per day', `(${fmt(avgTrace)} × (1 − ${fmt(chatty)}) + ${fmt(chattyTrace)} × ${fmt(chatty)}) × ${fmt(tpm, 0)} traces/min × 1,440 / 1e9`, D, []),
  ];

  const oneCopy = (t: DataTier) => D * days(t) * share * (1 - red) + (1 - share) * D * days(t);
  const oneCopyStep = (t: DataTier) => step(`${t} data, one copy`, `${fmt(D)} × ${fmt(days(t))} days × (${fmt(share)} × (1 − ${red}) + ${fmt(1 - share)})`, oneCopy(t),
    [...(share > 0 ? ['ech.apm.logsdb_reduction'] : []), ...(req.logsdbShare === undefined ? ['ech.logsdb_share'] : [])]);

  const lines: EchLine[] = [];
  const priced = (key: ApmRole, id: string, ramGb: number, extra: Partial<EchLine>, math: MathStep[]) => {
    const label = LABEL[key];
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
    // J6 has no retention gate, but hot with 0 days has no price (I56) and J42 drops it; same result.
    if (days(t) <= 0) continue;
    const sku = skuOf(data, skuId(t));
    const z = zones(t);
    const math: MathStep[] = [...ingestMath, oneCopyStep(t)];
    let need: number;
    let constraint: 'disk' | 'cpu' | undefined;
    if (t === 'frozen') {
      // K277:K278: blob = one copy × index factor; RAM = blob / 1,600. No replicas, no reserve.
      const ratio = req.frozenRamToBlob ?? num(c, 'ech.frozen_ram_to_blob');
      const blob = oneCopy(t) * idx;
      need = blob / ratio;
      math.push(
        step('frozen snapshot data', `${fmt(oneCopy(t))} × ${fmt(idx)} index factor`, blob, idxKeys),
        step('frozen RAM needed', `${fmt(blob)} / ${fmt(ratio)}`, need, req.frozenRamToBlob === undefined ? ['ech.frozen_ram_to_blob'] : []),
      );
    } else {
      // K162:K167: replicas, index factor, reserve, then disk / RAM:Disk.
      const r = reps(t);
      const disk = (oneCopy(t) * (1 + r) * idx) / (1 - reserve);
      const diskRam = disk / sku.ramDisk;
      math.push(
        step(`${t} disk needed`, `${fmt(oneCopy(t))} × (1 + ${fmt(r)}) × ${fmt(idx)} / (1 − ${fmt(reserve)})`, disk, [...(req.replicas?.[t] === undefined ? ['ech.replicas'] : []), ...idxKeys, ...reserveKeys]),
        step(`${t} RAM for disk`, `${fmt(disk)} / ${fmt(sku.ramDisk)} (${sku.id} RAM:Disk)`, diskRam, []),
      );
      need = diskRam;
      constraint = 'disk';
      if (t === 'hot') {
        // K159 / K168: ingest / (rate per GB RAM × (1 − reserved CPU)); the LogsDB blend has no ingest impact (M156 = 0).
        const rate = sku.ingestPerGbRamPerDay * (1 - reservedCpu);
        const cpuRam = D / rate;
        math.push(step('hot RAM for ingest', `${fmt(D)} / (${fmt(sku.ingestPerGbRamPerDay)} × (1 − ${fmt(reservedCpu)}))`, cpuRam, req.reservedCpu === undefined ? ['ech.reserved_cpu_search'] : []));
        if (cpuRam > need) { need = cpuRam; constraint = 'cpu'; }
        math.push(step('hot RAM needed', 'max(RAM for disk, RAM for ingest)', need, []));
      }
    }
    const fit = fitToIncrements(need, z, sku.increments);
    math.push(fitStep(`${t} nodes`, need, fit));
    const ram = rounded ? fit.roundedGb : need;
    priced(t, sku.id, ram, { nodesPerZone: fit.nodesPerZone, nodeSizeGb: fit.nodeSizeGb, zones: z, diskGb: ram * sku.ramDisk, ...(constraint ? { constraint } : {}) }, math);
  }

  // APM Server (K148, J29): size from events/s. No zone multiplier (E109 is unused on the sheet).
  const apmId = skuId('apm');
  const second = x.secondLadderSkus.includes(apmId);
  const apmGb = apmServerGb(eps, second ? x.secondLadder : x.ladder, x.eventsPerSecPerGb);
  const apmMath = [
    ...ingestMath,
    step('APM events per second', `((${txn} + ${txn} × ${spans} × ${fmt(sampling)}) × (1 − ${fmt(chatty)}) + (${txn} + ${txn} × ${chattySpans} × ${fmt(sampling)}) × ${fmt(chatty)}) × ${fmt(tpm, 0)} / 60`, eps, ingestKeys),
  ];
  if (apmGb !== undefined) {
    apmMath.push(step('APM Server RAM', `smallest size serving ${fmt(eps, 0)} events/s at ${x.eventsPerSecPerGb} events/s per GB`, apmGb, []));
    priced('apm', apmId, apmGb, {}, apmMath);
  } else if (eps > 0) {
    const msg = `${fmt(eps, 0)} events/s is beyond the largest APM Server size.`;
    warnings.push(`APM Server: ${msg}`);
    lines.push({ key: 'apm', label: LABEL.apm, sku: apmId, annual: 0, annualRounded: 0, math: apmMath, error: msg });
  }

  for (const role of FIXED) {
    const ram = req.fixedRamGb?.[role] ?? fixedDefault[role];
    if (ram <= 0) continue;
    priced(role, skuId(role), ram, {}, [step(`${LABEL[role]} RAM`, `${fmt(ram)} GB, fixed`, ram, req.fixedRamGb?.[role] === undefined ? ['ech.fixed_ram_gb'] : [])]);
  }

  // J18: data transfer and storage = share × (data tiers + APM). The sheet applies it to the already rounded lines;
  // the exact figure applies it to the exact lines (the sheet's own unrounded O18 reads empty cells and shows 0).
  const dtsShare = req.dtsShare ?? num(c, 'ech.apm.dts_share');
  const base = lines.filter((l) => l.key === 'apm' || (DATA_TIERS as string[]).includes(l.key));
  const baseExact = base.reduce((s, l) => s + l.annual, 0);
  const baseRounded = base.reduce((s, l) => s + l.annualRounded, 0);
  const dts = baseExact * dtsShare;
  lines.push({
    key: 'transfer', label: 'Data transfer and storage', annual: dts, annualRounded: roundLine(c, baseRounded * dtsShare),
    math: [step('data transfer and storage per year', `${fmt(dtsShare)} × $${fmt(baseExact)} (data tiers and APM Server)`, dts, req.dtsShare === undefined ? ['ech.apm.dts_share'] : [])],
  });

  if (req.tier === 'Standard') warnings.push('Standard is not offered for annual deals.');
  if ((days('cold') > 0 || days('frozen') > 0) && req.tier !== 'Enterprise') warnings.push('Cold and frozen tiers need the Enterprise subscription.');

  // J44: the APM sheet has no separate storage line (J20 is blank), so year-one spend is the total.
  const total = lines.reduce((s, l) => s + l.annual, 0);
  const totalRounded = lines.reduce((s, l) => s + l.annualRounded, 0);
  return {
    kind: 'apm', dailyGb: D, lines, total, totalRounded, y1Spend: total, y1SpendRounded: totalRounded, warnings, source: data.source,
    facts: [
      { label: 'Average trace size', value: avgTrace, unit: 'bytes' },
      { label: 'Chatty trace size', value: chattyTrace, unit: 'bytes' },
      { label: 'APM events per second', value: eps, unit: 'events/s' },
      ...(apmGb !== undefined ? [{ label: 'APM Server RAM', value: apmGb, unit: 'GB' }] : []),
    ],
  };
}
