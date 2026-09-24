import { num, val, type ConstantSet, type FleetRow, type MasterSizingRow } from '@sizing/constants';
import { ceilEps, fmt, step } from './math.ts';
import { heapGb } from './profiles.ts';
import type { MathStep, OverheadResult, WorkloadProfile } from './types.ts';

export function fleetTable(c: ConstantSet): FleetRow[] {
  return val<FleetRow[]>(c, 'fleet.table');
}

/** Smallest table row that covers `agents`, or the last row when agents exceed the table. */
export function fleetRowFor(c: ConstantSet, agents: number): FleetRow {
  const rows = fleetTable(c);
  return rows.find((r) => r.agents >= agents) ?? rows[rows.length - 1]!;
}

/** Largest row whose Fleet Server memory fits `fleetMemGb` (SPEC §5.3 max_agents). */
export function fleetRowForMemory(c: ConstantSet, fleetMemGb: number): FleetRow | undefined {
  return [...fleetTable(c)].reverse().find((r) => r.fleetMemGb <= fleetMemGb);
}

interface OverheadInput {
  dataNodes: number;
  indices: number;
  profiles: readonly WorkloadProfile[];
  coordinatingNodes: number;
}

function group(role: OverheadResult['role'], count: number, ramGb: number, vcpu: number, counts: boolean, math: MathStep[]): OverheadResult {
  return { role, count, ramGb, diskGb: 0, diskType: 'ssd', vcpu, countsTowardLicense: counts, math };
}

/** SPEC §5.2 overhead nodes (per site). */
export function computeOverhead(c: ConstantSet, input: OverheadInput): OverheadResult[] {
  const out: OverheadResult[] = [];
  const counted = val<Record<string, boolean>>(c, 'eru.counted_components');
  const vcpuPerGb = num(c, 'vcpu_per_ram_gb');

  // Masters: row by data-node count, bumped until heap covers indices (1 GB heap per 3,000 indices).
  const rows = val<MasterSizingRow[]>(c, 'masters.sizing');
  let i = rows.reduce((acc, r, idx) => (r.minDataNodes <= input.dataNodes ? idx : acc), 0);
  const perGb = num(c, 'master_indices_per_gb_heap');
  const requiredHeap = input.indices / perGb;
  const math: MathStep[] = [
    step('data nodes (all data tiers, D4)', `${input.dataNodes}`, input.dataNodes, []),
    step('dedicated master row', `row with min data nodes ≤ ${input.dataNodes}`, rows[i]!.ramGb, ['masters.sizing']),
    step('master heap required', `${fmt(input.indices, 0)} indices / ${perGb}`, requiredHeap, ['master_indices_per_gb_heap']),
  ];
  if (rows[i]!.count > 0) {
    while (heapGb(c, rows[i]!.ramGb) < requiredHeap && i < rows.length - 1) {
      i++;
      math.push(step('master row bumped for index count', `heap ${fmt(heapGb(c, rows[i - 1]!.ramGb))} GB < ${fmt(requiredHeap)} GB`, rows[i]!.ramGb, ['heap_fraction', 'heap_cap_gb']));
    }
    const r = rows[i]!;
    out.push(group('master', r.count, r.ramGb, r.ramGb * vcpuPerGb, counted.elasticsearch ?? true, math));
  }

  const kibanaHa = input.dataNodes >= num(c, 'kibana.ha_min_data_nodes');
  const kibanaCount = kibanaHa ? num(c, 'kibana.ha_count') : 1;
  const kibanaRam = num(c, 'kibana.node_ram_gb');
  out.push(group('kibana', kibanaCount, kibanaRam, kibanaRam * vcpuPerGb, counted.kibana ?? true, [
    step('Kibana instances', `${input.dataNodes} data nodes ${kibanaHa ? '≥' : '<'} ${num(c, 'kibana.ha_min_data_nodes')} → ${kibanaCount}`, kibanaCount, ['kibana.ha_min_data_nodes', 'kibana.ha_count']),
    step('Kibana RAM per instance', `${kibanaRam}`, kibanaRam, ['kibana.node_ram_gb']),
  ]));

  if (input.coordinatingNodes > 0) {
    const ram = num(c, 'coordinating.node_ram_gb');
    out.push(group('coordinating', input.coordinatingNodes, ram, ram * vcpuPerGb, counted.elasticsearch ?? true, [
      step('coordinating nodes (requested, D5)', `${input.coordinatingNodes} × ${ram} GB`, input.coordinatingNodes * ram, ['coordinating.node_ram_gb']),
    ]));
  }

  if (input.profiles.some((p) => p.kind === 'apm')) {
    const n = num(c, 'apm.count');
    const ram = num(c, 'apm.node_ram_gb');
    out.push(group('apm', n, ram, ram * vcpuPerGb, counted.apm ?? true, [
      step('APM Server', `${n} × ${ram} GB`, n * ram, ['apm.count', 'apm.node_ram_gb']),
    ]));
  }

  const jobs = input.profiles.reduce((s, p) => s + (p.ml?.anomalyJobs ?? 0), 0);
  const modelsGb = input.profiles.reduce((s, p) => s + (p.ml?.trainedModelsGb ?? 0), 0);
  if (jobs > 0 || modelsGb > 0) {
    const ram = num(c, 'ml.node_ram_gb');
    const perNode = num(c, 'ml.jobs_per_node');
    const byJobs = ceilEps(jobs / perNode);
    const nativeGb = ram - heapGb(c, ram);
    const byModels = ceilEps(modelsGb / nativeGb);
    const failover = num(c, 'failover_nodes_per_tier');
    const count = Math.max(byJobs, byModels) + failover;
    out.push(group('ml', count, ram, ram * vcpuPerGb, counted.elasticsearch ?? true, [
      step('ML nodes for jobs', `ROUNDUP(${jobs} / ${perNode})`, byJobs, ['ml.jobs_per_node']),
      step('ML nodes for trained models', `ROUNDUP(${fmt(modelsGb)} GB / ${fmt(nativeGb)} GB native memory)`, byModels, ['ml.node_ram_gb', 'heap_fraction', 'heap_cap_gb']),
      step('ML nodes', `max(${byJobs}, ${byModels}) + ${failover} failover (D6)`, count, ['failover_nodes_per_tier']),
    ]));
  }

  const agents = input.profiles.reduce((s, p) => s + (p.fleet?.agents ?? 0), 0);
  if (agents > 0) {
    const row = fleetRowFor(c, agents);
    const needed = agents > row.agents ? ceilEps(agents / row.agents) : 1;
    const extra = num(c, 'fleet.redundancy_nodes');
    out.push(group('fleet', needed + extra, row.fleetMemGb, row.fleetVcpu, counted.fleet ?? false, [
      step('Fleet table row', `first row with agents ≥ ${fmt(agents, 0)} → ${fmt(row.agents, 0)} agents @ ${row.fleetMemGb} GB`, row.fleetMemGb, ['fleet.table']),
      step('Fleet Servers', `${needed} + ${extra} redundancy (D7)`, needed + extra, ['fleet.redundancy_nodes']),
    ]));
  }
  return out;
}
