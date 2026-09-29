import {
  EuiButtonEmpty, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldText, EuiFlexGrid, EuiFlexGroup, EuiFlexItem,
  EuiIcon, EuiPanel, EuiPopover, EuiSpacer, EuiText, EuiTitle,
} from '@elastic/eui';
import { echDefaultSku, type EchData, type EchPlacement, type EchUseCase } from '@sizing/engine';
import { useState, type ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import {
  channelsFor, newEchItem, PROVIDERS, regionsFor, skusFor, tiersFor, USE_CASES, useCaseLabel, withPlacement,
  type EchItem, type EchState,
} from './state.ts';

const col = (children: ReactNode, key?: string) => <EuiFlexItem key={key}>{children}</EuiFlexItem>;

/** Cloud, region, sales channel and subscription: the four keys of an ECH price. */
export function PlacementForm({ data, value, onChange }: { data: EchData; value: EchPlacement; onChange: (p: EchPlacement) => void }) {
  const set = (patch: Partial<EchPlacement>) => onChange(withPlacement(data, value, patch));
  const regions = regionsFor(data, value.provider);
  return (
    <EuiFlexGrid columns={2} gutterSize="l">
      {col(<SelectField label="Cloud provider" value={value.provider} options={PROVIDERS} onChange={(provider) => set({ provider })} />)}
      {col(<SelectField label="Region" value={value.region}
        options={regions.map((r) => ({ value: r.name, text: `${r.name.replace(/^[A-Z]+-/, '')}${r.launched ? '' : ' (not launched)'}` }))}
        onChange={(region) => set({ region })} />)}
      {col(<SelectField label="Sales channel" value={value.channel}
        options={channelsFor(data, value.provider).map((ch) => ({ value: ch, text: ch === 'Elastic Direct' ? 'Elastic direct' : `${ch.replace(' MP', '')} Marketplace` }))}
        onChange={(channel) => set({ channel: channel as EchPlacement['channel'] })} helpText="Marketplace prices are the same as direct today." />)}
      {col(<SelectField label="Subscription" value={value.tier}
        options={tiersFor(data, value.provider, value.channel).map((t) => ({ value: t, text: t }))}
        onChange={(tier) => set({ tier: tier as EchPlacement['tier'] })} helpText="Cold and frozen need Enterprise. Standard is not sold on annual deals." />)}
    </EuiFlexGrid>
  );
}

/** Use cases in the deployment; each is priced as its own deployment and the totals add up. */
export function EchItemList({ data, state, onChange }: { data: EchData; state: EchState; onChange: (items: EchItem[]) => void }) {
  const [adding, setAdding] = useState(false);
  const items = state.items;
  const set = (i: number, next: EchItem) => onChange(items.map((x, j) => (j === i ? next : x)));
  return (
    <>
      {items.map((item, i) => (
        <div key={item.id}>
          <EchItemCard data={data} placement={state.placement} item={item} onChange={(next) => set(i, next)}
            onRemove={items.length > 1 ? () => onChange(items.filter((_, j) => j !== i)) : undefined} />
          <EuiSpacer size="m" />
        </div>
      ))}
      <EuiPopover isOpen={adding} closePopover={() => setAdding(false)} panelPaddingSize="none" anchorPosition="downLeft"
        button={<EuiButtonEmpty iconType="plusCircle" onClick={() => setAdding(!adding)}>Add a use case</EuiButtonEmpty>}>
        <EuiContextMenuPanel items={USE_CASES.map((u) => (
          <EuiContextMenuItem key={u.value} icon={u.icon} onClick={() => { onChange([...items, newEchItem(u.value, items.map((x) => x.name))]); setAdding(false); }}>
            <strong>{u.label}</strong> <EuiText size="xs" color="subdued" component="span">{u.blurb}</EuiText>
          </EuiContextMenuItem>
        ))} />
      </EuiPopover>
    </>
  );
}

const SIEM_USE_CASES = [
  { value: 'ultra_small', text: 'Ultra small' }, { value: 'small', text: 'Small' }, { value: 'soc', text: 'Security operations centre (SOC)' }, { value: 'enterprise', text: 'Enterprise' },
] as const;
const ENDPOINT_USE_CASES = [
  { value: 'ngav', text: 'Next-gen antivirus' }, { value: 'essential_edr', text: 'Essential EDR' }, { value: 'complete_edr', text: 'Complete EDR' },
  { value: 'cwp_protect', text: 'Cloud workloads: protect' }, { value: 'cwp_monitor', text: 'Cloud workloads: monitor' }, { value: 'cwp_comprehensive', text: 'Cloud workloads: comprehensive' },
] as const;
const AVAILABILITY = [
  { value: 'standard', text: 'Standard (fewer zones and copies)' }, { value: 'high', text: 'High' }, { value: 'maximum', text: 'Maximum (most zones and copies)' },
] as const;
const VECTOR_METHODS = [
  { value: 'bbq', text: 'BBQ (compressed, recommended)' }, { value: 'int8', text: 'int8 (4× smaller)' }, { value: 'float32', text: 'float32 (full size)' }, { value: 'disk_bbq', text: 'Disk BBQ (mostly on disk)' },
] as const;
const SEARCH_USE_CASES = [{ value: 'Custom Search', text: 'Custom search' }, { value: 'Ingest', text: 'Crawlers and connectors' }] as const;

type Tier = 'hot' | 'warm' | 'cold' | 'frozen';
function Retention({ value, tiers, onChange }: { value: Partial<Record<Tier, number>>; tiers: Tier[]; onChange: (v: Partial<Record<Tier, number>>) => void }) {
  return (
    <EuiFlexGrid columns={4} gutterSize="m">
      {tiers.map((t) => col(
        <NumField label={`${t[0]!.toUpperCase()}${t.slice(1)} days`} value={value[t]} optional min={0}
          onChange={(v) => { const { [t]: _drop, ...rest } = value; onChange(v === undefined ? rest : { ...rest, [t]: v }); }} />, t,
      ))}
    </EuiFlexGrid>
  );
}

/** Roles whose instance type the use case lets you choose, with the Specs type they draw from. */
const ROLE_TYPES: Record<EchUseCase, [string, string, string][]> = {
  logs: [['hot', 'Hot', 'data_hot'], ['warm', 'Warm', 'data_warm'], ['cold', 'Cold', 'data_cold'], ['frozen', 'Frozen', 'data_frozen'], ['master', 'Master', 'master'], ['coordinating', 'Coordinating', 'coordinating'], ['ml', 'Machine learning', 'ml'], ['kibana', 'Kibana', 'kibana']],
  metrics: [],
  siem: [['hot', 'Hot', 'data_hot'], ['cold', 'Cold', 'data_cold'], ['frozen', 'Frozen', 'data_frozen'], ['master', 'Master', 'master'], ['ml', 'Machine learning', 'ml'], ['kibana', 'Kibana', 'kibana']],
  endpoint: [],
  apm: [],
  search: [['data', 'Data', 'data_hot'], ['enterpriseSearch', 'Crawlers and connectors', 'enterprisesearch'], ['master', 'Master', 'master'], ['coordinating', 'Coordinating', 'coordinating'], ['ml', 'Machine learning', 'ml'], ['kibana', 'Kibana', 'kibana']],
  vector: [],
};
ROLE_TYPES.metrics = ROLE_TYPES.logs;
ROLE_TYPES.endpoint = ROLE_TYPES.siem;
ROLE_TYPES.apm = [...ROLE_TYPES.logs, ['apm', 'APM Server', 'apm']];

/** Instance options for a role type, the default marked; picking the default clears the override so it follows the cloud. */
function skuOptions(data: EchData, placement: EchPlacement, type: string, def: string | undefined) {
  const opts = skusFor(data, placement, type).map((o) => ({ value: o.id, text: `${o.id}${o.id === def ? ' (default)' : ''}${o.offered ? '' : ' (not offered here)'}` }));
  return def && !opts.some((o) => o.value === def) ? [{ value: def, text: `${def} (default)` }, ...opts] : opts;
}

function InstanceTypes({ data, placement, item, onChange }: { data: EchData; placement: EchPlacement; item: EchItem; onChange: (next: EchItem) => void }) {
  if (item.useCase === 'vector') {
    const def = echDefaultSku(data, placement, 'vector', 'data');
    return (
      <EuiFlexGrid columns={2} gutterSize="m">
        {col(<SelectField label="Data instance type" value={item.req.sku ?? def ?? ''}
          options={skuOptions(data, placement, 'data_hot', def)}
          onChange={(sku) => { const { sku: _drop, ...rest } = item.req; onChange({ ...item, req: sku && sku !== def ? { ...rest, sku } : rest }); }} />)}
      </EuiFlexGrid>
    );
  }
  const skus = (item.req.skus ?? {}) as Record<string, string | undefined>;
  const setSku = (role: string, id: string, def: string | undefined) => {
    const { [role]: _drop, ...rest } = skus;
    onChange({ ...item, req: { ...item.req, skus: id && id !== def ? { ...rest, [role]: id } : rest } } as EchItem);
  };
  return (
    <EuiFlexGrid columns={2} gutterSize="m">
      {ROLE_TYPES[item.useCase].map(([role, label, type]) => {
        const def = echDefaultSku(data, placement, item.useCase, role);
        return col(
          <SelectField label={label} value={skus[role] ?? def ?? ''} options={skuOptions(data, placement, type, def)} onChange={(id) => setSku(role, id, def)} />, role,
        );
      })}
    </EuiFlexGrid>
  );
}

function EchItemCard({ data, placement, item, onChange, onRemove }: {
  data: EchData; placement: EchPlacement; item: EchItem; onChange: (next: EchItem) => void; onRemove?: () => void;
}) {
  const [more, setMore] = useState(false);
  const u = USE_CASES.find((x) => x.value === item.useCase)!;
  const req = <T extends EchItem>(patch: Partial<T['req']>) => onChange({ ...item, req: { ...item.req, ...patch } } as EchItem);

  let body: ReactNode;
  switch (item.useCase) {
    case 'logs':
    case 'metrics': {
      const r = item.req;
      body = (
        <>
          <EuiFlexGrid columns={2} gutterSize="m">
            {item.useCase === 'logs'
              ? col(<NumField label="Data per day" append="GB/day" value={r.gbPerDay} onChange={(v) => req({ gbPerDay: v ?? 0 })} />)
              : col(<NumField label="Datapoints per second" value={r.datapointsPerSecond} step={1} onChange={(v) => req({ datapointsPerSecond: v ?? 0 })} helpText="Each datapoint is stored in about 5 bytes." />)}
          </EuiFlexGrid>
          <EuiSpacer size="m" />
          <Retention value={r.retentionDays} tiers={['hot', 'warm', 'cold', 'frozen']} onChange={(retentionDays) => req({ retentionDays })} />
        </>
      );
      break;
    }
    case 'siem':
    case 'endpoint': {
      const r = item.req;
      body = (
        <EuiFlexGrid columns={2} gutterSize="m">
          {item.useCase === 'siem' ? (
            <>
              {col(<SelectField label="Kind of deployment" value={r.siemUseCase ?? 'enterprise'} options={[...SIEM_USE_CASES]} onChange={(siemUseCase) => req({ siemUseCase })} helpText="Sets the master, machine learning and Kibana sizes." />)}
              {col(<NumField label="Data per day" append="GB/day" value={r.gbPerDay} optional onChange={(v) => req({ gbPerDay: v })} />)}
              {col(<NumField label="Events per second" value={r.eventsPerSecond} optional step={1} onChange={(v) => req({ eventsPerSecond: v })} helpText="The larger of this (at 500 bytes an event) and data per day is used." />)}
              {r.siemUseCase === 'enterprise' || r.siemUseCase === undefined ? (
                <>
                  {col(<NumField label="Detection rule sets" value={r.detectionRuleInstances} optional step={1} onChange={(v) => req({ detectionRuleInstances: v })} />)}
                  {col(<NumField label="Analysts per shift" value={r.analystsPerShift} optional step={1} onChange={(v) => req({ analystsPerShift: v })} />)}
                </>
              ) : null}
            </>
          ) : (
            <>
              {col(<SelectField label="Protection" value={r.endpointUseCase ?? 'complete_edr'} options={[...ENDPOINT_USE_CASES]} onChange={(endpointUseCase) => req({ endpointUseCase })} />)}
              {col(<NumField label="Endpoints" value={r.endpoints} step={1} onChange={(v) => req({ endpoints: v ?? 0 })} helpText="Laptops, servers or cloud workloads with Elastic Defend." />)}
              {col(<NumField label="Windows" append="%" value={r.windowsPct} optional onChange={(v) => req({ windowsPct: v })} />)}
              {col(<NumField label="Linux or macOS" append="%" value={r.linuxMacPct} optional onChange={(v) => req({ linuxMacPct: v })} />)}
            </>
          )}
          {col(<NumField label="Days searchable" append="days" value={r.totalDays} onChange={(v) => req({ totalDays: v ?? 7 })} helpText="1 day hot, 6 days cold, the rest frozen." />)}
          {col(<SelectField label="Availability" value={r.availability} options={[...AVAILABILITY]} onChange={(availability) => req({ availability })} helpText="Sets the zones and spare copies for each tier." />)}
          {col(<SwitchField label="LogsDB (smaller storage)" checked={r.logsdb} onChange={(logsdb) => req({ logsdb })} />)}
        </EuiFlexGrid>
      );
      break;
    }
    case 'apm': {
      const r = item.req;
      body = (
        <>
          <EuiFlexGrid columns={2} gutterSize="m">
            {col(<NumField label="Traces per minute" value={r.tracesPerMinute} step={1} onChange={(v) => req({ tracesPerMinute: v ?? 0 })} />)}
            {col(<NumField label="Sampling rate" value={r.samplingRate} optional step={0.01} min={0} placeholder="0.07" onChange={(v) => req({ samplingRate: v })} helpText="Share of traces kept, 0 to 1." />)}
          </EuiFlexGrid>
          <EuiSpacer size="m" />
          <Retention value={r.retentionDays} tiers={['hot', 'warm', 'cold', 'frozen']} onChange={(retentionDays) => req({ retentionDays })} />
        </>
      );
      break;
    }
    case 'search': {
      const r = item.req;
      body = (
        <EuiFlexGrid columns={2} gutterSize="m">
          {col(<SelectField label="Kind of search" value={r.useCase ?? 'Custom Search'} options={[...SEARCH_USE_CASES]} onChange={(useCase) => req({ useCase })} />)}
          {col(<NumField label="Documents" value={r.documents} step={1} onChange={(v) => req({ documents: v ?? 0 })} />)}
          {col(<NumField label="Average document size" append="KB" value={r.avgDocKb} onChange={(v) => req({ avgDocKb: v ?? 0 })} />)}
          {col(<NumField label="Peak operations per second" value={r.peakOpsPerSecond} onChange={(v) => req({ peakOpsPerSecond: v ?? 0 })} helpText="Searches plus writes at the busiest time." />)}
        </EuiFlexGrid>
      );
      break;
    }
    case 'vector': {
      const r = item.req;
      body = (
        <EuiFlexGrid columns={2} gutterSize="m">
          {col(<SelectField label="Vector storage" value={r.method} options={[...VECTOR_METHODS]} onChange={(method) => req({ method })} />)}
          {col(<NumField label="Documents" value={r.documents} step={1} onChange={(v) => req({ documents: v ?? 0 })} />)}
          {col(<NumField label="Vectors per document" value={r.vectorsPerDoc} step={1} onChange={(v) => req({ vectorsPerDoc: v ?? 1 })} />)}
          {col(<NumField label="Dimensions" value={r.dims} step={1} onChange={(v) => req({ dims: v ?? 0 })} helpText="Numbers in each vector, set by the AI model." />)}
        </EuiFlexGrid>
      );
      break;
    }
  }

  return (
    <EuiPanel hasBorder paddingSize="l">
      <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}><EuiIcon type={u.icon} size="l" /></EuiFlexItem>
        <EuiFlexItem>
          <EuiFieldText compressed aria-label="Use case name" value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} style={{ maxWidth: 280, fontWeight: 600 }} />
          <EuiText size="xs" color="subdued"><p>{useCaseLabel(item.useCase)}: {u.blurb.toLowerCase()}</p></EuiText>
        </EuiFlexItem>
        {onRemove && <EuiFlexItem grow={false}><EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${item.name}`} onClick={onRemove} /></EuiFlexItem>}
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      {body}
      <EuiSpacer size="s" />
      <EuiButtonEmpty size="xs" iconType={more ? 'chevronSingleDown' : 'chevronSingleRight'} onClick={() => setMore(!more)}>Instance types</EuiButtonEmpty>
      {more && (
        <>
          <EuiSpacer size="s" />
          <EuiTitle size="xxs"><h4>Instance types</h4></EuiTitle>
          <EuiText size="xs" color="subdued"><p>The hardware each part runs on. The one marked (default) is the spreadsheet’s choice for this cloud.</p></EuiText>
          <EuiSpacer size="s" />
          <InstanceTypes data={data} placement={placement} item={item} onChange={onChange} />
        </>
      )}
    </EuiPanel>
  );
}
