import {
  EuiBadge, EuiButtonEmpty, EuiButtonGroup, EuiButtonIcon, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiHorizontalRule, EuiIcon,
  EuiInlineEditText, EuiPanel, EuiSpacer, EuiText, EuiToolTip,
} from '@elastic/eui';
import { num, val, type FleetRow } from '@sizing/constants';
import {
  defaultIndexMode, vectorCost, type IndexMode, type Quant, type Solve, type Tier, type WorkloadKind, type WorkloadProfile,
} from '@sizing/engine';
import { useState, type ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import { useConstants } from '../constantsStore.tsx';
import { fmtCompact, fmtNum } from '../format.ts';
import { KINDS, newWorkload } from '../state.ts';
import { TIER_LABEL } from '../ui/tiers.ts';
import { RetentionTimeline } from './RetentionTimeline.tsx';

const QUANTS: { value: Quant; text: string }[] = [
  { value: 'bbq', text: 'BBQ (HNSW), smallest in memory' },
  { value: 'bbq_disk', text: 'DiskBBQ (Low confidence)' },
  { value: 'int8', text: 'int8' },
  { value: 'int4', text: 'int4' },
  { value: 'bfloat16', text: 'bfloat16' },
  { value: 'float32', text: 'float32 (no quantization)' },
];

/** What the card is being used for. Reverse targets hide the quantity that is the answer. */
export type CardRole = { kind: 'forward' } | { kind: 'reverse-target'; solve: Solve; targetTier: Tier; onTargetTier: (t: Tier) => void } | { kind: 'reverse-other' };

function Hint({ children }: { children: ReactNode }) {
  return <EuiText size="xs" color="subdued" style={{ marginTop: 4 }}><p>{children}</p></EuiText>;
}

function MoreOptions({ children, count }: { children: ReactNode; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EuiButtonEmpty size="xs" flush="left" iconType={open ? 'chevronSingleDown' : 'chevronSingleRight'} onClick={() => setOpen(!open)}>
        {open ? 'Fewer options' : 'More options'}{count > 0 && !open ? ` (${count} set)` : ''}
      </EuiButtonEmpty>
      {open && <><EuiSpacer size="m" />{children}</>}
    </>
  );
}

export function summarize(p: WorkloadProfile): string {
  if (p.kind === 'search') return `${fmtNum(p.totalGb ?? 0)} GB corpus`;
  if (p.kind === 'vector' && p.vector) return `${fmtCompact(p.vector.count)} × ${p.vector.dims}-d ${p.vector.quant}`;
  if (p.kind === 'ml' && p.ml) return `${p.ml.anomalyJobs} jobs`;
  if (p.kind === 'fleet' && p.fleet) return `${fmtNum(p.fleet.agents, 0)} agents`;
  const days = Object.values(p.retentionDays).reduce<number>((s, d) => s + (d ?? 0), 0);
  return `${p.rawGbPerDay !== undefined ? `${fmtNum(p.rawGbPerDay)} GB/day` : 'GB/day solved'} · ${days} days`;
}

export function WorkloadCard({ p, onChange, onRemove, role, kindChoices }: {
  p: WorkloadProfile;
  onChange: (p: WorkloadProfile) => void;
  onRemove?: () => void;
  role: CardRole;
  /** Reverse targets may switch kind among these. */
  kindChoices?: WorkloadKind[];
}) {
  const { set: c } = useConstants();
  const meta = KINDS[p.kind];
  const set = (patch: Partial<WorkloadProfile>) => onChange({ ...p, ...patch });
  const solve = role.kind === 'reverse-target' ? role.solve : undefined;
  const placement = p.tier ?? 'content';

  // One replica control for the common case; per-tier values stay available under More options.
  const replicaTiers: Tier[] = meta.stream ? ['hot', 'warm'] : [placement];
  const replicas = p.replicas[replicaTiers[0]!] ?? 1;
  const setReplicas = (n: number) => set({ replicas: { ...p.replicas, ...Object.fromEntries(replicaTiers.map((t) => [t, n])) } });

  const mode = p.indexMode ?? defaultIndexMode(p);
  const ratio = p.indexRatioOverride ?? num(c, `index_ratio.${mode}`);

  const header = (
    <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
      <EuiFlexItem grow={false}><EuiIcon type={meta.icon} size="xl" /></EuiFlexItem>
      <EuiFlexItem style={{ minWidth: 0 }}>
        <EuiInlineEditText
          key={p.id}
          inputAriaLabel="Workload name" size="m" defaultValue={p.id}
          onSave={(v) => { if (v.trim()) set({ id: v.trim() }); return true; }}
        />
        <EuiText size="xs" color="subdued">{meta.label} · {meta.blurb}</EuiText>
      </EuiFlexItem>
      {kindChoices && kindChoices.length > 1 && (
        <EuiFlexItem grow={false}>
          <SelectField label={null} value={p.kind} options={kindChoices.map((k) => ({ value: k, text: KINDS[k].label }))}
            onChange={(k) => onChange({ ...newWorkload(k), id: p.id, retentionDays: p.retentionDays, replicas: p.replicas, ...(p.rawGbPerDay !== undefined ? { rawGbPerDay: p.rawGbPerDay } : {}) })} compressed />
        </EuiFlexItem>
      )}
      {onRemove && (
        <EuiFlexItem grow={false}>
          <EuiToolTip content="Remove workload"><EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${p.id}`} onClick={onRemove} /></EuiToolTip>
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );

  let body: ReactNode = null;
  let advanced: ReactNode = null;
  let advancedCount = 0;

  if (meta.stream) {
    const solvingGb = solve === 'max_gb_day';
    const needsVolume = solve !== 'max_shards';
    const indexed = p.rawGbPerDay !== undefined ? p.rawGbPerDay * ratio : undefined;
    body = (
      <>
        <EuiFlexGroup gutterSize="l" wrap>
          {needsVolume && (
            <EuiFlexItem style={{ flexBasis: 200, minWidth: 180 }}>
              {solvingGb
                ? <EuiFormRow label="Daily ingest"><EuiPanel paddingSize="s" color="primary" hasShadow={false}><EuiText size="s"><strong>Solving for this</strong></EuiText></EuiPanel></EuiFormRow>
                : <NumField label="Daily ingest (raw)" append="GB/day" value={p.rawGbPerDay} onChange={(v) => set({ rawGbPerDay: v ?? 0 })}
                    helpText={indexed !== undefined ? `≈ ${fmtNum(indexed)} GB/day indexed` : undefined} />}
            </EuiFlexItem>
          )}
          {needsVolume && (
            <EuiFlexItem style={{ flexBasis: 280, minWidth: 270 }}>
              <EuiFormRow label="Index mode" helpText={p.indexRatioOverride !== undefined ? `Ratio overridden to ${p.indexRatioOverride}` : `Indexed size = raw × ${ratio}`}>
                <EuiButtonGroup legend="Index mode" isFullWidth idSelected={mode} onChange={(id) => set({ indexMode: id as IndexMode })}
                  options={(['standard', 'logsdb', 'tsds'] as IndexMode[]).map((m) => ({ id: m, label: m === 'standard' ? 'Standard' : m === 'logsdb' ? 'LogsDB' : 'TSDS' }))} />
              </EuiFormRow>
            </EuiFlexItem>
          )}
          <EuiFlexItem grow={false} style={{ width: 110 }}>
            <NumField label={<EuiToolTip content="Applies to hot and warm. Cold and frozen never carry replicas."><span>Replicas <EuiIcon type="question" size="s" /></span></EuiToolTip>}
              aria-label="Replicas" value={replicas} step={1} onChange={(v) => setReplicas(v ?? 0)} />
          </EuiFlexItem>
          {solve === 'max_shards' && (
            <EuiFlexItem style={{ flexBasis: 160, minWidth: 140 }}>
              <NumField label="Rollover" append="days" value={p.rolloverDays} optional placeholder="1" onChange={(v) => set({ rolloverDays: v })} />
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
        <EuiSpacer size="l" />
        <RetentionTimeline
          value={p.retentionDays} onChange={(retentionDays) => set({ retentionDays })}
          {...(solve === 'max_retention' && role.kind === 'reverse-target' ? { solving: role.targetTier, onSolvingChange: role.onTargetTier } : {})}
        />
      </>
    );
    const downsampleTiers = (['warm', 'cold', 'frozen'] as Tier[]).filter((t) => (p.retentionDays[t] ?? 0) > 0);
    advancedCount = [p.indexRatioOverride, p.growthPctPerYear, p.avgEventKb, p.rolloverDays, p.primaryShards, p.ingestPipelines || undefined,
      ...downsampleTiers.map((t) => p.downsampleFactor?.[t])].filter((x) => x !== undefined).length;
    advanced = (
      <>
        <EuiFlexGrid columns={3} gutterSize="l">
          <EuiFlexItem><NumField label="Index ratio override" value={p.indexRatioOverride} optional placeholder={String(num(c, `index_ratio.${mode}`))} onChange={(v) => set({ indexRatioOverride: v })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Growth" append="% / year" value={p.growthPctPerYear} optional placeholder="0" onChange={(v) => set({ growthPctPerYear: v })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Average event size" append="KB" value={p.avgEventKb} optional placeholder={String(num(c, 'ingest.default_avg_event_kb'))} onChange={(v) => set({ avgEventKb: v })} /></EuiFlexItem>
          {solve !== 'max_shards' && <EuiFlexItem><NumField label="Rollover" append="days" value={p.rolloverDays} optional placeholder="1" onChange={(v) => set({ rolloverDays: v })} /></EuiFlexItem>}
          <EuiFlexItem><NumField label="Primary shards" value={p.primaryShards} optional step={1} placeholder="1" onChange={(v) => set({ primaryShards: v })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Warm replicas" value={p.replicas.warm} optional step={1} placeholder={String(replicas)} onChange={(v) => set({ replicas: { ...p.replicas, warm: v } })} /></EuiFlexItem>
          {downsampleTiers.map((t) => (
            <EuiFlexItem key={t}>
              <NumField label={`${TIER_LABEL[t]} downsample factor`} value={p.downsampleFactor?.[t]} optional placeholder="1" helpText="Share of data kept after downsampling"
                onChange={(v) => { const d = { ...(p.downsampleFactor ?? {}) }; if (v === undefined) delete d[t]; else d[t] = v; set({ downsampleFactor: d }); }} />
            </EuiFlexItem>
          ))}
        </EuiFlexGrid>
        <SwitchField label="Ingest pipelines" helpText="Processing in ingest pipelines can make indexing up to 50% slower." checked={p.ingestPipelines ?? false} onChange={(v) => set({ ingestPipelines: v })} />
      </>
    );
  }

  if (p.kind === 'search') {
    body = (
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><NumField label="Corpus size (indexed)" append="GB" value={p.totalGb} onChange={(v) => set({ totalGb: v ?? 0 })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Replicas" value={replicas} step={1} onChange={(v) => setReplicas(v ?? 0)} /></EuiFlexItem>
      </EuiFlexGrid>
    );
    advancedCount = [p.indexRatioOverride, p.growthPctPerYear, p.primaryShards, p.tier].filter((x) => x !== undefined).length;
    advanced = (
      <EuiFlexGrid columns={3} gutterSize="l">
        <EuiFlexItem><SelectField label="Tier" value={placement} options={[{ value: 'content', text: 'Content' }, { value: 'hot', text: 'Hot' }]} onChange={(t) => set({ tier: t })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Index ratio" value={p.indexRatioOverride} optional placeholder={String(num(c, 'index_ratio.standard'))} onChange={(v) => set({ indexRatioOverride: v })} helpText="1.0 when the size above is already indexed" /></EuiFlexItem>
        <EuiFlexItem><NumField label="Growth" append="% / year" value={p.growthPctPerYear} optional placeholder="0" onChange={(v) => set({ growthPctPerYear: v })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Primary shards" value={p.primaryShards} optional step={1} placeholder="auto" onChange={(v) => set({ primaryShards: v })} /></EuiFlexItem>
      </EuiFlexGrid>
    );
  }

  if (p.kind === 'vector' && p.vector) {
    const v = p.vector;
    const cost = vectorCost(c, v.dims, v.quant, v.hnswM);
    const copies = replicas + 1;
    const solvingCount = solve === 'max_vectors';
    body = (
      <>
        <EuiFlexGrid columns={2} gutterSize="l">
          <EuiFlexItem>
            {solvingCount
              ? <EuiFormRow label="Vectors"><EuiPanel paddingSize="s" color="primary" hasShadow={false}><EuiText size="s"><strong>Solving for this</strong></EuiText></EuiPanel></EuiFormRow>
              : <NumField label="Vectors" value={v.count} step={1} onChange={(n) => set({ vector: { ...v, count: n ?? 0 } })} helpText={fmtCompact(v.count)} />}
          </EuiFlexItem>
          <EuiFlexItem><NumField label="Dimensions" value={v.dims} step={1} onChange={(n) => set({ vector: { ...v, dims: n ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SelectField label="Quantization" value={v.quant} options={QUANTS} onChange={(quant) => set({ vector: { ...v, quant } })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Replicas" value={replicas} step={1} onChange={(n) => setReplicas(n ?? 0)} /></EuiFlexItem>
        </EuiFlexGrid>
        <EuiSpacer size="m" />
        <EuiPanel color="subdued" paddingSize="s" hasShadow={false}>
          <EuiText size="xs">
            <strong>{fmtNum(cost.offheapBytes, 1)} bytes</strong> per vector in memory
            {!solvingCount && <> · <strong>{fmtNum((v.count * cost.offheapBytes * copies) / 1e9, 1)} GB</strong> off-heap with {copies} cop{copies === 1 ? 'y' : 'ies'}</>}
            {' '}· {fmtNum(cost.diskBytes, 0)} bytes per vector on disk
          </EuiText>
        </EuiPanel>
      </>
    );
    advancedCount = [v.hnswM, p.tier, p.growthPctPerYear].filter((x) => x !== undefined).length;
    advanced = (
      <EuiFlexGrid columns={3} gutterSize="l">
        <EuiFlexItem>
          <NumField label="HNSW m" value={v.hnswM} optional step={1} placeholder={String(num(c, 'knn.hnsw_m'))} onChange={(n) => {
            const { hnswM: _drop, ...rest } = v; set({ vector: n === undefined ? rest : { ...rest, hnswM: n } });
          }} />
        </EuiFlexItem>
        <EuiFlexItem><SelectField label="Tier" value={placement} options={[{ value: 'content', text: 'Content' }, { value: 'hot', text: 'Hot' }]} onChange={(t) => set({ tier: t })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Growth" append="% / year" value={p.growthPctPerYear} optional placeholder="0" onChange={(n) => set({ growthPctPerYear: n })} /></EuiFlexItem>
      </EuiFlexGrid>
    );
  }

  if (p.kind === 'ml' && p.ml) {
    const ml = p.ml;
    body = (
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><NumField label="Anomaly detection jobs" value={ml.anomalyJobs} step={1} onChange={(n) => set({ ml: { ...ml, anomalyJobs: n ?? 0 } })}
          helpText={`${num(c, 'ml.jobs_per_node')} jobs per ${num(c, 'ml.node_ram_gb')} GB ML node (Low confidence)`} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Trained models" append="GB" value={ml.trainedModelsGb} optional placeholder="0" onChange={(n) => set({ ml: { ...ml, trainedModelsGb: n } })} /></EuiFlexItem>
      </EuiFlexGrid>
    );
  }

  if (p.kind === 'fleet' && p.fleet) {
    const f = p.fleet;
    const rows = val<FleetRow[]>(c, 'fleet.table');
    const row = rows.find((r) => r.agents >= f.agents) ?? rows[rows.length - 1]!;
    body = (
      <>
        <EuiFlexGrid columns={2} gutterSize="l">
          <EuiFlexItem><NumField label="Elastic Agents" value={f.agents} step={1} onChange={(n) => set({ fleet: { ...f, agents: n ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SwitchField label="Elastic Defend" checked={f.defend} onChange={(defend) => set({ fleet: { ...f, defend } })} helpText="Recorded for the scenario; the Fleet table does not change with Defend." /></EuiFlexItem>
        </EuiFlexGrid>
        <Hint>Fleet table row: up to {fmtNum(row.agents, 0)} agents on a {row.fleetMemGb} GB Fleet Server. Hot tier needs at least {row.hotRamGb} GB RAM and {row.hotVcpu} vCPU.</Hint>
      </>
    );
  }

  return (
    <EuiPanel hasBorder paddingSize="l">
      {header}
      <EuiHorizontalRule margin="m" />
      {body}
      {advanced && (
        <>
          <EuiSpacer size="m" />
          <MoreOptions count={advancedCount}>{advanced}</MoreOptions>
        </>
      )}
    </EuiPanel>
  );
}

export function KindBadge({ kind }: { kind: WorkloadKind }) {
  return <EuiBadge iconType={KINDS[kind].icon} color="hollow">{KINDS[kind].label}</EuiBadge>;
}
