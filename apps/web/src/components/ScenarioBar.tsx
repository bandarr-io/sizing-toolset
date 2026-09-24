import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiContextMenuPanel, EuiFieldText, EuiFlexGroup, EuiFlexItem, EuiPopover, EuiText,
} from '@elastic/eui';
import { useRef, useState } from 'react';
import { deleteNamed, isAppState, listSaved, saveNamed, type SavedScenario } from '../storage.ts';
import type { AppState } from '../state.ts';

export function ScenarioBar({ state, onLoad, onRename, onExportMd, onExportJson, onReset, canExport }: {
  state: AppState;
  onLoad: (s: AppState) => void;
  onRename: (name: string) => void;
  onExportMd: () => void;
  onExportJson: () => void;
  onReset: () => void;
  canExport: boolean;
}) {
  const [saved, setSaved] = useState<SavedScenario[]>(() => listSaved());
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | undefined>();
  const file = useRef<HTMLInputElement>(null);

  const say = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(undefined), 2500); };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as { scenario?: unknown };
      const s = parsed.scenario ?? parsed;
      if (isAppState(s)) { onLoad(s); say(`Imported "${s.name}"`); } else say('Not a scenario export');
    } catch {
      say('Could not read that file');
    }
    if (file.current) file.current.value = '';
  };

  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
      <EuiFlexItem style={{ minWidth: 200 }}>
        <EuiFieldText compressed aria-label="Scenario name" value={state.name} onChange={(e) => onRename(e.target.value)} />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiButton size="s" iconType="save" onClick={() => { setSaved(saveNamed(state)); say(`Saved "${state.name}"`); }}>Save</EuiButton>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiPopover
          isOpen={open} closePopover={() => setOpen(false)} panelPaddingSize="none" anchorPosition="downLeft"
          button={<EuiButtonEmpty size="s" iconType="folderOpen" onClick={() => { setSaved(listSaved()); setOpen(!open); }}>Open ({saved.length})</EuiButtonEmpty>}
        >
          <EuiContextMenuPanel style={{ minWidth: 280, maxHeight: 360, overflowY: 'auto' }}>
            {saved.length === 0 && <EuiText size="s" style={{ padding: 12 }}><p>No saved scenarios in this browser.</p></EuiText>}
            {saved.map((s) => (
              <EuiFlexGroup key={s.name} gutterSize="xs" alignItems="center" responsive={false} style={{ padding: '4px 8px' }}>
                <EuiFlexItem>
                  <EuiButtonEmpty size="s" flush="left" onClick={() => { onLoad(s.state); setOpen(false); }}>{s.name}</EuiButtonEmpty>
                  <EuiText size="xs" color="subdued">{s.savedAt.slice(0, 16).replace('T', ' ')} · {s.state.mode}</EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonIcon iconType="trash" color="danger" aria-label={`Delete ${s.name}`} onClick={() => setSaved(deleteNamed(s.name))} />
                </EuiFlexItem>
              </EuiFlexGroup>
            ))}
          </EuiContextMenuPanel>
        </EuiPopover>
      </EuiFlexItem>
      <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="upload" onClick={() => file.current?.click()}>Import</EuiButtonEmpty></EuiFlexItem>
      <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="document" isDisabled={!canExport} onClick={onExportMd}>Markdown</EuiButtonEmpty></EuiFlexItem>
      <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="export" isDisabled={!canExport} onClick={onExportJson}>JSON</EuiButtonEmpty></EuiFlexItem>
      <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="refresh" color="text" onClick={onReset}>Reset</EuiButtonEmpty></EuiFlexItem>
      {flash && <EuiFlexItem grow={false}><EuiText size="xs" color="success">{flash}</EuiText></EuiFlexItem>}
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importJson(e.target.files?.[0])} />
    </EuiFlexGroup>
  );
}
