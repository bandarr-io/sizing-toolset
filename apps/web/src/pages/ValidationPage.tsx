import {
  EuiBadge, EuiButton, EuiButtonEmpty, EuiCallOut, EuiConfirmModal, EuiFieldText, EuiFlexGrid, EuiFlexGroup, EuiFlexItem,
  EuiFlyout, EuiFlyoutBody, EuiFlyoutFooter, EuiFlyoutHeader, EuiFormRow, EuiPanel, EuiSpacer, EuiText, EuiTextArea, EuiTitle,
} from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import type { ForwardRequest, Tier } from '@sizing/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NumField, SelectField } from '../components/Fields.tsx';
import { download } from '../export.ts';
import { fmtNum } from '../format.ts';
import { workloadsSummary, type AppState } from '../state.ts';
import { listSaved } from '../storage.ts';
import {
  compareRecord, loadRecords, mergeRecords, parseRecords, saveRecords, summarize, toCsv, TOLERANCE_PCT, VALIDATION_TIERS,
  type ActualCluster, type Comparison, type ValidationRecord,
} from '../validation.ts';

const TIER_NAME: Record<Tier, string> = { content: 'Content', hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen' };
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const today = () => new Date().toISOString();

function Diff({ r }: { r: Comparison }) {
  if (r.diffPct === undefined) return <EuiText size="xs" color="subdued">no actual</EuiText>;
  const sign = r.diffPct > 0 ? '+' : '';
  return <EuiBadge color={r.within ? 'success' : 'warning'}>{sign}{fmtNum(r.diffPct, 0)}%</EuiBadge>;
}

const cell = { padding: '6px 8px', verticalAlign: 'middle' as const };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };

/** The deals SAs have checked, estimate against actual, with accuracy across all of them. */
export function ValidationPage({ state, constants, onOpen }: { state: AppState; constants: ConstantSet; onOpen: (req: ForwardRequest, name: string) => void }) {
  const [records, setRecords] = useState<ValidationRecord[]>(loadRecords);
  useEffect(() => saveRecords(records), [records]);
  const [editing, setEditing] = useState<ValidationRecord | 'new' | undefined>();
  const [deleting, setDeleting] = useState<ValidationRecord | undefined>();
  const [importError, setImportError] = useState<string | undefined>();
  const file = useRef<HTMLInputElement>(null);
  const summary = useMemo(() => summarize(constants, records), [constants, records]);

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = parseRecords(JSON.parse(await f.text()));
      if (!parsed) throw new Error('this is not a validation sheet export');
      setRecords((rs) => mergeRecords(rs, parsed));
      setImportError(undefined);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
    if (file.current) file.current.value = '';
  };
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <>
      <EuiCallOut size="s" iconType="check" title="Check the calculator against real deals">
        <p>
          Record a deal's workload next to the cluster the customer actually runs. The sheet shows how far the estimate is from reality,
          deal by deal and overall. A gap within ±{TOLERANCE_PCT}% counts as close. Estimates are worked out again with today's settings,
          so changing a setting on the Configurations page shows at once whether accuracy got better or worse.
        </p>
        <p>
          Records are kept in this browser. Export them to share with the team, and import other people's files to pool the results.
        </p>
      </EuiCallOut>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
        <EuiFlexItem grow={false}><EuiButton fill iconType="plusCircle" onClick={() => setEditing('new')}>Add a deal</EuiButton></EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty iconType="export" isDisabled={!records.length} onClick={() => download(`validation-${stamp}.csv`, toCsv(constants, records), 'text/csv')}>Export for a spreadsheet (CSV)</EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty iconType="export" isDisabled={!records.length}
            onClick={() => download(`validation-${stamp}.json`, JSON.stringify({ exportedAt: today(), constantsHash: constants.hash, records }, null, 2), 'application/json')}>
            Export to share (JSON)
          </EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem grow={false}><EuiButtonEmpty iconType="upload" onClick={() => file.current?.click()}>Import</EuiButtonEmpty></EuiFlexItem>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
      </EuiFlexGroup>
      {importError && (<><EuiSpacer size="s" /><EuiCallOut size="s" color="danger" title={`Import failed: ${importError}`} /></>)}
      <EuiSpacer size="l" />

      {records.length === 0 ? (
        <EuiPanel hasBorder paddingSize="l">
          <EuiText size="s" color="subdued"><p>No deals yet. Size the workload in the calculator (or save it as a scenario), then add the deal here with the cluster the customer runs.</p></EuiText>
        </EuiPanel>
      ) : (
        <>
          <EuiPanel hasBorder paddingSize="l">
            <EuiTitle size="xs"><h2>How close the calculator is, across {records.length} deal{records.length === 1 ? '' : 's'}</h2></EuiTitle>
            <EuiSpacer size="s" />
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead><tr>
                <th style={head}>Measure</th><th style={{ ...head, textAlign: 'right' }}>Deals</th><th style={{ ...head, textAlign: 'right' }}>Typical gap</th>
                <th style={head}>Tends to</th><th style={{ ...head, textAlign: 'right' }}>Within ±{TOLERANCE_PCT}%</th>
              </tr></thead>
              <tbody>
                {summary.map((m) => (
                  <tr key={m.key}>
                    <td style={cell}><EuiText size="s">{m.label}</EuiText></td>
                    <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{m.deals}</EuiText></td>
                    <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{fmtNum(m.medianAbsDiffPct, 0)}%</EuiText></td>
                    <td style={cell}><EuiText size="s" color="subdued">{Math.abs(m.medianDiffPct) < 1 ? 'match' : m.medianDiffPct > 0 ? 'ask for more than they run' : 'ask for less than they run'}</EuiText></td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      <EuiBadge color={m.withinShare >= 0.8 ? 'success' : m.withinShare >= 0.5 ? 'warning' : 'danger'}>{fmtNum(m.withinShare * 100, 0)}%</EuiBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <EuiSpacer size="s" />
            <EuiText size="xs" color="subdued"><p>Typical gap is the middle value across deals, so one odd deal does not skew it.</p></EuiText>
          </EuiPanel>
          <EuiSpacer size="l" />
          <EuiFlexGrid columns={2} gutterSize="l">
            {records.map((rec) => (
              <EuiFlexItem key={rec.id}>
                <DealCard rec={rec} constants={constants} onEdit={() => setEditing(rec)} onDelete={() => setDeleting(rec)} onOpen={() => onOpen(rec.request, rec.deal)} />
              </EuiFlexItem>
            ))}
          </EuiFlexGrid>
        </>
      )}

      {editing && (
        <DealForm initial={editing === 'new' ? undefined : editing} current={state}
          onCancel={() => setEditing(undefined)}
          onSave={(rec) => { setRecords((rs) => (rs.some((r) => r.id === rec.id) ? rs.map((r) => (r.id === rec.id ? rec : r)) : [...rs, rec])); setEditing(undefined); }} />
      )}
      {deleting && (
        <EuiConfirmModal title={`Remove ${deleting.deal}?`} onCancel={() => setDeleting(undefined)}
          onConfirm={() => { setRecords((rs) => rs.filter((r) => r.id !== deleting.id)); setDeleting(undefined); }}
          cancelButtonText="Keep it" confirmButtonText="Remove" buttonColor="danger">
          <p>This removes the deal from this browser. Exported files are not affected.</p>
        </EuiConfirmModal>
      )}
    </>
  );
}

function DealCard({ rec, constants, onEdit, onDelete, onOpen }: { rec: ValidationRecord; constants: ConstantSet; onEdit: () => void; onDelete: () => void; onOpen: () => void }) {
  const cmp = compareRecord(constants, rec);
  return (
    <EuiPanel hasBorder paddingSize="m" style={{ height: '100%' }}>
      <EuiFlexGroup gutterSize="s" alignItems="flexStart" responsive={false}>
        <EuiFlexItem>
          <EuiTitle size="xs"><h3>{rec.deal}</h3></EuiTitle>
          <EuiText size="xs" color="subdued"><p>{[rec.checkedBy, rec.addedAt.slice(0, 10), workloadsSummary(rec.request.workloads)].filter(Boolean).join(' · ')}</p></EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="xs" responsive={false}>
            <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" iconType="inspect" onClick={onOpen}>Open</EuiButtonEmpty></EuiFlexItem>
            <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" iconType="pencil" onClick={onEdit}>Edit</EuiButtonEmpty></EuiFlexItem>
            <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" iconType="trash" color="danger" onClick={onDelete}>Remove</EuiButtonEmpty></EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {'error' in cmp ? (
        <EuiCallOut size="s" color="danger" title={`Cannot calculate: ${cmp.error}`} />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead><tr>
            <th style={head}>Measure</th><th style={{ ...head, textAlign: 'right' }}>Estimate</th><th style={{ ...head, textAlign: 'right' }}>Actual</th><th style={{ ...head, textAlign: 'right' }}>Gap</th>
          </tr></thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.key}>
                <td style={cell}><EuiText size="s">{r.label}</EuiText></td>
                <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{fmtNum(r.estimated, 0)}</EuiText></td>
                <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{r.actual === undefined ? '–' : fmtNum(r.actual, 0)}</EuiText></td>
                <td style={{ ...cell, textAlign: 'right' }}><Diff r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rec.notes && (<><EuiSpacer size="s" /><EuiText size="xs" color="subdued"><p>{rec.notes}</p></EuiText></>)}
    </EuiPanel>
  );
}

const KEEP = '__keep__';
const CURRENT = '__current__';

function DealForm({ initial, current, onCancel, onSave }: {
  initial: ValidationRecord | undefined; current: AppState; onCancel: () => void; onSave: (r: ValidationRecord) => void;
}) {
  const saved = useMemo(() => listSaved(), []);
  const [deal, setDeal] = useState(initial?.deal ?? '');
  const [checkedBy, setCheckedBy] = useState(initial?.checkedBy ?? '');
  const [source, setSource] = useState(initial ? KEEP : CURRENT);
  const [actual, setActual] = useState<ActualCluster>(initial?.actual ?? { nodes: {} });
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const request = (): ForwardRequest => {
    if (source === KEEP && initial) return initial.request;
    if (source === CURRENT) return current.forward;
    return saved.find((s) => s.name === source)?.state.forward ?? current.forward;
  };
  const preview = workloadsSummary(request().workloads);
  const setNodes = (t: Tier, v: number | undefined) => {
    const { [t]: _drop, ...rest } = actual.nodes;
    setActual({ ...actual, nodes: v === undefined ? rest : { ...rest, [t]: v } });
  };
  const setField = (k: 'totalRamGb' | 'eru', v: number | undefined) => {
    const { [k]: _drop, ...rest } = actual;
    setActual(v === undefined ? rest : { ...rest, [k]: v });
  };
  const hasActual = Object.keys(actual.nodes).length > 0 || actual.totalRamGb !== undefined || actual.eru !== undefined;
  const valid = deal.trim() !== '' && hasActual;

  const options = [
    ...(initial ? [{ value: KEEP, text: 'Keep the inputs already recorded' }] : []),
    { value: CURRENT, text: `Current scenario: ${current.name}` },
    ...saved.map((s) => ({ value: s.name, text: `Saved: ${s.name}` })),
  ];

  return (
    <EuiFlyout onClose={onCancel} size="s" ownFocus aria-labelledby="deal-form-title">
      <EuiFlyoutHeader hasBorder><EuiTitle size="s"><h2 id="deal-form-title">{initial ? `Edit ${initial.deal}` : 'Add a deal'}</h2></EuiTitle></EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiFormRow label="Deal" fullWidth><EuiFieldText fullWidth value={deal} onChange={(e) => setDeal(e.target.value)} placeholder="Customer or opportunity name" /></EuiFormRow>
        <EuiFormRow label="Checked by (optional)" fullWidth><EuiFieldText fullWidth value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /></EuiFormRow>
        <SelectField label="Workload inputs from" value={source} options={options} onChange={setSource}
          helpText={<>Uses the Size a workload inputs. {preview}.</>} />
        <EuiSpacer size="l" />
        <EuiTitle size="xxs"><h3>What the customer actually runs</h3></EuiTitle>
        <EuiText size="xs" color="subdued"><p>Per site. Fill in what you know; blank measures are not compared.</p></EuiText>
        <EuiSpacer size="s" />
        <EuiFlexGrid columns={3} gutterSize="m">
          {VALIDATION_TIERS.map((t) => (
            <EuiFlexItem key={t}><NumField label={`${TIER_NAME[t]} nodes`} value={actual.nodes[t]} optional step={1} onChange={(v) => setNodes(t, v)} /></EuiFlexItem>
          ))}
        </EuiFlexGrid>
        <EuiSpacer size="m" />
        <EuiFlexGrid columns={2} gutterSize="m">
          <EuiFlexItem><NumField label="Total memory" append="GB" value={actual.totalRamGb} optional onChange={(v) => setField('totalRamGb', v)} helpText="All Elasticsearch, Kibana and APM nodes." /></EuiFlexItem>
          <EuiFlexItem><NumField label="License units" append="ERU" value={actual.eru} optional onChange={(v) => setField('eru', v)} helpText="From the order or contract." /></EuiFlexItem>
        </EuiFlexGrid>
        <EuiSpacer size="m" />
        <EuiFormRow label="Notes (optional)" fullWidth>
          <EuiTextArea fullWidth rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything that explains a gap: extra headroom, a planned expansion, a different retention" />
        </EuiFormRow>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween" responsive={false}>
          <EuiFlexItem grow={false}><EuiButtonEmpty onClick={onCancel}>Cancel</EuiButtonEmpty></EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton fill isDisabled={!valid} onClick={() => onSave({
              id: initial?.id ?? newId(), deal: deal.trim(), addedAt: initial?.addedAt ?? today(), request: request(), actual,
              ...(checkedBy.trim() ? { checkedBy: checkedBy.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
            })}>{initial ? 'Save changes' : 'Add deal'}</EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
