import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiCallOut, EuiCode, EuiFieldNumber, EuiFieldText, EuiFlexGroup, EuiFlexItem,
  EuiFlyout, EuiFlyoutBody, EuiFlyoutFooter, EuiFlyoutHeader, EuiFormRow, EuiSelect, EuiSpacer, EuiSwitch, EuiText,
  EuiTextArea, EuiTitle,
} from '@elastic/eui';
import type { Confidence, Constant } from '@sizing/constants';
import { useMemo, useState } from 'react';
import { localToday, sameValue, validateDraft } from '../constantsStore.tsx';
import { formatValue } from './constantFormat.ts';

type Scalar = number | string | boolean;

function ScalarInput({ keyName, value, onChange, label }: { keyName: string; value: Scalar; onChange: (v: Scalar) => void; label: string }) {
  if (typeof value === 'boolean') {
    return <EuiSwitch compressed label={label} checked={value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (typeof value === 'number') {
    return (
      <EuiFieldNumber
        compressed aria-label={label} step="any" value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))}
      />
    );
  }
  if (keyName.startsWith('license.floor.')) {
    return (
      <EuiSelect compressed aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        options={['basic', 'platinum', 'enterprise'].map((t) => ({ value: t, text: t }))} />
    );
  }
  return <EuiFieldText compressed aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />;
}

const isScalar = (v: unknown): v is Scalar => ['number', 'string', 'boolean'].includes(typeof v);
const isFlatObject = (v: unknown): v is Record<string, Scalar> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isScalar);

function ValueEditor({ keyName, value, onChange }: { keyName: string; value: unknown; onChange: (v: unknown) => void }) {
  const [json, setJson] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | undefined>();

  if (isScalar(value)) return <ScalarInput keyName={keyName} value={value} onChange={onChange} label="Value" />;

  if (isFlatObject(value)) {
    return (
      <>
        {Object.entries(value).map(([k, v]) => (
          <EuiFormRow key={k} label={k} display="columnCompressed">
            <ScalarInput keyName={keyName} value={v} label={k} onChange={(nv) => onChange({ ...value, [k]: nv })} />
          </EuiFormRow>
        ))}
      </>
    );
  }

  if (Array.isArray(value) && value.length > 0 && value.every(isFlatObject)) {
    const rows = value as Record<string, Scalar>[];
    const cols = Object.keys(rows[0]!);
    return (
      <>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{cols.map((c) => <th key={c} style={{ textAlign: 'left', padding: 4 }}><EuiText size="xs"><strong>{c}</strong></EuiText></th>)}<th /></tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} style={{ padding: 2 }}>
                    <ScalarInput keyName={keyName} value={row[c]!} label={`${c} row ${i + 1}`}
                      onChange={(nv) => onChange(rows.map((r, j) => (j === i ? { ...r, [c]: nv } : r)))} />
                  </td>
                ))}
                <td>
                  <EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove row ${i + 1}`} isDisabled={rows.length === 1}
                    onClick={() => onChange(rows.filter((_, j) => j !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <EuiButtonEmpty size="xs" iconType="plusCircle" onClick={() => onChange([...rows, { ...rows[rows.length - 1]! }])}>Add row</EuiButtonEmpty>
        <EuiText size="xs" color="subdued"><p>Rows are read in order and must stay sorted by their first column.</p></EuiText>
      </>
    );
  }

  return (
    <EuiFormRow label="Value (JSON)" isInvalid={!!jsonError} error={jsonError} fullWidth>
      <EuiTextArea fullWidth rows={10} value={json} isInvalid={!!jsonError} onChange={(e) => {
        setJson(e.target.value);
        try { onChange(JSON.parse(e.target.value)); setJsonError(undefined); } catch { setJsonError('Not valid JSON'); }
      }} />
    </EuiFormRow>
  );
}

export function ConstantEditor({ shipped, current, onSave, onClose }: {
  /** Value from packages/constants/data (validation baseline). */
  shipped: Constant;
  /** Value currently in effect (shipped or this browser's override). */
  current: Constant;
  onSave: (c: Constant) => void;
  onClose: () => void;
}) {
  const today = localToday();
  const [draft, setDraft] = useState<Constant>(() => ({ ...current }));
  const [dateTouched, setDateTouched] = useState(false);
  const set = (patch: Partial<Constant>) => setDraft((d) => ({ ...d, ...patch }));

  const setValue = (value: unknown) => setDraft((d) => {
    const next = { ...d, value };
    // Changing the value is a new claim about the source: date it today unless the date was set by hand.
    if (!dateTouched && !sameValue(value, shipped.value)) {
      next.as_of_date = today;
      next.carried_forward = false;
    }
    return next;
  });

  const errors = useMemo(() => validateDraft(shipped, draft, today), [shipped, draft, today]);
  const unchanged = sameValue(draft, current);

  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-labelledby="edit-constant-title">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s"><h2 id="edit-constant-title">Edit <EuiCode>{shipped.key}</EuiCode></h2></EuiTitle>
        <EuiText size="s" color="subdued">
          <p>Shipped value: <strong>{formatValue(shipped.value)}</strong> {shipped.unit} · as of {shipped.as_of_date}</p>
        </EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiTitle size="xxs"><h3>Value <span style={{ fontWeight: 400 }}>({draft.unit})</span></h3></EuiTitle>
        <EuiSpacer size="s" />
        <ValueEditor keyName={shipped.key} value={draft.value} onChange={setValue} />
        <EuiSpacer size="l" />
        <EuiTitle size="xxs"><h3>Provenance</h3></EuiTitle>
        <EuiText size="xs" color="subdued"><p>Required for every change. These fields are what CI checks and what "show the math" cites.</p></EuiText>
        <EuiSpacer size="s" />
        <EuiFormRow label="Source URL" helpText="https link that supports this value" fullWidth>
          <EuiFieldText fullWidth value={draft.source_url} onChange={(e) => set({ source_url: e.target.value.trim() })} />
        </EuiFormRow>
        <EuiFlexGroup gutterSize="m">
          <EuiFlexItem>
            <EuiFormRow label="As of date" helpText="Must be within the last 12 months">
              <EuiFieldText type="date" value={draft.as_of_date} max={today} onChange={(e) => { setDateTouched(true); set({ as_of_date: e.target.value }); }} />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFormRow label="Confidence">
              <EuiSelect value={draft.confidence} onChange={(e) => set({ confidence: e.target.value as Confidence })}
                options={[{ value: 'high', text: 'High' }, { value: 'medium', text: 'Medium' }, { value: 'low', text: 'Low' }]} />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFormRow label="Stack version">
              <EuiFieldText value={draft.stack_version} onChange={(e) => set({ stack_version: e.target.value })} />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiFormRow hasEmptyLabelSpace={false}>
          <EuiSwitch label="Carried forward (not re-verified against the source)" checked={draft.carried_forward ?? false}
            onChange={(e) => set({ carried_forward: e.target.checked })} />
        </EuiFormRow>
        <EuiFormRow label="Notes" fullWidth>
          <EuiTextArea fullWidth rows={3} value={draft.notes ?? ''} onChange={(e) => {
            const { notes: _drop, ...rest } = draft;
            setDraft(e.target.value ? { ...rest, notes: e.target.value } : rest);
          }} />
        </EuiFormRow>
        {errors.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiCallOut color="danger" iconType="error" size="s" title="Fix before saving">
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </EuiCallOut>
          </>
        )}
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiFlexItem grow={false}><EuiButtonEmpty onClick={onClose}>Cancel</EuiButtonEmpty></EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton fill isDisabled={errors.length > 0 || unchanged} onClick={() => onSave(draft)}>Apply in this browser</EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
