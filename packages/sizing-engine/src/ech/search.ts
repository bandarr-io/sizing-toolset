// ECH Ballpark Estimator v4.6: Search and "Vector Search & BBQ" sheets, reproduced formula for formula (D40).
// Search_Aux_Calculator is left out: it feeds no other cell. The Disk BBQ QPS estimate is left out: it changes
// neither RAM nor price.
import { num, val, type ConstantSet } from '@sizing/constants';
import { ceilEps, fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import {
  availableIn, channelSells, checkPlacement, type EchPlacement, EchUnavailable, monthlyPerGb, placementNotes, pricedLine, roundLine, skuOf,
} from './common.ts';
import type { EchData, EchLine, EchResult, EchSku } from './types.ts';

type Fixed = 'master' | 'coordinating' | 'ml' | 'kibana';
const FIXED: Fixed[] = ['master', 'coordinating', 'ml', 'kibana'];
const FIXED_LABEL: Record<Fixed, string> = { master: 'Master', coordinating: 'Coordinating', ml: 'Machine learning', kibana: 'Kibana' };
const FIXED_SELECTION: Record<Fixed, string> = { master: 'Master_in_Production', coordinating: 'Coordinating_in_Production', ml: 'ML_in_Production', kibana: 'Kibana_in_Production' };

/** The first instance of the provider offered for a role (Specs col Q), in the sheet's order. */
function firstWithSelection(data: EchData, p: EchPlacement, selection: string): string {
  const s = data.skus.find((x) => x.provider === p.provider && x.selection === selection);
  if (!s) throw new EchUnavailable(`No ${selection.replace('_in_Production', '').toLowerCase()} instance type for ${p.provider}.`);
  return s.id;
}

const isVectorProfile = (s: EchSku) => (s.status ?? '').toLowerCase() === 'vector search';

function totals(lines: EchLine[]): { total: number; totalRounded: number } {
  return { total: lines.reduce((s, l) => s + l.annual, 0), totalRounded: lines.reduce((s, l) => s + l.annualRounded, 0) };
}

// ---- Search ------------------------------------------------------------------------------------------

export type EchSearchUseCase = 'Custom Search' | 'Ingest';

export interface EchSearchRequest extends EchPlacement {
  /** E26: Custom Search (no Enterprise Search nodes) or Ingest (crawler and connector nodes). */
  useCase?: EchSearchUseCase;
  /** E27 */
  documents: number;
  /** E28, KB before indexing. */
  avgDocKb: number;
  /** E29: peak query plus ingest operations per second. */
  peakOpsPerSecond: number;
  /** E11, E12, E16:E19; blank uses the provider's first instance for the role. */
  skus?: { data?: string; enterpriseSearch?: string } & Partial<Record<Fixed, string>>;
  /** E13 */
  zones?: number;
  /** E69 */
  replicas?: number;
  /** E70 */
  reservedStorage?: number;
  /** E75 */
  queryMs?: number;
  /** E20:E23, GB; always billed. 0 leaves the line out. */
  fixedRamGb?: Partial<Record<Fixed, number>>;
  /** E84 */
  dtsShare?: number;
  /** D41: price rounded data node RAM (true, the sheet's default) or the raw need. */
  useRoundedRam?: boolean;
  /** D42: the same for Enterprise Search nodes. */
  roundEnterpriseSearch?: boolean;
}

export function echSearch(c: ConstantSet, data: EchData, req: EchSearchRequest): EchResult {
  checkPlacement(data, req);
  const warnings: string[] = placementNotes(c, req);
  const useCase = req.useCase ?? 'Custom Search';
  const uc = val<Record<EchSearchUseCase, { ops: number; storage: number; enterpriseSearchRatio: number }>>(c, 'ech.search.use_cases')[useCase];
  const zones = req.zones ?? num(c, 'ech.search.zones');
  const replicas = req.replicas ?? num(c, 'ech.search.replicas');
  const reserve = req.reservedStorage ?? num(c, 'ech.search.reserved_storage');
  const queryMs = req.queryMs ?? num(c, 'ech.search.query_ms');
  const tp = val<{ factor: number; extra: number }>(c, 'ech.search.threadpool');
  const dataId = req.skus?.data ?? firstWithSelection(data, req, 'Hot_in_Production');
  const sku = skuOf(data, dataId);

  // CPU (K101:K103): busy threads = ms × ops/s / 1000; vCPU = threads / threads per vCPU.
  const ops = req.peakOpsPerSecond * uc.ops;
  const threads = (queryMs * ops) / 1000;
  const threadsPerVcpu = (Math.floor(sku.vcpu * tp.factor) + tp.extra) / sku.vcpu;
  const vcpu = threads / threadsPerVcpu;
  // Storage (K106:K111): catalog → storage modifier → reserve → replicas → per zone.
  const catalogGb = (req.documents * req.avgDocKb) / 1e6;
  const withReserve = (catalogGb * uc.storage) / (1 - reserve);
  const withReplicas = withReserve * (1 + replicas);
  const perZone = withReplicas / zones;
  // RAM (K113:K118): CPU uses vCPU per GB of the instance (Specs col G); storage uses RAM:Disk.
  const vcpuPerGb = sku.vcpu / sku.sellableRamGb;
  const cpuTotal = vcpu / vcpuPerGb;
  const storageTotal = (perZone / sku.ramDisk) * zones;
  const needTotal = Math.max(cpuTotal, storageTotal);
  // Node size (K120:K125): smallest increment holding the per-zone need, else the largest; whole nodes per zone.
  const incs = sku.increments;
  const perZoneNeed = needTotal / zones;
  const nodeSize = incs.find((h) => perZoneNeed <= h + 1e-9) ?? incs[incs.length - 1]!;
  const nodesPerZone = ceilEps(needTotal / (nodeSize * zones));
  const roundedRam = nodesPerZone * zones * nodeSize;
  const dataRam = (req.useRoundedRam ?? true) ? roundedRam : needTotal;

  const lines: EchLine[] = [];
  const reserveKeys = req.reservedStorage === undefined ? ['ech.search.reserved_storage'] : [];
  lines.push(pricedLine(c, data, req, warnings, 'hot', 'Data', dataId, dataRam, {
    nodesPerZone, nodeSizeGb: nodeSize, zones, diskGb: dataRam * sku.ramDisk, constraint: cpuTotal > storageTotal ? 'cpu' : 'disk',
  }, [
    step('busy search threads', `${fmt(queryMs)} ms × ${fmt(ops)} ops/s / 1000`, threads, [...(req.queryMs === undefined ? ['ech.search.query_ms'] : []), 'ech.search.use_cases']),
    step('vCPU needed', `${fmt(threads)} / ${fmt(threadsPerVcpu, 4)} threads per vCPU (${sku.id})`, vcpu, ['ech.search.threadpool']),
    step('RAM for CPU', `${fmt(vcpu)} / ${fmt(vcpuPerGb, 4)} vCPU per GB`, cpuTotal, []),
    step('catalog size', `${fmt(req.documents, 0)} docs × ${fmt(req.avgDocKb)} KB / 1e6`, catalogGb, []),
    step('storage with reserve and replicas', `${fmt(catalogGb)} × ${fmt(uc.storage)} / (1 − ${fmt(reserve)}) × (1 + ${fmt(replicas)})`, withReplicas, [...reserveKeys, ...(req.replicas === undefined ? ['ech.search.replicas'] : [])]),
    step('RAM for storage', `${fmt(withReplicas)} / ${fmt(sku.ramDisk)} RAM:Disk`, storageTotal, []),
    step('data nodes', `max(${fmt(cpuTotal)}, ${fmt(storageTotal)}) GB / ${zones} zones → ${nodesPerZone} × ${fmt(nodeSize)} GB per zone × ${zones}`, roundedRam, req.zones === undefined ? ['ech.search.zones'] : []),
  ]));

  // Enterprise Search (K140:K153): data RAM × ratio, sized on its own increments; Ingest clamps to 2 to 8 GB.
  const ratio = uc.enterpriseSearchRatio;
  if (ratio > 0) {
    const esId = req.skus?.enterpriseSearch ?? firstWithSelection(data, req, 'Enterprisesearch_in_Production');
    const esSku = skuOf(data, esId);
    const esRaw = needTotal * ratio;
    const esPerZone = perZoneNeed * ratio;
    const esIncs = esSku.increments;
    const esSize = esIncs.find((h) => esPerZone <= h + 1e-9) ?? esIncs[esIncs.length - 1]!;
    // K149 divides the rounded data RAM × ratio (K125 × E80), not the raw need.
    const esNodesPerZone = ceilEps((dataRam * ratio) / (esSize * zones));
    const esRounded = esSize * esNodesPerZone * zones;
    const lim = val<{ min: number; max: number }>(c, 'ech.search.enterprise_search_ram_gb');
    const pick = (req.roundEnterpriseSearch ?? true) ? esRounded : esRaw;
    const esRam = useCase === 'Custom Search' ? pick : Math.max(lim.min, Math.min(pick, lim.max));
    lines.push(pricedLine(c, data, req, warnings, 'enterprisesearch', 'Enterprise Search', esId, esRam, { nodesPerZone: esNodesPerZone, nodeSizeGb: esSize, zones }, [
      step('Enterprise Search RAM', `data RAM × ${ratio}, ${esNodesPerZone} × ${fmt(esSize)} GB per zone × ${zones}${useCase === 'Ingest' ? `, kept within ${lim.min} to ${lim.max} GB` : ''}`, esRam, ['ech.search.use_cases', 'ech.search.enterprise_search_ram_gb']),
    ]));
  }

  // DTS (J8): a share of the data and Enterprise Search lines; the rounded total uses the rounded lines.
  const share = req.dtsShare ?? num(c, 'ech.search.dts_share');
  const base = lines.reduce((s, l) => s + l.annual, 0);
  const baseRounded = lines.reduce((s, l) => s + l.annualRounded, 0);
  lines.push({
    key: 'transfer', label: 'Data transfer and storage', annual: share * base, annualRounded: roundLine(c, share * baseRounded),
    math: [step('data transfer and storage per year', `${fmt(share)} × $${fmt(base)} data and Enterprise Search`, share * base, req.dtsShare === undefined ? ['ech.search.dts_share'] : [])],
  });

  const fixedDefault = val<Record<Fixed, number>>(c, 'ech.fixed_ram_gb');
  for (const role of FIXED) {
    const ram = req.fixedRamGb?.[role] ?? fixedDefault[role];
    if (ram <= 0) continue;
    const id = req.skus?.[role] ?? firstWithSelection(data, req, FIXED_SELECTION[role]);
    lines.push(pricedLine(c, data, req, warnings, role, FIXED_LABEL[role], id, ram, {}, [
      step(`${FIXED_LABEL[role]} RAM`, `${fmt(ram)} GB, fixed`, ram, req.fixedRamGb?.[role] === undefined ? ['ech.fixed_ram_gb'] : []),
    ]));
  }

  if (req.tier === 'Standard') warnings.push('Standard is not offered for annual deals.');
  const { total, totalRounded } = totals(lines);
  // E71: the input panel's disk figure multiplies by (1 + reserve) where sizing divides by (1 − reserve).
  const shownDisk = Math.ceil(catalogGb * uc.storage - 1e-9) * (1 + replicas) * (1 + reserve);
  return {
    kind: 'search', dailyGb: 0, lines, total, totalRounded, y1Spend: total, y1SpendRounded: totalRounded, warnings, source: data.source,
    facts: [
      { label: 'vCPU needed', value: vcpu, unit: 'vCPU' },
      { label: 'Disk storage required (as the sheet shows it)', value: shownDisk, unit: 'GB' },
      { label: 'Data node storage', value: (dataRam * sku.ramDisk) / 1000, unit: 'TB' },
    ],
  };
}

// ---- Vector search -----------------------------------------------------------------------------------

export type EchVectorMethod = 'float32' | 'int8' | 'bbq' | 'disk_bbq';

export interface EchVectorRequest extends EchPlacement {
  method: EchVectorMethod;
  documents: number;
  vectorsPerDoc: number;
  dims: number;
  /** D14 / K13 / R13; blank uses the provider's first vector-profile instance. */
  sku?: string;
  zones?: number;
  replicas?: number;
  /**
   * The Vector Search block's instance (D14). The sheet builds the small rows of its vector-profile RAM table
   * from this instance's node sizes even when BBQ or Disk BBQ selects another. Blank = `sku` when it is a
   * vector-profile instance, else the provider's first one.
   */
  vectorTableSku?: string;
}

interface RamRow { ram: number; offheap: number }

/** Deployment RAM tables (J131:L705, N131:P705, S151:U725, W151:Y725): total RAM → off-heap. */
function ramTable(c: ConstantSet, kind: 'vector' | 'gcp' | 'generic', vectorSku: EchSku): RamRow[] {
  const t = val<{ steps: number[]; gcpSteps: number[]; rows: number }>(c, 'ech.vector.ram_table');
  const per60 = val<{ vector: number; generic: number; base: number }>(c, 'ech.vector.offheap_per_60gb');
  const rows: RamRow[] = [];
  if (kind === 'vector') {
    const small = val<number[]>(c, 'ech.vector.small_node_offheap_gb');
    vectorSku.increments.slice(0, small.length).forEach((ram, i) => rows.push({ ram, offheap: small[i]! }));
    const share = per60.vector / per60.base;
    for (let i = 0; i < t.rows - small.length; i++) { const ram = t.steps.at(-1)! * (i + 2); rows.push({ ram, offheap: ram * share }); }
  } else {
    const steps = kind === 'gcp' ? t.gcpSteps : t.steps;
    const share = per60.generic / per60.base;
    for (const ram of steps) rows.push({ ram, offheap: ram * share });
    for (let i = 0; i < t.rows - steps.length; i++) { const ram = steps.at(-1)! * (i + 2); rows.push({ ram, offheap: ram * share }); }
  }
  return rows;
}

/** MIN(FILTER(RAM, test)): the smallest row passing, or an error past the table. */
function smallest(rows: RamRow[], test: (r: RamRow) => boolean, what: string): number {
  const r = rows.filter(test).reduce<number | undefined>((m, x) => (m === undefined || x.ram < m ? x.ram : m), undefined);
  if (r === undefined) throw new EchUnavailable(`${what} is larger than the sheet's RAM table.`);
  return r;
}

/** Specs col P: offered in the BBQ calculators (vector-profile, or CPU optimized without a `*` variant). */
const bbqSelectable = (s: EchSku) => isVectorProfile(s) || ((s.status ?? '').toLowerCase() === 'cpu optimized' && !s.type.includes('*'));

export function echVector(c: ConstantSet, data: EchData, req: EchVectorRequest): EchResult {
  checkPlacement(data, req);
  const warnings: string[] = placementNotes(c, req);
  const method = req.method;
  const key = method === 'float32' || method === 'int8' ? 'hnsw' : method;
  const zones = req.zones ?? val<Record<'hnsw' | 'bbq' | 'disk_bbq', number>>(c, 'ech.vector.zones')[key];
  const replicas = req.replicas ?? num(c, 'ech.vector.replicas');
  const firstVector = () => {
    const s = data.skus.find((x) => x.provider === req.provider && isVectorProfile(x));
    if (!s) throw new EchUnavailable(`No vector-profile instance type for ${req.provider}.`);
    return s.id;
  };
  const skuId = req.sku ?? firstVector();
  const sku = skuOf(data, skuId);
  const tableSku = skuOf(data, req.vectorTableSku ?? (isVectorProfile(sku) ? sku.id : firstVector()));
  const vectors = req.documents * req.vectorsPerDoc;
  const d = req.dims;
  const vectorsStep = step('vectors', `${fmt(req.documents, 0)} docs × ${fmt(req.vectorsPerDoc)}`, vectors, []);
  const zoneKeys = req.zones === undefined ? ['ech.vector.zones'] : [];
  const repKeys = req.replicas === undefined ? ['ech.vector.replicas'] : [];

  let ram: number;
  const extra: Partial<EchLine> = { zones };
  const math: MathStep[] = [vectorsStep];
  const facts: { label: string; value: number; unit: string }[] = [];
  const available = availableIn(sku, req.region);
  if (!available) warnings.push(`${sku.id} is not offered in ${req.region}.`);

  if (method === 'float32' || method === 'int8') {
    // D31:D44 and rows 58:100: all vectors off-heap; node count by off-heap per node.
    const b = val<Record<'float32' | 'int8', { perDim: number; extraDims: number }>>(c, 'ech.vector.hnsw_bytes')[method];
    const gb = ceilEps((vectors * b.perDim * (d + b.extraDims)) / 1e9);
    const heap = val<number[]>(c, 'ech.vector.small_node_heap_gb');
    // C104:E111: the first seven sizes of the vector instance (D14), off-heap = size − heap by position.
    const table = tableSku.increments.slice(0, heap.length).map((ram, i) => ({ ram, offheap: ram - heap[i]! }));
    const incs = sku.increments;
    const maxInc = Math.max(...incs);
    const perZone = gb / zones;
    // E70:E78: the first increment whose off-heap holds the per-zone GB; the last row (largest) always fits.
    const fit = incs.map((h) => ({ h, off: table.find((r) => r.ram === h)?.offheap })).find((x) => x.off !== undefined && perZone <= x.off + 1e-9);
    const nodeSize = fit?.h ?? maxInc;
    const nodeOff = fit?.off ?? table.find((r) => r.ram === maxInc)?.offheap;
    if (nodeOff === undefined) throw new EchUnavailable(`${sku.id} has no off-heap figure for ${maxInc} GB nodes.`);
    // D64: SPREADSHEET BUG kept for parity: divides the TOTAL GB (not per zone) by off-heap, then D66 multiplies
    // by the zones again, so zones are counted twice (hidden by the default of 1 zone).
    const nodesPerZone = ceilEps(gb / nodeOff);
    const perReplica = nodesPerZone * zones * nodeSize;
    ram = perReplica * (1 + replicas);
    Object.assign(extra, { nodesPerZone: nodesPerZone * (1 + replicas), nodeSizeGb: nodeSize });
    math.push(
      step(`${method} vector memory`, `ROUNDUP(${fmt(vectors, 0)} × ${b.perDim} × (${d} + ${b.extraDims}) / 1e9)`, gb, ['ech.vector.hnsw_bytes']),
      step('nodes', `ROUNDUP(${fmt(gb)} GB / ${fmt(nodeOff)} GB off-heap per ${fmt(nodeSize)} GB node) × ${zones} zones (the sheet counts zones twice here)`, nodesPerZone * zones, ['ech.vector.small_node_heap_gb', ...zoneKeys]),
      step('RAM with replicas', `${fmt(perReplica)} × (1 + ${fmt(replicas)})`, ram, repKeys),
    );
    facts.push({ label: 'Vector memory', value: gb, unit: 'GB' });
  } else {
    // Candidates (K51:N51, R58:U58): the first four BBQ-selectable instances of the provider.
    const candidates = data.skus.filter((x) => x.provider === req.provider && bbqSelectable(x)).slice(0, 4);
    const index = candidates.findIndex((x) => x.id === sku.id);
    if (index < 0) throw new EchUnavailable(`${sku.id} is not one of the ${method === 'bbq' ? 'BBQ' : 'Disk BBQ'} calculator's instance types (${candidates.map((x) => x.id).join(', ')}).`);
    const size = (s: EchSku, i: number) => (method === 'bbq' ? bbqSize(c, s, tableSku, vectors, d, zones, replicas) : diskBbqSize(c, req, s, i, tableSku, vectors, d, zones, replicas));
    const chosen = size(sku, index);
    ram = chosen.ram;
    math.push(...chosen.math);
    facts.push(...chosen.facts);
    if (chosen.nodes !== undefined) Object.assign(extra, { nodesPerZone: chosen.nodes / zones, nodeSizeGb: ram / chosen.nodes });
    // K63:K65 / R71:R73: cheapest available candidate, as the sheet's INFO message.
    let best: { id: string; annual: number } | undefined;
    candidates.forEach((cand, i) => {
      try {
        if (method === 'disk_bbq' && !availableIn(cand, req.region)) return;
        const r = size(cand, i);
        const annual = roundLine(c, monthlyPerGb(c, data, cand, req).value * r.ram * 12);
        if (!best || annual < best.annual) best = { id: cand.id, annual };
      } catch (e) {
        if (!(e instanceof EchUnavailable)) throw e;
      }
    });
    if (best && best.id !== sku.id) {
      try {
        const mine = roundLine(c, monthlyPerGb(c, data, sku, req).value * ram * 12);
        if (best.annual < mine) warnings.push(`${best.id} would be cheaper for this configuration, saving about $${fmt(mine - best.annual, 0)} a year.`);
      } catch (e) {
        if (!(e instanceof EchUnavailable)) throw e;
      }
    }
  }

  const line = pricedLine(c, data, req, warnings, 'hot', 'Vector data nodes', sku.id, ram, extra, math);
  const { total, totalRounded } = totals([line]);
  return { kind: 'vector', dailyGb: 0, lines: [line], total, totalRounded, y1Spend: total, y1SpendRounded: totalRounded, warnings, source: data.source, facts };
}

interface Sized { ram: number; nodes?: number; math: MathStep[]; facts: { label: string; value: number; unit: string }[] }

/** BBQ block (K31:K57) for one instance. */
function bbqSize(c: ConstantSet, s: EchSku, tableSku: EchSku, vectors: number, d: number, zones: number, replicas: number): Sized {
  const b = val<{ bitsPerDim: number; overhead: number; hnswLinkBytes: number; hnswM: number }>(c, 'ech.vector.bbq_bytes');
  const rawGb = (vectors * d * 4) / 1e9;
  const bbqGb = (vectors * ((d * b.bitsPerDim) / 8 + b.overhead)) / 1e9;
  const graphGb = (b.hnswLinkBytes * b.hnswM * vectors) / 1e9;
  const diskGb = ceilEps(rawGb + bbqGb + graphGb);
  const offGb = ceilEps(bbqGb + graphGb);
  const rows = ramTable(c, isVectorProfile(s) ? 'vector' : 'generic', tableSku);
  const forOff = smallest(rows, (r) => r.offheap > offGb, 'Off-heap need');
  const forDisk = smallest(rows, (r) => r.ram > diskGb / s.ramDisk, 'Disk need');
  const need = Math.max(forOff, forDisk) * (1 + replicas);
  const ram = smallest(rows, (r) => r.ram >= need / zones - 1e-9, 'RAM need') * zones;
  return {
    ram,
    math: [
      step('BBQ vectors', `${fmt(vectors, 0)} × (${d}/8 + ${b.overhead}) / 1e9`, bbqGb, ['ech.vector.bbq_bytes']),
      step('HNSW graph', `${b.hnswLinkBytes} × ${b.hnswM} × ${fmt(vectors, 0)} / 1e9`, graphGb, ['ech.vector.bbq_bytes']),
      step('disk needed', `ROUNDUP(${fmt(rawGb)} raw + ${fmt(bbqGb)} + ${fmt(graphGb)})`, diskGb, []),
      step('off-heap needed', `ROUNDUP(${fmt(bbqGb)} + ${fmt(graphGb)})`, offGb, []),
      step(`RAM (${isVectorProfile(s) ? 'vector-profile' : 'generic'} table)`, `max(${fmt(forOff)} for off-heap, ${fmt(forDisk)} for disk) × (1 + ${fmt(replicas)}), rounded per zone × ${zones}`, ram, ['ech.vector.offheap_per_60gb', 'ech.vector.ram_table', ...(isVectorProfile(s) ? ['ech.vector.small_node_offheap_gb'] : [])]),
    ],
    facts: [{ label: 'Off-heap needed', value: offGb, unit: 'GB' }, { label: 'Disk needed', value: diskGb, unit: 'GB' }],
  };
}

/** Disk BBQ block (R31:R88) for the candidate in column `index` (0 = R, 1 = S, 2 = T, 3 = U). */
function diskBbqSize(
  c: ConstantSet, req: EchPlacement, s: EchSku, index: number, tableSku: EchSku,
  vectors: number, d: number, zones: number, replicas: number,
): Sized {
  const m = val<{ vectorsPerCentroid: number; centroidExtraDims: number; quantizedCopies: number; quantizedExtraBytes: number; offheapMinShare: number; offheapMaxShare: number }>(c, 'ech.vector.disk_bbq');
  const centroids = (vectors / m.vectorsPerCentroid) * (d + m.centroidExtraDims);
  const quantized = vectors * m.quantizedCopies * (d / 8 + m.quantizedExtraBytes);
  const raw = vectors * d * 4;
  const diskGb = (centroids + quantized + raw) / 1e9;
  const offMin = ceilEps((centroids + quantized * m.offheapMinShare) / 1e9);
  const offMax = ceilEps(((centroids + quantized) / 1e9) * m.offheapMaxShare);
  const gcp = req.provider === 'gcp';
  // SPREADSHEET BUG kept for parity: R60:U65 and R88:U88 test the provider with a column-relative reference
  // (R9, S9, T9, U9); only column R reads the real provider, so the 2nd to 4th candidates use the AWS/Azure table.
  const relGcp = gcp && index === 0;
  const tableFor = (vectorTest: boolean) => ramTable(c, vectorTest ? 'vector' : relGcp ? 'gcp' : 'generic', tableSku);
  const vector = isVectorProfile(s);
  const forDisk = smallest(tableFor(vector), (r) => r.ram > diskGb / s.ramDisk, 'Disk need');
  // SPREADSHEET BUG kept for parity: R61:U62 test R58 (the instance name) = "Vector" instead of R59, so the
  // off-heap rows always come from the generic tables.
  const forMin = smallest(tableFor(false), (r) => r.offheap >= offMin - 1e-9, 'Off-heap need');
  const forMax = smallest(tableFor(false), (r) => r.offheap >= offMax - 1e-9, 'Off-heap need');
  const maxNeed = Math.max(forDisk, forMin, forMax) * (1 + replicas);
  const ram = smallest(tableFor(vector), (r) => r.ram >= maxNeed / zones - 1e-9, 'RAM need') * zones;
  const minNeed = Math.max(forDisk, forMin) * (1 + replicas);
  const minRam = smallest(tableFor(vector), (r) => r.ram >= minNeed / zones - 1e-9, 'RAM need') * zones;
  // R75: node count uses the absolute provider test (64 GB nodes on GCP, 60 GB elsewhere).
  const nodeGb = gcp ? 64 : 60;
  const nodes = ceilEps(ram / nodeGb / zones) * zones;
  return {
    ram, nodes,
    math: [
      step('Disk BBQ disk needed', `centroids ${fmt(centroids / 1e9)} + quantized ${fmt(quantized / 1e9)} + raw ${fmt(raw / 1e9)} GB`, diskGb, ['ech.vector.disk_bbq']),
      step('off-heap range', `ROUNDUP(${fmt(centroids / 1e9)} + ${m.offheapMinShare} × ${fmt(quantized / 1e9)}) to ROUNDUP(${m.offheapMaxShare} × ${fmt((centroids + quantized) / 1e9)})`, offMax, ['ech.vector.disk_bbq']),
      step('RAM for the upper off-heap estimate', `max(${fmt(forDisk)} disk, ${fmt(forMin)}, ${fmt(forMax)} off-heap) × (1 + ${fmt(replicas)}), rounded per zone × ${zones}`, ram, ['ech.vector.offheap_per_60gb', 'ech.vector.ram_table']),
      step('nodes', `ROUNDUP(${fmt(ram)} / ${nodeGb} / ${zones}) × ${zones}`, nodes, []),
    ],
    facts: [
      { label: 'Disk needed', value: diskGb, unit: 'GB' },
      { label: 'Off-heap needed, low estimate', value: offMin, unit: 'GB' },
      { label: 'Off-heap needed, high estimate', value: offMax, unit: 'GB' },
      { label: 'RAM at the low estimate', value: minRam, unit: 'GB' },
      { label: 'Nodes', value: nodes, unit: 'nodes' },
    ],
  };
}

/** The instance the Search sheet uses for a role when none is chosen (for the instance pickers). */
export function searchDefaultSku(data: EchData, p: EchPlacement, role: 'data' | 'enterpriseSearch' | Fixed): string {
  if (role === 'data') return firstWithSelection(data, p, 'Hot_in_Production');
  if (role === 'enterpriseSearch') return firstWithSelection(data, p, 'Enterprisesearch_in_Production');
  return firstWithSelection(data, p, FIXED_SELECTION[role]);
}

/** The instance the Vector sheet uses when none is chosen: the provider's first vector-profile instance. */
export function vectorDefaultSku(data: EchData, p: EchPlacement): string {
  const s = data.skus.find((x) => x.provider === p.provider && isVectorProfile(x));
  if (!s) throw new EchUnavailable(`No vector-profile instance type for ${p.provider}.`);
  return s.id;
}
