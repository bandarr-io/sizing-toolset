import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiCallOut, EuiCheckbox, EuiFieldText, EuiFlexGrid, EuiFlexGroup, EuiFlexItem,
  EuiFlyout, EuiFlyoutBody, EuiFlyoutFooter, EuiFlyoutHeader, EuiFormRow, EuiPanel, EuiSpacer, EuiText, EuiTextArea, EuiTitle,
} from '@elastic/eui';
import { forward } from '@sizing/engine';
import { useMemo, useState } from 'react';
import { useConstants } from '../constantsStore.tsx';
import { mergeRates } from '../cost.ts';
import { useCostDefaults } from '../costStore.tsx';
import { useEchData } from '../ech/EchData.tsx';
import { defaultEch, runEch } from '../ech/state.ts';
import { download, slug } from '../export.ts';
import type { AppState } from '../state.ts';
import { listSaved } from '../storage.ts';
import { romHtml, type RomScenario, type RomTeamMember } from './rom.ts';

const TEAM_KEY = 'sizing.rom-team.v1';
const readTeam = (): RomTeamMember[] => {
  try { const t = JSON.parse(window.localStorage.getItem(TEAM_KEY) ?? '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
};
const saveTeam = (t: RomTeamMember[]) => { try { window.localStorage.setItem(TEAM_KEY, JSON.stringify(t)); } catch { /* per-browser convenience only */ } };

const today = () => new Date().toISOString().slice(0, 10);
const firstOfNextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); };

interface Candidate { id: string; name: string; state: AppState; why?: string }

/** Which scenarios can go into a ROM: Size a workload, self-managed or Elastic Cloud. */
function candidates(current: AppState): Candidate[] {
  const all: Candidate[] = [{ id: 'current', name: `${current.name} (open now)`, state: current }, ...listSaved().map((s) => ({ id: `saved:${s.name}`, name: s.name, state: s.state }))];
  return all.map((c) => (c.state.mode === 'forward' ? c : { ...c, why: 'Only Size a workload scenarios can go into a ROM.' }));
}

/** Builds the Budgetary ROM from chosen scenarios and opens it ready to save as PDF. */
export function RomBuilder({ current, onClose }: { current: AppState; onClose: () => void }) {
  const { set: c } = useConstants();
  const { data } = useEchData();
  const { defaults } = useCostDefaults();
  const options = useMemo(() => candidates(current), [current]);
  const [customer, setCustomer] = useState(current.name === 'Untitled scenario' ? '' : current.name);
  const [date, setDate] = useState(today());
  const [termStart, setTermStart] = useState(firstOfNextMonth());
  const [team, setTeamState] = useState<RomTeamMember[]>(() => (readTeam().length ? readTeam() : [{ name: '', role: 'Solution Architect', email: '' }]));
  const setTeam = (t: RomTeamMember[]) => { setTeamState(t); saveTeam(t); };
  const [picked, setPicked] = useState<Record<string, { title: string; notes: string }>>({ current: { title: current.name, notes: '' } });
  const [error, setError] = useState<string | undefined>();

  const build = (): string | undefined => {
    const scenarios: RomScenario[] = [];
    for (const o of options) {
      const p = picked[o.id];
      if (!p || o.why) continue;
      const s = o.state;
      const title = p.title.trim() || s.name;
      if (s.sizeOn === 'ech') {
        if (!data) { setError(`${title} is an Elastic Cloud scenario, and the Elastic Cloud price data is not loaded in this browser.`); return undefined; }
        const ech = s.ech ?? defaultEch();
        scenarios.push({ kind: 'ech', title, notes: p.notes, ech, data, outcomes: runEch(c, data, ech) });
      } else {
        try {
          const eruPrice = mergeRates(defaults, s.cost?.rates).eruPerYear;
          scenarios.push({ kind: 'self_managed', title, notes: p.notes, workloads: s.forward.workloads, result: forward(s.forward, c), ...(eruPrice !== undefined ? { eruPrice } : {}) });
        } catch (x) {
          setError(`${title} cannot be sized: ${x instanceof Error ? x.message : String(x)}`);
          return undefined;
        }
      }
    }
    if (scenarios.length === 0) { setError('Pick at least one scenario.'); return undefined; }
    setError(undefined);
    return romHtml({ customer: customer.trim(), date, termStart, team: team.filter((m) => m.name.trim()), scenarios });
  };

  const fileName = `Sizing Summary - ${customer.trim() || 'Customer'} - ${date}`;
  const openPrintable = () => {
    const html = build();
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) { setError('The browser blocked the new window. Allow pop-ups for this page, or use Download.'); return; }
    w.document.open();
    w.document.write(html.replace('</body>', '<script>document.fonts.ready.then(() => setTimeout(() => window.print(), 300));</script></body>'));
    w.document.close();
  };
  const downloadHtml = () => { const html = build(); if (html) download(`${slug(fileName)}.html`, html, 'text/html'); };

  const setMember = (i: number, patch: Partial<RomTeamMember>) => setTeam(team.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-labelledby="rom-title">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s"><h2 id="rom-title">Budgetary ROM</h2></EuiTitle>
        <EuiText size="s" color="subdued"><p>A branded rough order of magnitude for the customer: caveats, team, licensing and one section per scenario. It opens ready to save as PDF.</p></EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiFlexGrid columns={3} gutterSize="m">
          <EuiFlexItem><EuiFormRow label="Customer"><EuiFieldText value={customer} onChange={(ev) => setCustomer(ev.target.value)} placeholder="Customer name" /></EuiFormRow></EuiFlexItem>
          <EuiFlexItem><EuiFormRow label="Document date"><EuiFieldText type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></EuiFormRow></EuiFlexItem>
          <EuiFlexItem><EuiFormRow label="Term starts" helpText="Ends one year later."><EuiFieldText type="date" value={termStart} onChange={(ev) => setTermStart(ev.target.value)} /></EuiFormRow></EuiFlexItem>
        </EuiFlexGrid>

        <EuiSpacer size="l" />
        <EuiTitle size="xs"><h3>Scenarios</h3></EuiTitle>
        <EuiText size="xs" color="subdued"><p>Each becomes its own section and licensing table, in this order. The title and note appear in the document.</p></EuiText>
        <EuiSpacer size="s" />
        {options.map((o) => {
          const p = picked[o.id];
          return (
            <EuiPanel key={o.id} hasBorder paddingSize="s" style={{ marginBottom: 8 }}>
              <EuiCheckbox id={`rom-${o.id}`} label={<>{o.name}{o.state.mode === 'forward' ? <EuiText size="xs" color="subdued" component="span"> · {o.state.sizeOn === 'ech' ? 'Elastic Cloud' : 'Self-managed'}</EuiText> : null}</>}
                checked={!!p} disabled={!!o.why}
                onChange={(ev) => setPicked((prev) => { const next = { ...prev }; if (ev.target.checked) next[o.id] = { title: o.state.name, notes: '' }; else delete next[o.id]; return next; })} />
              {o.why && <EuiText size="xs" color="subdued"><p>{o.why}</p></EuiText>}
              {p && (
                <>
                  <EuiSpacer size="s" />
                  <EuiFormRow label="Section title" fullWidth display="rowCompressed">
                    <EuiFieldText compressed fullWidth value={p.title} placeholder="Scenario - Hot, Cold, Frozen (365 DAYS)" onChange={(ev) => setPicked((prev) => ({ ...prev, [o.id]: { ...p, title: ev.target.value } }))} />
                  </EuiFormRow>
                  <EuiFormRow label="Note (optional)" fullWidth display="rowCompressed">
                    <EuiTextArea compressed fullWidth rows={2} value={p.notes} onChange={(ev) => setPicked((prev) => ({ ...prev, [o.id]: { ...p, notes: ev.target.value } }))} />
                  </EuiFormRow>
                </>
              )}
            </EuiPanel>
          );
        })}

        <EuiSpacer size="l" />
        <EuiTitle size="xs"><h3>Team</h3></EuiTitle>
        <EuiText size="xs" color="subdued"><p>Remembered in this browser for the next ROM.</p></EuiText>
        <EuiSpacer size="s" />
        {team.map((m, i) => (
          <EuiFlexGroup key={i} gutterSize="s" alignItems="center" responsive={false} style={{ marginBottom: 6 }}>
            <EuiFlexItem><EuiFieldText compressed aria-label="Name" placeholder="Name" value={m.name} onChange={(ev) => setMember(i, { name: ev.target.value })} /></EuiFlexItem>
            <EuiFlexItem><EuiFieldText compressed aria-label="Role" placeholder="Role" value={m.role} onChange={(ev) => setMember(i, { role: ev.target.value })} /></EuiFlexItem>
            <EuiFlexItem><EuiFieldText compressed aria-label="Email" placeholder="Email" value={m.email} onChange={(ev) => setMember(i, { email: ev.target.value })} /></EuiFlexItem>
            <EuiFlexItem grow={false}><EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${m.name || 'team member'}`} onClick={() => setTeam(team.filter((_, j) => j !== i))} /></EuiFlexItem>
          </EuiFlexGroup>
        ))}
        <EuiButtonEmpty size="s" iconType="plusCircle" onClick={() => setTeam([...team, { name: '', role: '', email: '' }])}>Add team member</EuiButtonEmpty>

        {error && (<><EuiSpacer size="m" /><EuiCallOut size="s" color="danger" iconType="error" title={error} /></>)}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem grow={false}><EuiButtonEmpty onClick={onClose}>Cancel</EuiButtonEmpty></EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}><EuiButtonEmpty iconType="download" onClick={downloadHtml}>Download HTML</EuiButtonEmpty></EuiFlexItem>
              <EuiFlexItem grow={false}><EuiButton fill iconType="document" onClick={openPrintable}>Open and save as PDF</EuiButton></EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
