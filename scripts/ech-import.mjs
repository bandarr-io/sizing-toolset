#!/usr/bin/env node
// Convert the internal "Elastic Cloud Hosted Ballpark Estimator" spreadsheet into the local ECH data file.
// The output holds internal pricing and is git-ignored (D40): never commit it.
//
//   node scripts/ech-import.mjs "<path to .xlsx>" [output]
//
// Default output: apps/web/public/ech-data.local.json (served to the web app in development).
// The workbook is a Google Sheets export, so formulas cannot recalculate; this reads the saved values.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [file, out = 'apps/web/public/ech-data.local.json'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/ech-import.mjs "<path to ECH Ballpark Estimator .xlsx>" [output.json]');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheet = (name) => {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`sheet "${name}" not found`);
  return ws;
};
/** The saved value of a cell: formula results, rich text and hyperlinks flattened. */
const val = (ws, addr) => {
  const v = ws.getCell(addr).value;
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result === null ? undefined : v.result;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return undefined;
  }
  return v;
};
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)) ? Number(x) : undefined);
const str = (x) => (x === undefined ? undefined : String(x).trim());

// Specs!A2:Q157 (SpecsConfigTable) and Specs!A165:B1042 (SpecsIncrements).
const specs = sheet('Specs');
const increments = new Map();
for (let r = 165; r <= 1042; r++) {
  const id = str(val(specs, `A${r}`));
  const gb = num(val(specs, `B${r}`));
  if (!id || gb === undefined) continue;
  increments.set(id, [...(increments.get(id) ?? []), gb]);
}
const skus = [];
for (let r = 2; r <= 157; r++) {
  const id = str(val(specs, `A${r}`));
  const provider = str(val(specs, `B${r}`))?.toLowerCase();
  if (!id || !['aws', 'gcp', 'azure'].includes(provider)) continue;
  skus.push({
    id, provider,
    type: str(val(specs, `C${r}`)) ?? '',
    sellableRamGb: num(val(specs, `D${r}`)) ?? 0,
    vcpu: num(val(specs, `E${r}`)) ?? 0,
    ramDisk: num(val(specs, `F${r}`)) ?? 0,
    excludedRegions: str(val(specs, `I${r}`)) ?? '',
    ingestPerGbRamPerDay: num(val(specs, `J${r}`)) ?? 0,
    status: str(val(specs, `O${r}`)),
    selection: str(val(specs, `Q${r}`)),
    increments: [...new Set(increments.get(id) ?? [])].sort((a, b) => a - b),
  });
}

// CloudPricingv5!A2:H10193: provider, SKU, region, tier, direct, AWS MP, GCP MP, Azure MP ($/GB RAM/hour).
const pricing = sheet('CloudPricingv5');
const prices = {};
for (let r = 2; r <= pricing.rowCount; r++) {
  const sku = str(val(pricing, `B${r}`));
  const region = str(val(pricing, `C${r}`));
  const tier = str(val(pricing, `D${r}`));
  if (!sku || !region || !tier) continue;
  const p = {};
  for (const [col, k] of [['E', 'direct'], ['F', 'awsMp'], ['G', 'gcpMp'], ['H', 'azureMp']]) {
    const v = num(val(pricing, `${col}${r}`));
    if (v !== undefined) p[k] = v;
  }
  prices[`${sku}|${region}|${tier}`] = p;
}

// Ref: regions B54:E148, channel tiers B18:D38, DTS B157:E180.
const ref = sheet('Ref');
const regions = [];
for (let r = 54; r <= 148; r++) {
  const provider = str(val(ref, `C${r}`))?.toLowerCase();
  const name = str(val(ref, `D${r}`));
  if (!provider || !name) continue;
  regions.push({ provider, name, status: str(val(ref, `E${r}`)) ?? '' });
}
const channelTiers = [];
for (let r = 18; r <= 38; r++) {
  const channel = str(val(ref, `B${r}`));
  const tier = str(val(ref, `C${r}`));
  const provider = str(val(ref, `D${r}`));
  if (channel && tier && provider) channelTiers.push({ channel, tier, provider: provider.toLowerCase() });
}
const dts = [];
for (let r = 157; r <= 180; r++) {
  const provider = str(val(ref, `B${r}`));
  const item = str(val(ref, `C${r}`));
  const channel = str(val(ref, `D${r}`));
  const price = num(val(ref, `E${r}`));
  if (provider && item && channel && price !== undefined) dts.push({ provider: provider.toLowerCase(), item, channel, price });
}

// Metrics!H321:K350: hot-tier ingest benchmark.
const metrics = sheet('Metrics');
const metricsBenchmark = [];
for (let r = 321; r <= 350; r++) {
  const sku = str(val(metrics, `H${r}`));
  const eps = num(val(metrics, `I${r}`));
  if (!sku || eps === undefined) continue;
  metricsBenchmark.push({ sku, eps, vcpu: num(val(metrics, `J${r}`)) ?? 0, ramGb: num(val(metrics, `K${r}`)) ?? 0 });
}

// Region-specific transfer prices hardcoded in Logs!I73:I74 (FedRAMP High), read from the formula text.
const logs = sheet('Logs');
const dtsOverrides = [];
for (const [addr, item] of [['I73', 'Data out'], ['I74', 'Snapshot storage']]) {
  const f = logs.getCell(addr).formula ?? '';
  const m = f.match(/\$E\$5=""(\w+)"",\s*\$E\$6=""([^"]+)""\),\s*([0-9.]+)/);
  if (m) dtsOverrides.push({ provider: m[1].toLowerCase(), region: m[2], item, price: Number(m[3]) });
}

// Default instance per role for AWS: the Logs sheet's selections (Logs!E24:E34).
const defaults = { aws: {} };
for (const [addr, role] of [['E24', 'hot'], ['E25', 'warm'], ['E26', 'cold'], ['E27', 'frozen'], ['E31', 'master'], ['E32', 'coordinating'], ['E33', 'ml'], ['E34', 'kibana']]) {
  const id = str(val(logs, addr));
  if (id) defaults.aws[role] = id;
}

const version = basename(file).match(/v(\d+(?:\.\d+)*)/i)?.[1] ?? 'unknown';
const data = {
  source: { file: basename(file), version, extractedAt: new Date().toISOString() },
  skus, prices, regions, channelTiers, dts, dtsOverrides, metricsBenchmark, defaults,
};
writeFileSync(resolve(out), JSON.stringify(data));
console.log(`ECH data v${version}: ${skus.length} instance types, ${Object.keys(prices).length} prices, ${regions.length} regions, ${dts.length} transfer prices (${dtsOverrides.length} region overrides), ${metricsBenchmark.length} benchmark rows → ${out}`);
