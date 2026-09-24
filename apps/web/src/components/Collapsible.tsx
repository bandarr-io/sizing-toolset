import { EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import { useState, type ReactNode } from 'react';

/** Minimal disclosure section. Renders children only when open, so no height measurement is involved. */
export function Collapsible({ header, extraAction, initialIsOpen = false, children }: {
  header: ReactNode; extraAction?: ReactNode; initialIsOpen?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(initialIsOpen);
  return (
    <>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem>
          <EuiButtonEmpty
            size="s" flush="left" color="text" textProps={false}
            iconType={open ? 'chevronSingleDown' : 'chevronSingleRight'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            style={{ width: '100%' }}
            contentProps={{ style: { justifyContent: 'flex-start' } }}
          >
            {header}
          </EuiButtonEmpty>
        </EuiFlexItem>
        {extraAction && <EuiFlexItem grow={false}>{extraAction}</EuiFlexItem>}
      </EuiFlexGroup>
      {open && <><EuiSpacer size="s" />{children}</>}
    </>
  );
}
