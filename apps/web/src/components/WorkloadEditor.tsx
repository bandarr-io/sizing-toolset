import {
  EuiButtonEmpty, EuiButtonIcon, EuiFieldText, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiPanel,
  EuiSpacer, EuiText, EuiTitle,
} from '@elastic/eui';
import { defaultConstants, num } from '@sizing/constants';
import { defaultIndexMode, type IndexMode, type Quant, type Tier, type WorkloadKind, type WorkloadProfile } from '@sizing/engine';
import { newId } from '../state.ts';
import { Collapsible } from './Collapsible.tsx';
import { NumField, SelectField, SwitchField } from './Fields.tsx';

const KINDS: { value: WorkloadKind; text: string }[] = [
  { value: 'logs', text: 'Logs' }, { value: 'siem', text: 'Security / SIEM' }, { value: 'metrics', text: 'Metrics' },
  { value: 'apm', text: 'APM / traces' }, { value: 'search', text: 'Search / content' }, { value: 'vector', text: 'Vector search' },
  { value: 'ml', text: 'Machine learning' }, { value: 'fleet', text: 'Fleet / Elastic Agent' },
];
const MODES: { value: IndexMode; text: string }[] = [
  { value: 'standard', text: 'Standard (1.2)' }, { value: 'logsdb', text: 'LogsDB (0.5)' }, { value: 'tsds', text: 'TSDS (0.3)' },
];
const QUANTS: { value: Quant; text: string }[] = [
  { value: 'bbq', text: 'BBQ (HNSW)' }, { value: 'bbq_disk', text: 'DiskBBQ (Low confidence)' }, { value: 'int8', text: 'int8' },
  { value: 'int4', text: 'int4' }, { value: 'bfloat16', text: 'bfloat16' }, { value: 'float32', text: 'float32' },
];
const PLACEMENT: { value: Tier; text: string }[] = [{ value: 'content', text: 'content' }, { value: 'hot', text: 'hot' }];
const RETENTION_TIERS: Tier[] = ['hot', 'warm', 'cold', 'frozen'];

export function blankWorkload(kind: WorkloadKind): WorkloadProfile {
  const id = newId(kind);
  switch (kind) {
    case 'search': return { id, kind, totalGb: 500, retentionDays: {}, replicas: { content: 1 } };
    case 'vector': return { id, kind, vector: { count: 10_000_000, dims: 1024, quant: 'bbq' }, retentionDays: {}, replicas: { content: 1 } };
    case 'ml': return { id, kind, ml: { anomalyJobs: 10 }, retentionDays: {}, replicas: {} };
    case 'fleet': return { id, kind, fleet: { agents: 5000, defend: false }, retentionDays: {}, replicas: {} };
    default: return { id, kind, rawGbPerDay: 100, retentionDays: { hot: 7 }, replicas: { hot: 1, warm: 1 } };
  }
}

function hasVolume(k: WorkloadKind) {
  return k === 'logs' || k === 'siem' || k === 'metrics' || k === 'apm';
}

function ProfileFields({ p, onChange }: { p: WorkloadProfile; onChange: (p: WorkloadProfile) => void }) {
  const set = (patch: Partial<WorkloadProfile>) => onChange({ ...p, ...patch });
  const tier = p.tier ?? 'content';
  const setTierMap = (key: 'retentionDays' | 'replicas' | 'downsampleFactor', t: Tier, v: number | undefined) => {
    const next = { ...(p[key] ?? {}) } as Partial<Record<Tier, number>>;
    if (v === undefined) delete next[t]; else next[t] = v;
    set({ [key]: next } as Partial<WorkloadProfile>);
  };

  return (
    <>
      <EuiFlexGrid columns={3} gutterSize="s">
        <EuiFlexItem>
          <EuiFormRow label="Name" display="rowCompressed" fullWidth>
            <EuiFieldText compressed fullWidth value={p.id} onChange={(e) => set({ id: e.target.value })} />
          </EuiFormRow>
        </EuiFlexItem>
        <EuiFlexItem>
          <SelectField label="Kind" value={p.kind} options={KINDS} onChange={(kind) => onChange({ ...blankWorkload(kind), id: p.id })} />
        </EuiFlexItem>
        {(hasVolume(p.kind) || p.kind === 'search') && (
          <EuiFlexItem>
            <SelectField label="Index mode" value={p.indexMode ?? defaultIndexMode(p)} options={MODES} onChange={(indexMode) => set({ indexMode })} />
          </EuiFlexItem>
        )}
        {hasVolume(p.kind) && (
          <EuiFlexItem><NumField label="Raw ingest" append="GB/day" value={p.rawGbPerDay} optional onChange={(v) => set({ rawGbPerDay: v })} helpText="Leave empty when solving for GB/day" /></EuiFlexItem>
        )}
        {p.kind === 'search' && (
          <EuiFlexItem><NumField label="Corpus size" append="GB" value={p.totalGb} onChange={(v) => set({ totalGb: v ?? 0 })} /></EuiFlexItem>
        )}
        {(hasVolume(p.kind) || p.kind === 'search') && (
          <EuiFlexItem>
            <NumField label="Index ratio override" value={p.indexRatioOverride} optional placeholder={`${num(defaultConstants, `index_ratio.${p.indexMode ?? defaultIndexMode(p)}`)}`} onChange={(v) => set({ indexRatioOverride: v })} />
          </EuiFlexItem>
        )}
      </EuiFlexGrid>

      {hasVolume(p.kind) && (
        <>
          <EuiSpacer size="s" />
          <EuiText size="xs"><strong>Per tier</strong> (days · replicas · downsample)</EuiText>
          <EuiFlexGrid columns={4} gutterSize="s">
            {RETENTION_TIERS.map((t) => (
              <EuiFlexItem key={t}>
                <EuiPanel paddingSize="s" color="subdued">
                  <EuiText size="xs"><strong>{t}</strong></EuiText>
                  <NumField label="Days" value={p.retentionDays[t]} optional onChange={(v) => setTierMap('retentionDays', t, v)} />
                  {(t === 'hot' || t === 'warm') && (
                    <NumField label="Replicas" value={p.replicas[t]} optional step={1} placeholder="1" onChange={(v) => setTierMap('replicas', t, v)} />
                  )}
                  {t !== 'hot' && (
                    <NumField label="Downsample" value={p.downsampleFactor?.[t]} optional placeholder="1" onChange={(v) => setTierMap('downsampleFactor', t, v)} />
                  )}
                </EuiPanel>
              </EuiFlexItem>
            ))}
          </EuiFlexGrid>
          <EuiText size="xs" color="subdued"><p>Cold and frozen never carry replicas.</p></EuiText>
          <EuiFlexGrid columns={4} gutterSize="s">
            <EuiFlexItem><NumField label="Growth" append="%/yr" value={p.growthPctPerYear} optional onChange={(v) => set({ growthPctPerYear: v })} /></EuiFlexItem>
            <EuiFlexItem><NumField label="Avg event size" append="KB" value={p.avgEventKb} optional placeholder="1" onChange={(v) => set({ avgEventKb: v })} /></EuiFlexItem>
            <EuiFlexItem><NumField label="Rollover" append="days" value={p.rolloverDays} optional placeholder="1" onChange={(v) => set({ rolloverDays: v })} /></EuiFlexItem>
            <EuiFlexItem><NumField label="Primary shards" value={p.primaryShards} optional step={1} placeholder="1" onChange={(v) => set({ primaryShards: v })} /></EuiFlexItem>
          </EuiFlexGrid>
          <SwitchField label="Ingest pipelines (up to 50% slower indexing)" checked={p.ingestPipelines ?? false} onChange={(v) => set({ ingestPipelines: v })} />
        </>
      )}

      {(p.kind === 'search' || p.kind === 'vector') && (
        <EuiFlexGrid columns={3} gutterSize="s">
          <EuiFlexItem><SelectField label="Tier" value={tier} options={PLACEMENT} onChange={(t) => set({ tier: t })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Replicas" value={p.replicas[tier]} optional step={1} placeholder="1" onChange={(v) => setTierMap('replicas', tier, v)} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Growth" append="%/yr" value={p.growthPctPerYear} optional onChange={(v) => set({ growthPctPerYear: v })} /></EuiFlexItem>
        </EuiFlexGrid>
      )}

      {p.kind === 'vector' && p.vector && (
        <EuiFlexGrid columns={4} gutterSize="s">
          <EuiFlexItem><NumField label="Vectors" value={p.vector.count} step={1} onChange={(v) => set({ vector: { ...p.vector!, count: v ?? 0 } })} helpText="Ignored when solving for max vectors" /></EuiFlexItem>
          <EuiFlexItem><NumField label="Dimensions" value={p.vector.dims} step={1} onChange={(v) => set({ vector: { ...p.vector!, dims: v ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SelectField label="Quantization" value={p.vector.quant} options={QUANTS} onChange={(quant) => set({ vector: { ...p.vector!, quant } })} /></EuiFlexItem>
          <EuiFlexItem>
            <NumField label="HNSW m" value={p.vector.hnswM} optional step={1} placeholder="16" onChange={(v) => {
              const { hnswM: _drop, ...rest } = p.vector!;
              set({ vector: v === undefined ? rest : { ...rest, hnswM: v } });
            }} />
          </EuiFlexItem>
        </EuiFlexGrid>
      )}

      {p.kind === 'ml' && p.ml && (
        <EuiFlexGrid columns={3} gutterSize="s">
          <EuiFlexItem><NumField label="Anomaly detection jobs" value={p.ml.anomalyJobs} step={1} onChange={(v) => set({ ml: { ...p.ml!, anomalyJobs: v ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><NumField label="Trained models" append="GB" value={p.ml.trainedModelsGb} optional onChange={(v) => set({ ml: { ...p.ml!, trainedModelsGb: v } })} /></EuiFlexItem>
        </EuiFlexGrid>
      )}

      {p.kind === 'fleet' && p.fleet && (
        <EuiFlexGrid columns={3} gutterSize="s">
          <EuiFlexItem><NumField label="Elastic Agents" value={p.fleet.agents} step={1} onChange={(v) => set({ fleet: { ...p.fleet!, agents: v ?? 0 } })} /></EuiFlexItem>
          <EuiFlexItem><SwitchField label="Elastic Defend" checked={p.fleet.defend} onChange={(defend) => set({ fleet: { ...p.fleet!, defend } })} /></EuiFlexItem>
        </EuiFlexGrid>
      )}
    </>
  );
}

function summary(p: WorkloadProfile): string {
  if (p.kind === 'search') return `${p.totalGb ?? 0} GB corpus`;
  if (p.kind === 'vector' && p.vector) return `${p.vector.count.toLocaleString('en-US')} × ${p.vector.dims}-d ${p.vector.quant}`;
  if (p.kind === 'ml' && p.ml) return `${p.ml.anomalyJobs} jobs`;
  if (p.kind === 'fleet' && p.fleet) return `${p.fleet.agents.toLocaleString('en-US')} agents`;
  const days = Object.entries(p.retentionDays).filter(([, d]) => d && d > 0).map(([t, d]) => `${d}d ${t}`).join(' + ');
  return `${p.rawGbPerDay !== undefined ? `${p.rawGbPerDay} GB/day` : 'GB/day solved'} · ${days || 'no retention'}`;
}

export function WorkloadEditor({ workloads, onChange, title = 'Workloads' }: {
  workloads: WorkloadProfile[]; onChange: (w: WorkloadProfile[]) => void; title?: string;
}) {
  const update = (i: number, p: WorkloadProfile) => onChange(workloads.map((w, j) => (j === i ? p : w)));
  return (
    <>
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
        <EuiFlexItem grow={false}><EuiTitle size="xs"><h3>{title}</h3></EuiTitle></EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty size="s" iconType="plusCircle" onClick={() => onChange([...workloads, blankWorkload('logs')])}>Add workload</EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {workloads.map((p, i) => (
        <div key={i}>
          <EuiPanel paddingSize="s" hasBorder>
            <Collapsible
              initialIsOpen={workloads.length <= 2}
              header={<EuiText size="s"><strong>{p.id}</strong> <span style={{ opacity: 0.7 }}>· {summary(p)}</span></EuiText>}
              extraAction={<EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${p.id}`} onClick={() => onChange(workloads.filter((_, j) => j !== i))} />}
            >
              <ProfileFields p={p} onChange={(np) => update(i, np)} />
            </Collapsible>
          </EuiPanel>
          <EuiSpacer size="s" />
        </div>
      ))}
      {workloads.length === 0 && <EuiText size="s" color="subdued"><p>No workloads. Add one to start.</p></EuiText>}
    </>
  );
}
