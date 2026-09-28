// ECH Ballpark Estimator v4.6, Logs and Metrics sheets, reproduced formula for formula (D40: match the spreadsheet).
// Cell references in comments point at the Logs sheet; Metrics shares the layout.
import { num, val, type ConstantSet } from '@sizing/constants';
import { fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import {
  checkPlacement, defaultSku, dtsPrice, type EchPlacement, EchUnavailable, fitStep, fitToIncrements, monthlyPerGb, roundLine, skuOf,
} from './common.ts';
import type { EchData, EchLine, EchResult, EchRole } from './types.ts';

type DataTier = 'hot' | 'warm' | 'cold' | 'frozen';
type Fixed = 'master' | 'coordinating' | 'ml' | 'kibana';
const DATA_TIERS: DataTier[] = ['hot', 'warm', 'cold', 'frozen'];
const FIXED: Fixed[] = ['master', 'coordinating', 'ml', 'kibana'];

export interface EchObservabilityRequest extends EchPlacement {
  kind: 'logs' | 'metrics';
  /** Logs: GB ingested per day (E16). */
  gbPerDay?: number;
  /** Metrics: datapoints per second (E16). */
  datapointsPerSecond?: number;
  retentionDays: Partial<Record<DataTier, number>>;
  /** Instance type per role (E24:E34); blank uses the spreadsheet's default for the provider. */
  skus?: Partial<Record<EchRole, string>>;
  zones?: Partial<Record<DataTier, number>>;
  replicas?: Partial<Record<'hot' | 'warm' | 'cold', number>>;
  /** Master, coordinating, ML and Kibana RAM in GB (E35:E38); always billed. 0 leaves the line out. */
  fixedRamGb?: Partial<Record<Fixed, number>>;
  reservedStorage?: number;
  indexFactor?: number;
  /** Logs only (E113). */
  logsdbShare?: number;
  reservedCpu?: number;
  frozenRamToBlob?: number;
  /** D51/D56:D58: price the rounded node RAM (true, the sheet's default) or the raw need. */
  useRoundedRam?: boolean;
}

const TIER_LABEL: Record<DataTier | Fixed, string> = {
  hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen', master: 'Master', coordinating: 'Coordinating', ml: 'Machine learning', kibana: 'Kibana',
};

export function echObservability(c: ConstantSet, data: EchData, req: EchObservabilityRequest): EchResult {
  checkPlacement(data, req);
  const logs = req.kind === 'logs';
  const warnings: string[] = [];
  const zonesDefault = val<Record<DataTier, number>>(c, 'ech.zones');
  const replicasDefault = val<Record<'hot' | 'warm' | 'cold', number>>(c, 'ech.replicas');
  const fixedDefault = val<Record<Fixed, number>>(c, 'ech.fixed_ram_gb');
  const reserve = req.reservedStorage ?? num(c, 'ech.reserved_storage');
  const idx = req.indexFactor ?? val<Record<'logs' | 'metrics', number>>(c, 'ech.index_factor')[req.kind];
  const share = logs ? (req.logsdbShare ?? num(c, 'ech.logsdb_share')) : 0;
  const red = num(c, 'ech.logsdb_reduction');
  const reservedCpu = req.reservedCpu ?? num(c, 'ech.reserved_cpu_search');
  const rounded = req.useRoundedRam ?? true;
  const days = (t: DataTier) => req.retentionDays[t] ?? 0;
  const zones = (t: DataTier) => req.zones?.[t] ?? zonesDefault[t];
  const reps = (t: 'hot' | 'warm' | 'cold') => req.replicas?.[t] ?? replicasDefault[t];
  const skuId = (r: EchRole) => req.skus?.[r] ?? defaultSku(data, req, r);

  // Daily volume (K152 / Metrics K137).
  const bytes = num(c, 'ech.metrics_bytes_per_sample');
  const dps = req.datapointsPerSecond ?? 0;
  const D = logs ? (req.gbPerDay ?? 0) : (dps * bytes * 86_400) / 1e9;
  const dailyStep = logs
    ? step('ingest per day', `${fmt(D)} GB/day`, D, [])
    : step('ingest per day', `${fmt(dps, 0)} datapoints/s × ${bytes} bytes × 86,400 / 1e9`, D, ['ech.metrics_bytes_per_sample']);

  /** One copy of a tier's data (K163): LogsDB share shrinks by the reduction; TSDS share (E112) is always 0. */
  const oneCopy = (t: DataTier) => (logs ? D * days(t) * share * (1 - red) + (1 - share) * D * days(t) : D * days(t));
  const oneCopyStep = (t: DataTier) => (logs
    ? step(`${t} data, one copy`, `${fmt(D)} × ${fmt(days(t))} days × (${fmt(share)} × (1 − ${red}) + ${fmt(1 - share)})`, oneCopy(t), share > 0 ? ['ech.logsdb_reduction', 'ech.logsdb_share'] : ['ech.logsdb_share'])
    : step(`${t} data, one copy`, `${fmt(D)} × ${fmt(days(t))} days`, oneCopy(t), []));
  const reserveKeys = req.reservedStorage === undefined ? ['ech.reserved_storage'] : [];
  const idxKeys = req.indexFactor === undefined ? ['ech.index_factor'] : [];

  const lines: EchLine[] = [];
  const priced = (key: EchLine['key'], label: string, skuIdValue: string, ramGb: number, extra: Partial<EchLine>, math: MathStep[]) => {
    try {
      const sku = skuOf(data, skuIdValue);
      const price = monthlyPerGb(c, data, sku, req);
      const annual = price.value * ramGb * 12;
      lines.push({
        key, label, sku: sku.id, ramGb, monthlyPerGb: price.value, annual, annualRounded: roundLine(c, annual), ...extra,
        math: [...math, price.math, step(`${label} per year`, `$${fmt(price.value)} × ${fmt(ramGb)} GB × 12`, annual, [])],
      });
    } catch (e) {
      if (!(e instanceof EchUnavailable)) throw e;
      warnings.push(`${label}: ${e.message} The spreadsheet shows #NA and leaves this line out of the total.`);
      lines.push({ key, label, sku: skuIdValue, ramGb, annual: 0, annualRounded: 0, math, error: e.message, ...extra });
    }
  };

  for (const t of DATA_TIERS) {
    if (days(t) <= 0) continue;
    const sku = skuOf(data, skuId(t));
    const z = zones(t);
    const math: MathStep[] = [dailyStep, oneCopyStep(t)];
    let need: number;
    let constraint: 'disk' | 'cpu' | undefined;
    if (t === 'frozen') {
      // K279:K280: blob = one copy × index factor; RAM = blob / 1,600.
      const ratio = req.frozenRamToBlob ?? num(c, 'ech.frozen_ram_to_blob');
      const blob = oneCopy(t) * idx;
      need = blob / ratio;
      math.push(
        step('frozen snapshot data', `${fmt(oneCopy(t))} × ${fmt(idx)} index factor`, blob, idxKeys),
        step('frozen RAM needed', `${fmt(blob)} / ${fmt(ratio)}`, need, req.frozenRamToBlob === undefined ? ['ech.frozen_ram_to_blob'] : []),
      );
    } else {
      // K164:K169: replicas, index factor, reserve, then disk / RAM:Disk.
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
        let cpuRam: number;
        if (logs) {
          // K161 / K170: ingest / (rate per GB RAM × (1 − reserved CPU)).
          const rate = sku.ingestPerGbRamPerDay * (1 - reservedCpu);
          cpuRam = D / rate;
          math.push(step('hot RAM for ingest', `${fmt(D)} / (${fmt(sku.ingestPerGbRamPerDay)} × (1 − ${fmt(reservedCpu)}))`, cpuRam, req.reservedCpu === undefined ? ['ech.reserved_cpu_search'] : []));
        } else {
          // Metrics K138:K142: nodes = (dps × copies / EPS per node)^(1/0.85); RAM = nodes × RAM per node.
          const bench = data.metricsBenchmark.find((b) => b.sku === sku.id);
          if (!bench) throw new EchUnavailable(`No metrics ingest benchmark for ${sku.id}.`);
          const exp = num(c, 'ech.metrics_scaling_exponent');
          const nodes = ((dps * (1 + r)) / bench.eps) ** (1 / exp);
          cpuRam = nodes * bench.ramGb;
          math.push(
            step('hot nodes for ingest', `(${fmt(dps, 0)} × (1 + ${fmt(r)}) / ${fmt(bench.eps, 0)} per node)^(1/${exp})`, nodes, ['ech.metrics_scaling_exponent']),
            step('hot RAM for ingest', `${fmt(nodes, 4)} × ${fmt(bench.ramGb)} GB`, cpuRam, []),
          );
        }
        if (cpuRam > need) { need = cpuRam; constraint = 'cpu'; }
        math.push(step('hot RAM needed', `max(RAM for disk, RAM for ingest)`, need, []));
      }
    }
    const fit = fitToIncrements(need, z, sku.increments);
    math.push(fitStep(`${t} nodes`, need, fit));
    const ram = rounded ? fit.roundedGb : need;
    priced(t, TIER_LABEL[t], sku.id, ram, {
      nodesPerZone: fit.nodesPerZone, nodeSizeGb: fit.nodeSizeGb, zones: z, diskGb: ram * sku.ramDisk, ...(constraint ? { constraint } : {}),
    }, math);
  }

  for (const role of FIXED) {
    const ram = req.fixedRamGb?.[role] ?? fixedDefault[role];
    if (ram <= 0) continue;
    priced(role, TIER_LABEL[role], skuId(role), ram, {}, [step(`${TIER_LABEL[role]} RAM`, `${fmt(ram)} GB, fixed`, ram, req.fixedRamGb?.[role] === undefined ? ['ech.fixed_ram_gb'] : [])]);
  }

  // Data transfer and storage (rows 86:98), monthly then × 12.
  const rawToJson = num(c, 'ech.raw_to_json');
  const n2n = num(c, 'ech.node_to_node_compression');
  const dataIn = (D * rawToJson * 365) / 12;
  const coordToHot = dataIn * (1 - n2n);
  const hotToHot = dataIn * reps('hot') * (1 - n2n);
  // J91: the sheet multiplies by the LogsDB reduction (0.54) where the stored share (0.46) belongs; kept to match.
  const hotToBlob = logs ? (dataIn / rawToJson) * idx * red * share + (dataIn / rawToJson) * idx * (1 - share) : (dataIn / rawToJson) * idx;
  const interNodeGb = coordToHot + hotToHot + hotToBlob;
  const snapshotGb = logs ? DATA_TIERS.reduce((s, t) => s + oneCopy(t), 0) * idx : D * idx * DATA_TIERS.reduce((s, t) => s + days(t), 0);
  const dataOutGb = snapshotGb * num(c, 'ech.data_out_share');
  const apiCalls = num(c, 'ech.storage_api_calls_per_hour') * num(c, 'ech.hours_per_month');
  const pInter = dtsPrice(data, req, 'Data inter-node', logs);
  const pOut = dtsPrice(data, req, 'Data out', logs);
  const pSnap = dtsPrice(data, req, 'Snapshot storage', logs);
  const pApi = dtsPrice(data, req, 'Storage api', logs);
  const transfer = (interNodeGb * pInter + dataOutGb * pOut) * 12;
  const storage = (snapshotGb * pSnap + apiCalls * pApi) * 12;
  lines.push({
    key: 'transfer', label: 'Data transfer', annual: transfer, annualRounded: roundLine(c, transfer),
    math: [
      step('data in per month (JSON)', `${fmt(D)} × ${rawToJson} × 365 / 12`, dataIn, ['ech.raw_to_json']),
      step('between nodes per month', `coordinating→hot ${fmt(coordToHot)} + replication ${fmt(hotToHot)} + hot→snapshot ${fmt(hotToBlob)}`, interNodeGb, ['ech.node_to_node_compression', ...(logs ? ['ech.logsdb_reduction'] : []), ...idxKeys]),
      step('data out per month', `${fmt(snapshotGb)} GB snapshots × ${num(c, 'ech.data_out_share')}`, dataOutGb, ['ech.data_out_share']),
      step('data transfer per year', `(${fmt(interNodeGb)} × $${pInter} + ${fmt(dataOutGb)} × $${pOut}) × 12`, transfer, []),
    ],
  });
  lines.push({
    key: 'storage', label: 'Snapshot storage and API calls', annual: storage, annualRounded: roundLine(c, storage),
    math: [
      step('snapshot storage', logs ? `Σ tier data one copy × ${fmt(idx)}` : `${fmt(D)} × ${fmt(idx)} × total days`, snapshotGb, idxKeys),
      step('storage API calls per month (thousands)', `${num(c, 'ech.storage_api_calls_per_hour')} × ${num(c, 'ech.hours_per_month')}`, apiCalls, ['ech.storage_api_calls_per_hour', 'ech.hours_per_month']),
      step('storage per year', `(${fmt(snapshotGb)} × $${pSnap} + ${fmt(apiCalls)} × $${pApi}) × 12`, storage, []),
    ],
  });

  // Totals and year-one spend (J42, J44): snapshot storage ramps in over the retention period.
  const total = lines.reduce((s, l) => s + l.annual, 0);
  const totalRounded = lines.reduce((s, l) => s + l.annualRounded, 0);
  const f = DATA_TIERS.reduce((s, t) => s + days(t), 0) / 365;
  const y1 = (T: number, S: number) => (f > 1 ? T - S / 2 : T - S + (S / 2) * f + S * (1 - f));

  if (req.tier === 'Standard') warnings.push('Standard is not offered for annual deals.');
  if ((days('cold') > 0 || days('frozen') > 0) && req.tier !== 'Enterprise') warnings.push('Cold and frozen tiers need the Enterprise subscription.');

  return {
    kind: req.kind, dailyGb: D, lines, total, totalRounded,
    y1Spend: y1(total, storage), y1SpendRounded: y1(totalRounded, roundLine(c, storage)),
    warnings, source: data.source,
  };
}
