import {
  EuiBadge, EuiBasicTable, EuiButton, EuiButtonEmpty, EuiButtonGroup, EuiButtonIcon, EuiCallOut, EuiCode, EuiConfirmModal,
  EuiFieldSearch, EuiFlexGroup, EuiFlexItem, EuiLink, EuiPanel, EuiSpacer, EuiText, EuiTitle, EuiToolTip,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { constantFiles, type Constant } from '@sizing/constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConstantEditor } from '../components/ConstantEditor.tsx';
import { CostRatesForm } from '../components/CostRatesForm.tsx';
import { useCostDefaults } from '../costStore.tsx';
import { daysBetween, expiryDate, formatValue, UNCONFIRMED, UNCONFIRMED_HELP } from '../components/constantFormat.ts';
import { localToday, useConstants, type Overrides } from '../constantsStore.tsx';
import { download } from '../export.ts';

const FILE_LABEL: Record<string, string> = {
  'storage.json': 'Storage, index ratios and tier ratios',
  'memory.json': 'Memory and node size defaults',
  'shards.json': 'Shards, master nodes and disk-full limits',
  'overhead.json': 'Supporting nodes (master, Kibana, APM, machine learning, Fleet)',
  'fleet.json': 'Fleet Server capacity (agent management)',
  'knn.json': 'Vector search (search by similarity)',
  'license.json': 'Licensing and minimum license level',
  'ingest.json': 'Ingest speed per processor core',
  'federal.json': 'US government (federal) requirements',
};

/** Default prices for cost estimates. Browser-only: list prices have no public source, so they never go to the repo. */
function CostDefaultsPanel() {
  const { defaults, setDefaults } = useCostDefaults();
  return (
    <EuiPanel hasBorder paddingSize="m">
      <EuiFlexGroup alignItems="baseline" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}><EuiTitle size="xs"><h3>Cost defaults</h3></EuiTitle></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiText size="xs" color="subdued">US dollars · saved in this browser only, never in the project files</EuiText></EuiFlexItem>
      </EuiFlexGroup>
      <EuiText size="xs" color="subdued"><p>Every scenario uses these prices unless it sets its own on the Total cost page. Leave a price blank to leave that item out of the totals.</p></EuiText>
      <EuiSpacer size="s" />
      <CostRatesForm value={defaults} onChange={setDefaults} />
    </EuiPanel>
  );
}

type Filter = 'all' | 'overridden' | 'carried' | 'expiring';
const EXPIRING_DAYS = 60;
/** Survives the dev-server reload that follows a repo write, so the commit hint is still shown. */
const LAST_WRITE = 'sizing.constants.lastWrite';

interface Row { shipped: Constant; current: Constant; overridden: boolean }

type WriteState =
  | { status: 'idle' }
  | { status: 'writing' }
  | { status: 'done'; written: string[] }
  | { status: 'failed'; errors: string[] };

export function ConfigPage() {
  const { overrides, setOverride, revert, replaceAll } = useConstants();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Row | undefined>();
  const [writable, setWritable] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [write, setWrite] = useState<WriteState>(() => {
    try {
      const raw = window.sessionStorage.getItem(LAST_WRITE);
      if (raw) { window.sessionStorage.removeItem(LAST_WRITE); return { status: 'done', written: JSON.parse(raw) as string[] }; }
    } catch { /* storage unavailable */ }
    return { status: 'idle' };
  });
  const [importError, setImportError] = useState<string | undefined>();
  const file = useRef<HTMLInputElement>(null);
  const today = localToday();
  const overrideCount = Object.keys(overrides).length;

  useEffect(() => {
    fetch('/__constants/status')
      .then((r) => (r.ok ? r.json() : undefined))
      .then((j: { writable?: boolean } | undefined) => setWritable(!!j?.writable))
      .catch(() => setWritable(false));
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return constantFiles.map((f) => ({
      file: f.file,
      rows: f.items
        .map((shipped): Row => ({ shipped, current: overrides[shipped.key] ?? shipped, overridden: shipped.key in overrides }))
        .filter((r) => {
          if (q && !`${r.shipped.key} ${r.shipped.notes ?? ''} ${r.shipped.unit}`.toLowerCase().includes(q)) return false;
          if (filter === 'overridden') return r.overridden;
          if (filter === 'carried') return !!r.current.carried_forward;
          if (filter === 'expiring') return daysBetween(today, expiryDate(r.current.as_of_date)) <= EXPIRING_DAYS;
          return true;
        }),
    })).filter((g) => g.rows.length > 0);
  }, [query, filter, overrides, today]);

  const doWrite = async () => {
    setConfirmWrite(false);
    setWrite({ status: 'writing' });
    try {
      const res = await fetch('/__constants/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides: Object.values(overrides) }),
      });
      const body = (await res.json()) as { ok: boolean; errors: string[]; written: string[] };
      if (!body.ok) { setWrite({ status: 'failed', errors: body.errors }); return; }
      // The repo files now hold these values; the dev server reloads the page with them as the shipped set.
      try { window.sessionStorage.setItem(LAST_WRITE, JSON.stringify(body.written)); } catch { /* storage unavailable */ }
      replaceAll({});
      setWrite({ status: 'done', written: body.written });
    } catch (e) {
      setWrite({ status: 'failed', errors: [e instanceof Error ? e.message : String(e)] });
    }
  };

  const importOverrides = async (f: File | undefined) => {
    setImportError(undefined);
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as { overrides?: Constant[] } | Constant[];
      const list = Array.isArray(parsed) ? parsed : parsed.overrides;
      if (!Array.isArray(list)) throw new Error('This is not a file exported from this page');
      const next: Overrides = { ...overrides };
      for (const c of list) if (c && typeof c.key === 'string') next[c.key] = c;
      replaceAll(next);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read that file');
    }
    if (file.current) file.current.value = '';
  };

  const columns: EuiBasicTableColumn<Row>[] = [
    {
      name: 'Name', width: '22em',
      render: (r: Row) => (
        <div>
          <EuiCode>{r.shipped.key}</EuiCode>
          {r.current.notes && <EuiText size="xs" color="subdued"><p>{r.current.notes}</p></EuiText>}
        </div>
      ),
    },
    {
      name: 'Value', width: '16em',
      render: (r: Row) => (
        <div>
          <EuiText size="s"><strong>{formatValue(r.current.value)}</strong> <span style={{ opacity: 0.7 }}>{r.current.unit}</span></EuiText>
          {r.overridden && <EuiText size="xs" color="subdued">original: {formatValue(r.shipped.value)}</EuiText>}
        </div>
      ),
    },
    {
      name: 'Confidence', width: '8em',
      render: (r: Row) => (
        <EuiBadge color={r.current.confidence === 'high' ? 'success' : r.current.confidence === 'medium' ? 'warning' : 'danger'}>{r.current.confidence}</EuiBadge>
      ),
    },
    {
      name: 'Source', width: '18em',
      render: (r: Row) => {
        const expires = expiryDate(r.current.as_of_date);
        const days = daysBetween(today, expires);
        return (
          <div>
            <EuiLink href={r.current.source_url} target="_blank" external>{new URL(r.current.source_url).pathname.split('/').filter(Boolean).pop() ?? 'source'}</EuiLink>
            <EuiText size="xs" color="subdued">checked {r.current.as_of_date} · Elastic {r.current.stack_version}</EuiText>
            {days <= EXPIRING_DAYS && <EuiBadge color={days < 0 ? 'danger' : 'warning'}>{days < 0 ? 'source date too old' : `re-check within ${days} days`}</EuiBadge>}
          </div>
        );
      },
    },
    {
      name: 'Status', width: '10em',
      render: (r: Row) => (
        <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
          {r.overridden && <EuiFlexItem grow={false}><EuiBadge color="primary">changed here</EuiBadge></EuiFlexItem>}
          {r.current.carried_forward && <EuiFlexItem grow={false}><EuiToolTip content={UNCONFIRMED_HELP}><EuiBadge color="hollow">{UNCONFIRMED}</EuiBadge></EuiToolTip></EuiFlexItem>}
        </EuiFlexGroup>
      ),
    },
    {
      name: '', width: '80px', align: 'right',
      render: (r: Row) => (
        <EuiFlexGroup gutterSize="xs" responsive={false} justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiToolTip content="Edit"><EuiButtonIcon iconType="pencil" aria-label={`Edit ${r.shipped.key}`} onClick={() => setEditing(r)} /></EuiToolTip>
          </EuiFlexItem>
          {r.overridden && (
            <EuiFlexItem grow={false}>
              <EuiToolTip content="Go back to the original value"><EuiButtonIcon iconType="refresh" color="danger" aria-label={`Revert ${r.shipped.key}`} onClick={() => revert(r.shipped.key)} /></EuiToolTip>
            </EuiFlexItem>
          )}
        </EuiFlexGroup>
      ),
    },
  ];

  return (
    <>
      <EuiCallOut size="s" iconType="info" title="How configuration changes work">
        <p>Constants are the fixed numbers the calculator uses. Each one names the source it came from and how much to trust it.</p>
        <ul>
          <li><strong>Apply</strong> uses a new value in this browser straight away. The page header then shows a "changed settings" badge. Results list every changed value in their assumptions and exports.</li>
          <li><strong>Write to repo</strong> saves the applied changes into the project's shared files. It first runs the same checks as the automated build. Commit the files to share them.</li>
          <li>Every change needs a web link (https) to its source and a date within the last 12 months.</li>
          <li><strong>Unconfirmed</strong> values have not been checked against their source since they were carried over from the spec or an earlier version. Most are rules of thumb with no published figure. Confirm them before relying on an estimate that depends on them. Use the Unconfirmed filter below to list them.</li>
        </ul>
      </EuiCallOut>
      <EuiSpacer size="m" />
      <CostDefaultsPanel />
      <EuiSpacer size="l" />

      <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
        <EuiFlexItem style={{ minWidth: 240 }}>
          <EuiFieldSearch compressed fullWidth placeholder="Search names and notes" value={query} onChange={(e) => setQuery(e.target.value)} isClearable />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonGroup legend="Filter" buttonSize="compressed" idSelected={filter} onChange={(id) => setFilter(id as Filter)}
            options={[
              { id: 'all', label: 'All' },
              { id: 'overridden', label: `Changed here (${overrideCount})` },
              { id: 'carried', label: 'Unconfirmed' },
              { id: 'expiring', label: 'Due for re-check' },
            ]} />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty size="s" iconType="export" isDisabled={overrideCount === 0}
            onClick={() => download('constant-overrides.json', JSON.stringify({ exportedAt: new Date().toISOString(), overrides: Object.values(overrides) }, null, 2), 'application/json')}>
            Export changes
          </EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="upload" onClick={() => file.current?.click()}>Import changes</EuiButtonEmpty></EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty size="s" iconType="trash" color="danger" isDisabled={overrideCount === 0} onClick={() => setConfirmDiscard(true)}>Discard all</EuiButtonEmpty>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiToolTip content={writable ? "Save applied changes into the project's shared files" : 'Only available when the app runs on your own computer (pnpm dev)'}>
            <EuiButton size="s" fill iconType="save" isDisabled={!writable || overrideCount === 0} isLoading={write.status === 'writing'} onClick={() => setConfirmWrite(true)}>
              Write {overrideCount || ''} to repo
            </EuiButton>
          </EuiToolTip>
        </EuiFlexItem>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importOverrides(e.target.files?.[0])} />
      </EuiFlexGroup>

      {importError && (<><EuiSpacer size="s" /><EuiCallOut size="s" color="danger" title={`Import failed: ${importError}`} /></>)}
      {write.status === 'done' && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut size="s" color="success" iconType="check" title={write.written.length ? `Saved ${write.written.join(', ')}` : 'Nothing to save: the files already match'}>
            {write.written.length > 0 && <p>Commit the files to share them: <EuiCode>git add packages/constants/data && git commit</EuiCode></p>}
          </EuiCallOut>
        </>
      )}
      {write.status === 'failed' && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut size="s" color="danger" iconType="error" title="Nothing was saved">
            <ul>{write.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </EuiCallOut>
        </>
      )}
      <EuiSpacer size="m" />

      {groups.length === 0 && <EuiText color="subdued"><p>No constants match.</p></EuiText>}
      {groups.map((g) => (
        <div key={g.file}>
          <EuiPanel hasBorder paddingSize="m">
            <EuiFlexGroup alignItems="baseline" gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}><EuiTitle size="xs"><h3>{FILE_LABEL[g.file] ?? g.file}</h3></EuiTitle></EuiFlexItem>
              <EuiFlexItem grow={false}><EuiText size="xs" color="subdued"><EuiCode>data/{g.file}</EuiCode></EuiText></EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="s" />
            <EuiBasicTable<Row> tableCaption={FILE_LABEL[g.file] ?? g.file} items={g.rows} columns={columns} compressed
              rowProps={(r) => ({ style: r.overridden ? { background: 'rgba(11, 100, 221, 0.06)' } : {} })} />
          </EuiPanel>
          <EuiSpacer size="m" />
        </div>
      ))}

      {editing && (
        <ConstantEditor
          shipped={editing.shipped}
          current={editing.current}
          onClose={() => setEditing(undefined)}
          onSave={(c) => { setOverride(c); setEditing(undefined); }}
        />
      )}
      {confirmWrite && (
        <EuiConfirmModal
          title={`Save ${overrideCount} constant${overrideCount === 1 ? '' : 's'} to the project files?`}
          onCancel={() => setConfirmWrite(false)} onConfirm={() => void doWrite()}
          cancelButtonText="Cancel" confirmButtonText="Save files"
        >
          <p>These values will be replaced in the project's shared files. Every result calculated afterwards uses the new values, and its fingerprint (the constants hash) changes.</p>
          <ul>{Object.keys(overrides).map((k) => <li key={k}><EuiCode>{k}</EuiCode></li>)}</ul>
        </EuiConfirmModal>
      )}
      {confirmDiscard && (
        <EuiConfirmModal
          title="Discard all changes in this browser?" buttonColor="danger"
          onCancel={() => setConfirmDiscard(false)} onConfirm={() => { replaceAll({}); setConfirmDiscard(false); }}
          cancelButtonText="Keep" confirmButtonText="Discard"
        >
          <p>The calculator goes back to the original constants. The project files are not touched.</p>
        </EuiConfirmModal>
      )}
    </>
  );
}
