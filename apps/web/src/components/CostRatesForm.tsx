import { EuiFlexGrid, EuiFlexItem, EuiSpacer, EuiTitle } from '@elastic/eui';
import type { ReactNode } from 'react';
import type { CostRates, DiskKind } from '../cost.ts';
import { NumField } from './Fields.tsx';

type Scalar = Exclude<keyof CostRates, 'diskPerTb'>;

/**
 * All cost inputs in one form. With `fallback`, blank fields show the default as a placeholder
 * and stay blank in `value` (the scenario then uses the default).
 */
export function CostRatesForm({ value, onChange, fallback, subscriptionOnly = false }: {
  value: CostRates;
  onChange: (r: CostRates) => void;
  fallback?: CostRates;
  subscriptionOnly?: boolean;
}) {
  const set = (k: Scalar, v: number | undefined) => {
    const next = { ...value };
    if (v === undefined) delete next[k]; else next[k] = v;
    onChange(next);
  };
  const setDisk = (t: DiskKind, v: number | undefined) => {
    const disk = { ...value.diskPerTb };
    if (v === undefined) delete disk[t]; else disk[t] = v;
    const { diskPerTb: _drop, ...rest } = value;
    onChange(Object.keys(disk).length ? { ...rest, diskPerTb: disk } : rest);
  };
  const hint = (v: number | undefined) => (v === undefined ? 'not set' : String(v));
  const field = (k: Scalar, label: string, unit: { prepend?: string; append?: string }, helpText?: ReactNode) => (
    <EuiFlexItem>
      <NumField label={label} value={value[k]} optional min={0} {...unit} helpText={helpText}
        placeholder={fallback ? hint(fallback[k]) : ''} onChange={(v) => set(k, v)} />
    </EuiFlexItem>
  );
  const disk = (t: DiskKind, label: string) => (
    <EuiFlexItem>
      <NumField label={`${label} disk, per TB`} value={value.diskPerTb?.[t]} optional min={0} prepend="$"
        placeholder={fallback ? hint(fallback.diskPerTb?.[t]) : ''} onChange={(v) => setDisk(t, v)} />
    </EuiFlexItem>
  );
  const heading = (text: string) => <><EuiSpacer size="m" /><EuiTitle size="xxs"><h3>{text}</h3></EuiTitle><EuiSpacer size="s" /></>;

  const subscription = field('eruPerYear', 'Subscription, per ERU per year', { prepend: '$' }, 'Enterprise. Basic has no subscription.');
  if (subscriptionOnly) return <div>{subscription}</div>;
  return (
    <>
      <EuiFlexGrid columns={3} gutterSize="m">{subscription}</EuiFlexGrid>
      {heading('Hardware')}
      <EuiFlexGrid columns={3} gutterSize="m">
        {field('serverPerGbRam', 'Server, per GB RAM', { prepend: '$' }, 'Chassis, CPU and memory together.')}
        {field('amortYears', 'Amortization', { append: 'years' })}
        <EuiFlexItem />
        {disk('nvme', 'NVMe')}
        {disk('ssd', 'SSD')}
        {disk('hdd', 'HDD')}
      </EuiFlexGrid>
      {heading('Running costs')}
      <EuiFlexGrid columns={3} gutterSize="m">
        {field('objectPerTbMonth', 'Object storage, per TB-month', { prepend: '$' })}
        {field('hostingPerNodeMonth', 'Hosting, per node-month', { prepend: '$' }, 'Rack, power, cooling, network.')}
        <EuiFlexItem />
        {field('opsFte', 'Operations staff', { append: 'FTE' })}
        {field('opsCostPerFte', 'Cost per FTE, per year', { prepend: '$' }, 'Fully loaded.')}
      </EuiFlexGrid>
    </>
  );
}
