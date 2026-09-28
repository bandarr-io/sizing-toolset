import {
  EuiBadge, EuiButtonEmpty, EuiButtonGroup, EuiButtonIcon, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiHorizontalRule, EuiIcon,
  EuiInlineEditText, EuiPanel, EuiSpacer, EuiText, EuiToolTip,
} from '@elastic/eui';
import { num, val, type FleetRow } from '@sizing/constants';
import {
  defaultIndexMode, downsampleProblem, vectorCost, type IndexMode, type Quant, type Solve, type Tier, type WorkloadKind, type WorkloadProfile,
} from '@sizing/engine';
import { useEffect, useState, type ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import { useConstants } from '../constantsStore.tsx';
import { fmtCompact, fmtNum } from '../format.ts';
import { KINDS, newWorkload, withIndexMode } from '../state.ts';
import { TIER_LABEL } from '../ui/tiers.ts';
import { RetentionTimeline } from './RetentionTimeline.tsx';

const QUANTS: { value: Quant; text: string }[] = [
  { value: 'bbq', text: 'BBQ: smallest in memory' },
  { value: 'bbq_disk', text: 'DiskBBQ: mostly on disk (rough estimate)' },
  { value: 'int8', text: 'int8: 4× smaller' },
  { value: 'int4', text: 'int4: 8× smaller' },
  { value: 'bfloat16', text: 'bfloat16: 2× smaller' },
  { value: 'float32', text: 'float32: full size, no compression' },
];

/** What the card is being used for. Reverse targets hide the quantity that is the answer. */
export type CardRole = { kind: 'forward' } | { kind: 'reverse-target'; solve: Solve; targetTier: Tier; onTargetTier: (t: Tier) => void };

function Hint({ children }: { children: ReactNode }) {
  return <EuiText size="xs" color="subdued" style={{ marginTop: 4 }}><p>{children}</p></EuiText>;
}

function MoreOptions({ children, count, hasError = false }: { children: ReactNode; count: number; hasError?: boolean }) {
  // Open on its own when a hidden field is invalid, so the error is never out of sight.
  const [open, setOpen] = useState(hasError);
  useEffect(() => { if (hasError) setOpen(true); }, [hasError]);
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
  if (p.kind === 'search') return `${fmtNum(p.totalGb ?? 0)} GB of documents`;
  if (p.kind === 'vector' && p.vector) return `${fmtCompact(p.vector.count)} vectors, ${p.vector.dims} dimensions, ${p.vector.quant}`;
  if (p.kind === 'ml' && p.ml) return `${p.ml.anomalyJobs} machine learning jobs`;
  if (p.kind === 'fleet' && p.fleet) return `${fmtNum(p.fleet.agents, 0)} agents`;
  const days = Object.values(p.retentionDays).reduce<number>((s, d) => s + (d ?? 0), 0);
  return `${p.rawGbPerDay !== undefined ? `${fmtNum(p.rawGbPerDay)} GB/day` : 'GB/day is the answer'} · ${days} days`;
}

export function WorkloadCard({ p, onChange, onRemove, role, kindChoices, showGrowth = false }: {
  p: WorkloadProfile;
  /** Show the growth rate inline (reverse "years until full"); forward mode edits growth in its own step. */
  showGrowth?: boolean;
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
        <EuiText size="xs" color="subdued">{p.id.startsWith(meta.label) ? meta.blurb : `${meta.label} · ${meta.blurb}`}</EuiText>
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
  let advancedError = false;

  if (meta.stream) {
    const solvingGb = solve === 'max_gb_day';
    const needsVolume = true;
    const volumeOptional = solve === 'max_shards';
    const indexed = p.rawGbPerDay !== undefined ? p.rawGbPerDay * ratio : undefined;
    body = (
      <>
        <EuiFlexGroup gutterSize="m" wrap>
          {needsVolume && !solvingGb && (
            <EuiFlexItem style={{ flexBasis: 150, minWidth: 140 }}>
              <NumField label={volumeOptional ? 'Data per day (optional)' : 'Data per day'} append="GB/day" value={p.rawGbPerDay}
                optional={volumeOptional} onChange={(v) => set({ rawGbPerDay: volumeOptional ? v : v ?? 0 })}
                helpText={volumeOptional
                  ? 'Used to decide when a fresh index starts. Leave blank to start one every 30 days.'
                  : indexed !== undefined ? `About ${fmtNum(indexed)} GB/day once stored` : undefined} />
            </EuiFlexItem>
          )}
          {needsVolume && (
            <EuiFlexItem style={{ flexBasis: 270, minWidth: 260 }}>
              <EuiFormRow label="Storage mode" helpText={`LogsDB compresses logs; TSDS is for metrics. Stored size is ${p.indexRatioOverride ?? ratio} × the raw data${p.indexRatioOverride !== undefined ? ' (set by you)' : ''}.`}>
                <EuiButtonGroup legend="Storage mode" isFullWidth buttonSize="m" idSelected={mode} onChange={(id) => onChange(withIndexMode(p, id as IndexMode))}
                  options={(['standard', 'logsdb', 'tsds'] as IndexMode[]).map((m) => ({ id: m, label: m === 'standard' ? 'Standard' : m === 'logsdb' ? 'LogsDB' : 'TSDS' }))} />
              </EuiFormRow>
            </EuiFlexItem>
          )}
          <EuiFlexItem grow={false} style={{ width: 84 }}>
            <NumField label={<EuiToolTip content="Spare copies of the data on other nodes, so nothing is lost if one fails. Applies to hot and warm; cold and frozen are backed up in object storage instead."><span>Replicas <EuiIcon type="question" size="s" /></span></EuiToolTip>}
              aria-label="Replicas" value={replicas} step={1} onChange={(v) => setReplicas(v ?? 0)} />
          </EuiFlexItem>
          {showGrowth && (
            <EuiFlexItem grow={false} style={{ width: 150 }}>
              <NumField label="Growth" append="% / yr" value={p.growthPctPerYear} optional placeholder="0" onChange={(v) => set({ growthPctPerYear: v })} />
            </EuiFlexItem>
          )}
          {solve === 'max_shards' && (
            <EuiFlexItem style={{ flexBasis: 160, minWidth: 140 }}>
              <NumField label="Rollover" append="days" value={p.rolloverDays} optional placeholder="auto" helpText="How often a fresh index starts. Blank starts one at 50 GB per shard or every 30 days, whichever comes first." onChange={(v) => set({ rolloverDays: v })} />
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
    // Downsampling is TSDS-only. A factor left on another mode stays visible, flagged, so it can be cleared.
    const downsampleTiers = (['warm', 'cold', 'frozen'] as Tier[])
      .filter((t) => (p.retentionDays[t] ?? 0) > 0)
      .filter((t) => mode === 'tsds' || p.downsampleFactor?.[t] !== undefined);
    const fieldError = (t: Tier) => downsampleProblem(p, t)?.replace(/^\[[^\]]*\] \w+: /, '');
    advancedError = downsampleTiers.some((t) => !!fieldError(t));
    advancedCount = [p.indexRatioOverride, p.avgEventKb, p.rolloverDays, p.primaryShards, p.ingestPipelines || undefined,
      ...downsampleTiers.map((t) => p.downsampleFactor?.[t])].filter((x) => x !== undefined).length;
    advanced = (
      <>
        <EuiFlexGrid columns={3} gutterSize="l">
          <EuiFlexItem><NumField label="Stored size ratio" value={p.indexRatioOverride} optional placeholder={String(num(c, `index_ratio.${mode}`))} helpText="GB stored per GB of raw data. Blank uses the default." onChange={(v) => set({ indexRatioOverride: v })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Average event size" append="KB" value={p.avgEventKb} optional placeholder={String(num(c, 'ingest.default_avg_event_kb'))} helpText="Size of one log line or record. Used to estimate processor load." onChange={(v) => set({ avgEventKb: v })} /></EuiFlexItem>
          {solve !== 'max_shards' && <EuiFlexItem><NumField label="Rollover" append="days" value={p.rolloverDays} optional placeholder="auto" helpText="How often a fresh index starts. Blank starts one at 50 GB per shard or every 30 days, whichever comes first." onChange={(v) => set({ rolloverDays: v })} /></EuiFlexItem>}
          <EuiFlexItem><NumField label="Primary shards" value={p.primaryShards} optional step={1} placeholder="1" helpText="How many slices each index is split into." onChange={(v) => set({ primaryShards: v })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Warm replicas" value={p.replicas.warm} optional step={1} placeholder={String(replicas)} helpText="Spare copies on the warm tier. Blank matches hot." onChange={(v) => set({ replicas: { ...p.replicas, warm: v } })} /></EuiFlexItem>
          {downsampleTiers.map((t) => (
            <EuiFlexItem key={t}>
              <NumField label={`${TIER_LABEL[t]} downsampling`} value={p.downsampleFactor?.[t]} optional placeholder="1" step={0.01}
                helpText="Share of metric data kept after thinning it to a coarser time step, such as 0.1. Blank keeps it all."
                error={fieldError(t)}
                onChange={(v) => { const d = { ...(p.downsampleFactor ?? {}) }; if (v === undefined) delete d[t]; else d[t] = v; set({ downsampleFactor: d }); }} />
            </EuiFlexItem>
          ))}
        </EuiFlexGrid>
        <EuiSpacer size="l" />
        <SwitchField label="Ingest pipelines" helpText="Turn on if data is reshaped on the way in. That processing can make intake up to 50% slower." checked={p.ingestPipelines ?? false} onChange={(v) => set({ ingestPipelines: v })} />
      </>
    );
  }

  if (p.kind === 'search') {
    body = (
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><NumField label="Size of the documents" append="GB" value={p.totalGb} helpText="As stored in Elasticsearch." onChange={(v) => set({ totalGb: v ?? 0 })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Replicas" value={replicas} step={1} helpText="Spare copies, so nothing is lost if a node fails." onChange={(v) => setReplicas(v ?? 0)} /></EuiFlexItem>
      </EuiFlexGrid>
    );
    advancedCount = [p.indexRatioOverride, p.primaryShards, p.tier].filter((x) => x !== undefined).length;
    advanced = (
      <EuiFlexGrid columns={3} gutterSize="l">
        <EuiFlexItem><SelectField label="Tier" value={placement} options={[{ value: 'content', text: 'Content' }, { value: 'hot', text: 'Hot' }]} helpText="Content suits data that does not age, like a catalog." onChange={(t) => set({ tier: t })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Stored size ratio" value={p.indexRatioOverride} optional placeholder={String(num(c, 'index_ratio.standard'))} onChange={(v) => set({ indexRatioOverride: v })} helpText="GB stored per GB above. Use 1.0 if the size is already as stored." /></EuiFlexItem>
        <EuiFlexItem><NumField label="Primary shards" value={p.primaryShards} optional step={1} placeholder="auto" helpText="How many slices the index is split into." onChange={(v) => set({ primaryShards: v })} /></EuiFlexItem>
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
          {!solvingCount && (
            <EuiFlexItem><NumField label="Vectors" value={v.count} step={1} onChange={(n) => set({ vector: { ...v, count: n ?? 0 } })} helpText={fmtCompact(v.count)} /></EuiFlexItem>
          )}
          <EuiFlexItem><NumField label="Dimensions" value={v.dims} step={1} helpText="Numbers in each vector, set by the AI model." onChange={(n) => set({ vector: { ...v, dims: n ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SelectField label="Quantization" value={v.quant} options={QUANTS} helpText="Compression that saves memory." onChange={(quant) => set({ vector: { ...v, quant } })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Replicas" value={replicas} step={1} helpText="Spare copies, so nothing is lost if a node fails." onChange={(n) => setReplicas(n ?? 0)} /></EuiFlexItem>
        </EuiFlexGrid>
        <EuiSpacer size="m" />
        <EuiPanel color="subdued" paddingSize="s" hasShadow={false}>
          <EuiText size="xs">
            <strong>{fmtNum(cost.offheapBytes, 1)} bytes</strong> per vector in memory
            {!solvingCount && <> · <strong>{fmtNum((v.count * cost.offheapBytes * copies) / 1e9, 1)} GB</strong> of memory for {copies} cop{copies === 1 ? 'y' : 'ies'}</>}
            {' '}· {fmtNum(cost.diskBytes, 0)} bytes per vector on disk
          </EuiText>
        </EuiPanel>
      </>
    );
    advancedCount = [v.hnswM, p.tier].filter((x) => x !== undefined).length;
    advanced = (
      <EuiFlexGrid columns={3} gutterSize="l">
        <EuiFlexItem>
          <NumField label="Graph links (HNSW m)" value={v.hnswM} optional step={1} placeholder={String(num(c, 'knn.hnsw_m'))} helpText="Links per vector in the search graph. More links use more memory." onChange={(n) => {
            const { hnswM: _drop, ...rest } = v; set({ vector: n === undefined ? rest : { ...rest, hnswM: n } });
          }} />
        </EuiFlexItem>
        <EuiFlexItem><SelectField label="Tier" value={placement} options={[{ value: 'content', text: 'Content' }, { value: 'hot', text: 'Hot' }]} onChange={(t) => set({ tier: t })} /></EuiFlexItem>
      </EuiFlexGrid>
    );
  }

  if (p.kind === 'ml' && p.ml) {
    const ml = p.ml;
    body = (
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><NumField label="Anomaly detection jobs" value={ml.anomalyJobs} step={1} onChange={(n) => set({ ml: { ...ml, anomalyJobs: n ?? 0 } })}
          helpText={`Assumes ${num(c, 'ml.jobs_per_node')} jobs per ${num(c, 'ml.node_ram_gb')} GB machine learning node (rough estimate).`} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Trained models" append="GB" value={ml.trainedModelsGb} optional placeholder="0" helpText="Total size of the AI models you load." onChange={(n) => set({ ml: { ...ml, trainedModelsGb: n } })} /></EuiFlexItem>
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
          <EuiFlexItem><NumField label="Elastic Agents" value={f.agents} step={1} helpText="Machines running Elastic Agent, which collects their data." onChange={(n) => set({ fleet: { ...f, agents: n ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SwitchField label="Elastic Defend" checked={f.defend} onChange={(defend) => set({ fleet: { ...f, defend } })} helpText="Elastic's endpoint security. Noted for the record; it does not change the sizing." /></EuiFlexItem>
        </EuiFlexGrid>
        <Hint>Fleet Server, which manages the agents, needs {row.fleetMemGb} GB of memory for up to {fmtNum(row.agents, 0)} agents. The hot tier needs at least {row.hotRamGb} GB of memory and {row.hotVcpu} processor cores.</Hint>
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
          <MoreOptions count={advancedCount} hasError={advancedError}>{advanced}</MoreOptions>
        </>
      )}
    </EuiPanel>
  );
}

export function KindBadge({ kind }: { kind: WorkloadKind }) {
  return <EuiBadge iconType={KINDS[kind].icon} color="hollow">{KINDS[kind].label}</EuiBadge>;
}
