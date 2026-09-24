import { EuiFieldNumber, EuiFormRow, EuiSelect, EuiSwitch } from '@elastic/eui';
import type { ReactNode } from 'react';

interface NumProps {
  label: ReactNode;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  step?: number | 'any';
  append?: string;
  helpText?: ReactNode;
  placeholder?: string;
  /** Optional fields turn an empty box into `undefined` (engine default); required ones into 0. */
  optional?: boolean;
}

export function NumField({ label, value, onChange, min = 0, step = 'any', append, helpText, placeholder, optional }: NumProps) {
  return (
    <EuiFormRow label={label} helpText={helpText} display="rowCompressed" fullWidth>
      <EuiFieldNumber
        compressed
        fullWidth
        value={value === undefined || Number.isNaN(value) ? '' : value}
        min={min}
        step={step}
        placeholder={placeholder}
        append={append}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') onChange(optional ? undefined : 0);
          else if (!Number.isNaN(Number(raw))) onChange(Number(raw));
        }}
      />
    </EuiFormRow>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, helpText }: {
  label: ReactNode; value: T; options: { value: T; text: string; disabled?: boolean }[]; onChange: (v: T) => void; helpText?: ReactNode;
}) {
  return (
    <EuiFormRow label={label} helpText={helpText} display="rowCompressed" fullWidth>
      <EuiSelect compressed fullWidth value={value} options={options} onChange={(e) => onChange(e.target.value as T)} />
    </EuiFormRow>
  );
}

export function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <EuiFormRow display="rowCompressed" hasEmptyLabelSpace={false} fullWidth>
      <EuiSwitch compressed label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </EuiFormRow>
  );
}
