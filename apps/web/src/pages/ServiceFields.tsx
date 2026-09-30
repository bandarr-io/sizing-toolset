import {
  EuiButtonEmpty, EuiButtonIcon, EuiComboBox, EuiFieldNumber, EuiFieldText, EuiFlexGrid, EuiFlexItem, EuiFormRow, EuiSelect, EuiText, EuiTextArea,
} from '@elastic/eui';
import {
  BUILTIN_FIELDS, FIELD_KIND_LABEL, fieldValue, fillDescription, type DescriptionContext, type FieldValue, type ServiceField, type ServiceFieldKind,
  type ServiceItem, type ServiceLine,
} from '../services.ts';

const asList = (v: FieldValue) => (Array.isArray(v) ? v : v ? [v] : []);
const asText = (v: FieldValue) => (Array.isArray(v) ? v.join(', ') : v);

/** One input for a field's value; used for a scenario's value and for the catalog default. */
function ValueInput({ field, value, onChange, label }: { field: ServiceField; value: FieldValue; onChange: (v: FieldValue) => void; label: string }) {
  switch (field.kind) {
    case 'many': {
      const picked = asList(value);
      const options = [...new Set([...field.choices, ...picked])].map((c) => ({ label: c }));
      return (
        <EuiComboBox compressed fullWidth aria-label={label} options={options} selectedOptions={picked.map((c) => ({ label: c }))}
          onChange={(sel) => onChange(sel.map((o) => o.label))}
          onCreateOption={(v) => { const t = v.trim(); if (t && !picked.includes(t)) onChange([...picked, t]); }}
          customOptionText="Add {searchValue}" />
      );
    }
    case 'one':
      return <EuiSelect compressed fullWidth aria-label={label} value={asText(value)} options={[...new Set([...field.choices, asText(value)])].filter(Boolean).map((c) => ({ value: c, text: c }))} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <EuiFieldNumber compressed fullWidth aria-label={label} value={asText(value)} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <EuiTextArea compressed fullWidth rows={2} aria-label={label} value={asText(value)} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** A scenario's values for a service's fields, with a preview of the description as the ROM prints it. */
export function LineFields({ item, line, ctx, onChange }: { item: ServiceItem; line: ServiceLine; ctx: DescriptionContext; onChange: (values: ServiceLine['values']) => void }) {
  const fields = item.fields ?? [];
  const set = (key: string, v: FieldValue) => onChange({ ...line.values, [key]: v });
  const custom = Object.keys(line.values ?? {}).length > 0;
  return (
    <div style={{ padding: '4px 6px 12px' }}>
      {fields.length > 0 && (
        <EuiFlexGrid columns={2} gutterSize="s">
          {fields.map((f) => (
            <EuiFlexItem key={f.key}>
              <EuiFormRow label={f.label} fullWidth display="rowCompressed" helpText={f.kind === 'many' ? 'Pick from the list, or type to add one for this deal.' : undefined}>
                <ValueInput field={f} value={fieldValue(f, line)} onChange={(v) => set(f.key, v)} label={f.label} />
              </EuiFormRow>
            </EuiFlexItem>
          ))}
        </EuiFlexGrid>
      )}
      {custom && <EuiButtonEmpty size="xs" iconType="refresh" onClick={() => onChange(undefined)}>Use the catalog defaults</EuiButtonEmpty>}
      {item.description.trim() && (
        <>
          <EuiText size="xs" color="subdued" style={{ marginTop: 8 }}><strong>As printed in the ROM: {item.title?.trim() || item.name}</strong></EuiText>
          <EuiText size="xs"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, padding: 0, maxHeight: 220, overflow: 'auto', background: 'transparent' }}>{fillDescription(item, line, ctx)}</pre></EuiText>
        </>
      )}
    </div>
  );
}

const fieldKey = (label: string, taken: readonly string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
};

/** The catalog's fields for one service: what each scenario fills in. */
export function FieldsEditor({ item, onChange }: { item: ServiceItem; onChange: (fields: ServiceField[]) => void }) {
  const fields = item.fields ?? [];
  const set = (i: number, patch: Partial<ServiceField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setKind = (i: number, kind: ServiceFieldKind) => {
    const f = fields[i]!;
    const d = f.default;
    set(i, { kind, default: kind === 'many' ? asList(d) : asText(d) });
  };
  return (
    <div style={{ marginTop: 8 }}>
      <EuiText size="xs"><strong>Fill-in fields</strong></EuiText>
      <EuiText size="xs" color="subdued">
        <p>Write {'{key}'} in the description where the value goes; each scenario sets its own value on this tab. A pick-several field alone on its line prints as bullets. Always available: {BUILTIN_FIELDS.map((b) => `{${b.key}} (${b.label})`).join(', ')}.</p>
      </EuiText>
      {fields.map((f, i) => (
        <div key={i} style={{ borderLeft: '2px solid #D3DAE6', padding: '4px 0 4px 8px', margin: '6px 0' }}>
          <EuiFlexGrid columns={3} gutterSize="s">
            <EuiFlexItem><EuiFormRow label="Label" display="rowCompressed"><EuiFieldText compressed value={f.label} onChange={(e) => set(i, { label: e.target.value })} /></EuiFormRow></EuiFlexItem>
            <EuiFlexItem><EuiFormRow label="Key" display="rowCompressed" helpText={`Use {${f.key}}`}><EuiFieldText compressed value={f.key} onChange={(e) => set(i, { key: e.target.value.replace(/[^\w-]/g, '') })} /></EuiFormRow></EuiFlexItem>
            <EuiFlexItem>
              <EuiFormRow label="Type" display="rowCompressed">
                <EuiSelect compressed value={f.kind} options={(Object.keys(FIELD_KIND_LABEL) as ServiceFieldKind[]).map((k) => ({ value: k, text: FIELD_KIND_LABEL[k] }))} onChange={(e) => setKind(i, e.target.value as ServiceFieldKind)} />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGrid>
          <EuiFlexGrid columns={2} gutterSize="s">
            {(f.kind === 'many' || f.kind === 'one') && (
              <EuiFlexItem>
                <EuiFormRow label="Choices (one per line)" display="rowCompressed" fullWidth>
                  <EuiTextArea compressed fullWidth rows={4} value={f.choices.join('\n')} onChange={(e) => set(i, { choices: e.target.value.split('\n').map((c) => c.trimStart()) })}
                    onBlur={() => set(i, { choices: f.choices.map((c) => c.trim()).filter(Boolean) })} />
                </EuiFormRow>
              </EuiFlexItem>
            )}
            <EuiFlexItem>
              <EuiFormRow label="Default" display="rowCompressed" fullWidth>
                <ValueInput field={f} value={f.default} onChange={(v) => set(i, { default: v })} label={`${f.label} default`} />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGrid>
          <EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove field ${f.label}`} onClick={() => onChange(fields.filter((_, j) => j !== i))} />
        </div>
      ))}
      <EuiButtonEmpty size="xs" iconType="plusCircle" onClick={() => onChange([...fields, { key: fieldKey('New field', fields.map((f) => f.key)), label: 'New field', kind: 'many', choices: [], default: [] }])}>Add a field</EuiButtonEmpty>
    </div>
  );
}
