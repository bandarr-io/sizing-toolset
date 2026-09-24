import { EuiFieldNumber, EuiFormRow, EuiSelect, EuiSwitch } from '@elastic/eui';
import type { ReactNode } from 'react';

interface NumProps {
  label: ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  step?: number | 'any';
  append?: string;
  prepend?: string;
  helpText?: ReactNode;
  placeholder?: string;
  /** Optional fields turn an empty box into `undefined` (engine default); required ones into 0. */
  optional?: boolean;
  compressed?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

export function NumField({ label, value, onChange, min = 0, step = 'any', append, prepend, helpText, placeholder, optional, compressed, disabled, ...rest }: NumProps) {
  const input = (
    <EuiFieldNumber
      compressed={compressed}
      fullWidth
      disabled={disabled}
      aria-label={rest['aria-label'] ?? (typeof label === 'string' ? label : undefined)}
      value={value === undefined || Number.isNaN(value) ? '' : value}
      min={min}
      step={step}
      placeholder={placeholder}
      append={append}
      prepend={prepend}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') onChange(optional ? undefined : 0);
        else if (!Number.isNaN(Number(raw))) onChange(Number(raw));
      }}
    />
  );
  if (label === null) return input;
  return (
    <EuiFormRow label={label} helpText={helpText} display={compressed ? 'rowCompressed' : 'row'} fullWidth>
      {input}
    </EuiFormRow>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, helpText, compressed }: {
  label: ReactNode; value: T; options: { value: T; text: string; disabled?: boolean }[]; onChange: (v: T) => void; helpText?: ReactNode; compressed?: boolean;
}) {
  const input = <EuiSelect compressed={compressed} fullWidth aria-label={typeof label === 'string' ? label : undefined} value={value} options={options} onChange={(e) => onChange(e.target.value as T)} />;
  if (label === null) return input;
  return <EuiFormRow label={label} helpText={helpText} display={compressed ? 'rowCompressed' : 'row'} fullWidth>{input}</EuiFormRow>;
}

export function SwitchField({ label, checked, onChange, helpText, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; helpText?: ReactNode; disabled?: boolean;
}) {
  return (
    <EuiFormRow hasEmptyLabelSpace={false} helpText={helpText} fullWidth>
      <EuiSwitch label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </EuiFormRow>
  );
}
