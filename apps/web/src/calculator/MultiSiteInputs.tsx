import {
  EuiCallOut, EuiFieldText, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiPanel, EuiSpacer, EuiSwitch, EuiTab, EuiTabs, EuiText,
} from '@elastic/eui';
import { defaultIndexMode, type SiteInput, type WorkloadProfile } from '@sizing/engine';
import { useState, type ReactNode } from 'react';
import { NumField, SelectField } from '../components/Fields.tsx';
import {
  deploymentOfForward, RELATIONSHIPS, withForwardDeployment, withSiteCount, type AppState, type MultiSiteState,
} from '../state.ts';
import { Gap, Section } from '../ui/Section.tsx';
import { DeploymentSettings } from './DeploymentSettings.tsx';
import { ServerGroups } from './ServerGroups.tsx';
import { WorkloadList } from './WorkloadList.tsx';

type Setter = (f: (s: AppState) => AppState) => void;

/** Turning "identical" off starts every site as a copy of the first (standbys in DR ingest nothing). */
function splitSites(ms: MultiSiteState): MultiSiteState {
  const first = ms.sites[0]!;
  return {
    ...ms, identical: false,
    sites: ms.sites.map((s, i) => (i === 0 ? s : {
      ...s,
      servers: s.servers.length ? s.servers : first.servers,
      workloads: s.workloads.length || (ms.relationship === 'dr' && i !== ms.leader) ? s.workloads : first.workloads,
    })),
  };
}

/** Tabs over sites, or a single form when every site is the same. */
function PerSite({ ms, render, only }: { ms: MultiSiteState; render: (site: SiteInput, i: number) => ReactNode; only?: (i: number) => boolean }) {
  const [tab, setTab] = useState(0);
  const indices = ms.sites.map((_, i) => i).filter((i) => (only ? only(i) : true));
  const current = indices.includes(tab) ? tab : indices[0] ?? 0;
  return (
    <>
      <EuiTabs size="s" bottomBorder>
        {indices.map((i) => <EuiTab key={i} isSelected={current === i} onClick={() => setTab(i)}>{ms.sites[i]!.name}</EuiTab>)}
      </EuiTabs>
      <EuiSpacer size="m" />
      {ms.sites[current] && render(ms.sites[current]!, current)}
    </>
  );
}

function RelationshipCards({ value, onChange }: { value: MultiSiteState['relationship']; onChange: (v: MultiSiteState['relationship']) => void }) {
  return (
    <EuiFlexGrid columns={3} gutterSize="m" role="radiogroup" aria-label="How the sites relate">
      {RELATIONSHIPS.map((r) => {
        const selected = r.value === value;
        return (
          <EuiFlexItem key={r.value}>
            <EuiPanel element="button" role="radio" aria-checked={selected} onClick={() => onChange(r.value)} paddingSize="m" hasBorder hasShadow={false}
              color={selected ? 'primary' : 'plain'} style={{ textAlign: 'left', outline: selected ? '2px solid #0B64DD' : undefined, height: '100%' }}>
              <EuiText size="s"><strong>{r.title}</strong></EuiText>
              <EuiText size="xs" color="subdued">{r.blurb}</EuiText>
            </EuiPanel>
          </EuiFlexItem>
        );
      })}
    </EuiFlexGrid>
  );
}

export function MultiSiteInputs({ ms, setState }: { ms: MultiSiteState; setState: Setter }) {
  const set = (next: MultiSiteState) => setState((s) => ({ ...s, multisite: next }));
  const setSite = (i: number, patch: Partial<SiteInput>) => set({ ...ms, sites: ms.sites.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const dr = ms.relationship === 'dr';
  const allWorkloads: WorkloadProfile[] = ms.sites.flatMap((s) => s.workloads);
  const hasLogsdb = allWorkloads.some((p) => defaultIndexMode(p) === 'logsdb');
  const leaderOptions = ms.sites.map((s, i) => ({ value: String(i), text: s.name }));

  const ingestNote = dr
    ? `Only the primary (${ms.sites[ms.leader]?.name}) ingests; standbys hold a copy of its data.`
    : ms.relationship === 'active_active'
      ? 'Each site ingests this and also holds every other site\'s data.'
      : 'Each site ingests and keeps only its own data.';

  return (
    <>
      <Section step={1} title="How are the sites set up?" description="Pick how the clusters relate. Turn on Compare to see all three side by side.">
        <RelationshipCards value={ms.relationship} onChange={(relationship) => set({ ...ms, relationship })} />
        <EuiSpacer size="m" />
        <EuiFlexGroup gutterSize="l" alignItems="flexEnd" wrap>
          <EuiFlexItem grow={false} style={{ width: 110 }}>
            <NumField label="Sites" value={ms.sites.length} step={1} min={1} onChange={(v) => set(withSiteCount(ms, v ?? 1))} />
          </EuiFlexItem>
          {dr && (
            <EuiFlexItem grow={false} style={{ width: 180 }}>
              <SelectField label="Primary site" value={String(ms.leader)} options={leaderOptions} onChange={(v) => set({ ...ms, leader: Number(v) })} />
            </EuiFlexItem>
          )}
          <EuiFlexItem grow={false}>
            <EuiFormRow hasEmptyLabelSpace>
              <EuiSwitch label="Sites are identical" checked={ms.identical} onChange={(e) => set(e.target.checked ? { ...ms, identical: true } : splitSites(ms))} />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFormRow hasEmptyLabelSpace>
              <EuiSwitch label="Compare all three" checked={ms.compare} onChange={(e) => set({ ...ms, compare: e.target.checked })} />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="m" />
        <EuiFlexGroup gutterSize="s" wrap>
          {ms.sites.map((s, i) => (
            <EuiFlexItem key={i} grow={false} style={{ width: 170 }}>
              <EuiFormRow label={`Site ${i + 1} name`} display="rowCompressed">
                <EuiFieldText compressed value={s.name} onChange={(e) => setSite(i, { name: e.target.value })} />
              </EuiFormRow>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
        <EuiText size="xs" color="subdued"><p>{ms.identical ? 'One set of servers and workloads is used for every site.' : 'Each site has its own servers and workloads.'}</p></EuiText>
      </Section>
      <Gap />

      <Section step={2} title="What do the sites ingest?" description={ingestNote}>
        {ms.identical
          ? <WorkloadList workloads={ms.sites[0]!.workloads} onChange={(workloads) => setSite(0, { workloads })} />
          : (
            <PerSite ms={ms} render={(site, i) => (
              <>
                {dr && i !== ms.leader && (
                  <><EuiCallOut size="s" iconType="info" title={`Standby: holds a copy of ${ms.sites[ms.leader]?.name}. Add workloads here only if it also ingests its own data.`} /><EuiSpacer size="m" /></>
                )}
                <WorkloadList key={i} workloads={site.workloads} onChange={(workloads) => setSite(i, { workloads })} />
              </>
            )} />
          )}
      </Section>
      <Gap />

      <Section step={3} title="What servers does each site have?" description="One row per group of identical physical servers. The calculator works out the Elasticsearch nodes on each.">
        {ms.identical
          ? <ServerGroups servers={ms.sites[0]!.servers} onChange={(servers) => setSite(0, { servers })} />
          : <PerSite ms={ms} render={(site, i) => <ServerGroups key={i} servers={site.servers} onChange={(servers) => setSite(i, { servers })} />} />}
      </Section>
      <Gap />

      <Section step={4} title="Deployment" description="Shared by every site.">
        <DeploymentSettings hideSites value={deploymentOfForward(ms.options)} hasLogsdb={hasLogsdb}
          onChange={(d) => set({ ...ms, options: withForwardDeployment(ms.options, { ...d, sites: 1, ccrMode: 'none' }) })} />
      </Section>
    </>
  );
}
