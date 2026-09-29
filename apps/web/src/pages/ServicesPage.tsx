import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiCallOut, EuiFieldNumber, EuiFieldText, EuiFlexGroup, EuiFlexItem, EuiPanel,
  EuiSelect, EuiSpacer, EuiSwitch, EuiText, EuiTextArea, EuiTitle,
} from '@elastic/eui';
import { useRef, useState } from 'react';
import { download, slug } from '../export.ts';
import { fmtMoney } from '../format.ts';
import {
  BILLING_LABEL, newServiceId, parseCatalog, priceLines, type ScenarioServices, type ServiceBilling, type ServiceItem, type ServiceLine,
} from '../services.ts';
import { useServiceCatalog } from '../servicesStore.tsx';
import type { AppState } from '../state.ts';

type Setter = (f: (s: AppState) => AppState) => void;
const cell = { padding: '6px 6px', verticalAlign: 'top' as const };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };
const num = (v: string) => (v === '' ? undefined : Number(v));

/** D46: services for this scenario, and the catalog of services with default prices (kept in this browser). */
export function ServicesPage({ state, setState }: { state: AppState; setState: Setter }) {
  const { catalog, setCatalog } = useServiceCatalog();
  const services: ScenarioServices = state.services ?? { lines: [] };
  const setLines = (lines: ServiceLine[]) => setState((s) => ({ ...s, services: { lines } }));
  const priced = priceLines(catalog, services);
  const oneTime = priced.filter((p) => p.item?.billing === 'one_time').reduce((s, p) => s + (p.total ?? 0), 0);
  const perYear = priced.filter((p) => p.item?.billing === 'annual').reduce((s, p) => s + (p.total ?? 0), 0);
  const unpriced = priced.filter((p) => p.item && p.total === undefined).map((p) => p.item!.name);

  return (
    <>
      <EuiCallOut size="s" iconType="documentation" title={`Services for "${state.name}"`}>
        <p>Consulting, support and training sold with this scenario. They add to Total cost (one-time services in year 1, yearly ones every year) and appear in the exports and the Budgetary ROM. Prices come from the catalog below unless you set one here.</p>
      </EuiCallOut>
      <EuiSpacer size="m" />
      <EuiPanel hasBorder paddingSize="l">
        <EuiTitle size="s"><h2>This scenario</h2></EuiTitle>
        <EuiSpacer size="s" />
        {services.lines.length === 0
          ? <EuiText size="s" color="subdued"><p>No services yet.</p></EuiText>
          : (
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead><tr>
                <th style={head}>Service</th><th style={{ ...head, width: 120 }}>Quantity</th><th style={{ ...head, width: 170 }}>Price per unit</th>
                <th style={head}>Billed</th><th style={{ ...head, textAlign: 'right' }}>Total</th><th style={{ ...head, width: 36 }} />
              </tr></thead>
              <tbody>
                {priced.map((p, i) => (
                  <tr key={i}>
                    <td style={cell}>
                      <EuiSelect compressed aria-label="Service" value={p.line.serviceId}
                        options={[...catalog.map((x) => ({ value: x.id, text: x.name })), ...(p.item ? [] : [{ value: p.line.serviceId, text: `${p.line.serviceId} (no longer in the catalog)` }])]}
                        onChange={(e) => setLines(services.lines.map((l, j) => (j === i ? { ...l, serviceId: e.target.value } : l)))} />
                    </td>
                    <td style={cell}>
                      <EuiFieldNumber compressed aria-label="Quantity" min={0} value={p.line.quantity} append={p.item?.unit ? `${p.item.unit}${p.line.quantity === 1 ? "" : "s"}` : undefined}
                        onChange={(e) => setLines(services.lines.map((l, j) => (j === i ? { ...l, quantity: num(e.target.value) ?? 0 } : l)))} />
                    </td>
                    <td style={cell}>
                      <EuiFieldNumber compressed aria-label="Price per unit" prepend="$" min={0} value={p.line.unitPrice ?? ''} placeholder={p.item?.unitPrice !== undefined ? String(p.item.unitPrice) : 'not set'}
                        onChange={(e) => setLines(services.lines.map((l, j) => { if (j !== i) return l; const { unitPrice: _drop, ...rest } = l; const v = num(e.target.value); return v === undefined ? rest : { ...rest, unitPrice: v }; }))} />
                    </td>
                    <td style={cell}><EuiText size="s">{p.item ? BILLING_LABEL[p.item.billing] : ''}</EuiText></td>
                    <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{p.total === undefined ? '–' : fmtMoney(p.total)}</EuiText></td>
                    <td style={cell}><EuiButtonIcon iconType="trash" color="danger" aria-label="Remove service" onClick={() => setLines(services.lines.filter((_, j) => j !== i))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <EuiSpacer size="s" />
        <EuiButtonEmpty size="s" iconType="plusCircle" isDisabled={catalog.length === 0}
          onClick={() => setLines([...services.lines, { serviceId: catalog[0]!.id, quantity: 1 }])}>Add a service</EuiButtonEmpty>
        {services.lines.length > 0 && (
          <EuiText size="s"><p><strong>{fmtMoney(oneTime)}</strong> once and <strong>{fmtMoney(perYear)}</strong> a year.{unpriced.length ? ` Not priced yet: ${unpriced.join(', ')}.` : ''}</p></EuiText>
        )}
      </EuiPanel>
      <EuiSpacer size="l" />
      <Catalog catalog={catalog} setCatalog={setCatalog} scenarioName={state.name} />
    </>
  );
}

function Catalog({ catalog, setCatalog, scenarioName }: { catalog: ServiceItem[]; setCatalog: (c: ServiceItem[]) => void; scenarioName: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [open, setOpen] = useState<string | undefined>();
  const set = (i: number, patch: Partial<ServiceItem>) => setCatalog(catalog.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x, ...patch };
    if (next.unitPrice === undefined) delete next.unitPrice;
    return next;
  }));
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = parseCatalog(JSON.parse(await f.text()));
      if (!parsed) throw new Error('this is not a service catalog export');
      const ids = new Set(parsed.map((p) => p.id));
      setCatalog([...catalog.filter((c) => !ids.has(c.id)), ...parsed]);
      setError(undefined);
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    }
    if (file.current) file.current.value = '';
  };

  return (
    <EuiPanel hasBorder paddingSize="l">
      <EuiFlexGroup alignItems="baseline" justifyContent="spaceBetween" wrap>
        <EuiFlexItem grow={false}>
          <EuiTitle size="s"><h2>Service catalog</h2></EuiTitle>
          <EuiText size="xs" color="subdued"><p>Default prices and descriptions for every scenario, kept in this browser. Export it to share with the team.</p></EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="export" onClick={() => download(`${slug(scenarioName)}-service-catalog.json`, JSON.stringify({ services: catalog }, null, 2), 'application/json')}>Export</EuiButtonEmpty></EuiFlexItem>
            <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="upload" onClick={() => file.current?.click()}>Import</EuiButtonEmpty></EuiFlexItem>
          </EuiFlexGroup>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        </EuiFlexItem>
      </EuiFlexGroup>
      {error && (<><EuiSpacer size="s" /><EuiCallOut size="s" color="danger" title={`Import failed: ${error}`} /></>)}
      <EuiSpacer size="m" />
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead><tr>
          <th style={head}>Name</th><th style={{ ...head, width: 150 }}>MPN</th><th style={{ ...head, width: 110 }}>Unit</th>
          <th style={{ ...head, width: 150 }}>Default price</th><th style={{ ...head, width: 130 }}>Billed</th><th style={{ ...head, width: 90 }}>Dates</th><th style={{ ...head, width: 72 }} />
        </tr></thead>
        <tbody>
          {catalog.map((x, i) => (
            <tr key={x.id}>
              <td style={cell} colSpan={1}>
                <EuiFieldText compressed aria-label="Service name" value={x.name} onChange={(e) => set(i, { name: e.target.value })} />
                {open === x.id && (
                  <div style={{ marginTop: 6 }}>
                    <EuiTextArea compressed fullWidth rows={3} aria-label={`${x.name} description`} placeholder="Description printed in the Budgetary ROM"
                      value={x.description} onChange={(e) => set(i, { description: e.target.value })} />
                  </div>
                )}
              </td>
              <td style={cell}><EuiFieldText compressed aria-label="MPN" placeholder="e.g. SV-1D" value={x.mpn} onChange={(e) => set(i, { mpn: e.target.value })} /></td>
              <td style={cell}><EuiFieldText compressed aria-label="Unit" placeholder="hour" value={x.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
              <td style={cell}><EuiFieldNumber compressed aria-label="Default price" prepend="$" min={0} placeholder="not set" value={x.unitPrice ?? ''} onChange={(e) => set(i, { unitPrice: num(e.target.value) })} /></td>
              <td style={cell}>
                <EuiSelect compressed aria-label="Billed" value={x.billing} options={(['one_time', 'annual'] as ServiceBilling[]).map((b) => ({ value: b, text: BILLING_LABEL[b] }))}
                  onChange={(e) => set(i, { billing: e.target.value as ServiceBilling })} />
              </td>
              <td style={cell}><EuiSwitch compressed label="Dates" showLabel={false} checked={x.dated} onChange={(e) => set(i, { dated: e.target.checked })} /></td>
              <td style={cell}>
                <EuiFlexGroup gutterSize="xs" responsive={false}>
                  <EuiFlexItem grow={false}><EuiButtonIcon iconType="documentation" aria-label={`${open === x.id ? 'Hide' : 'Edit'} ${x.name} description`} onClick={() => setOpen(open === x.id ? undefined : x.id)} /></EuiFlexItem>
                  <EuiFlexItem grow={false}><EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${x.name}`} onClick={() => setCatalog(catalog.filter((_, j) => j !== i))} /></EuiFlexItem>
                </EuiFlexGroup>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued"><p>Dates: show the term's start and end dates on this service's line in the ROM (for subscriptions and packages).</p></EuiText>
      <EuiSpacer size="s" />
      <EuiButton size="s" iconType="plusCircle" onClick={() => {
        const id = newServiceId('New service', catalog.map((c) => c.id));
        setCatalog([...catalog, { id, name: 'New service', mpn: '', unit: 'hour', billing: 'one_time', description: '', dated: false }]);
      }}>Add a service to the catalog</EuiButton>
    </EuiPanel>
  );
}
