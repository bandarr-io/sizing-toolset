import {
  EuiButton, EuiButtonEmpty, EuiButtonGroup, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFlexGroup, EuiFlexItem,
  EuiInlineEditText, EuiPopover, EuiText, EuiToolTip,
} from '@elastic/eui';
import { useRef, useState } from 'react';
import { migrate } from '../migrate.ts';
import type { AppState, Mode } from '../state.ts';
import { deleteNamed, listSaved, saveNamed, type SavedScenario } from '../storage.ts';

export function Toolbar({ state, onMode, onRename, onLoad, onReset, onExportMd, onExportJson, canExport }: {
  state: AppState;
  onMode: (m: Mode) => void;
  onRename: (name: string) => void;
  onLoad: (s: AppState) => void;
  onReset: () => void;
  onExportMd: () => void;
  onExportJson: () => void;
  canExport: boolean;
}) {
  const [saved, setSaved] = useState<SavedScenario[]>(() => listSaved());
  const [openList, setOpenList] = useState(false);
  const [openExport, setOpenExport] = useState(false);
  const [openMore, setOpenMore] = useState(false);
  const [flash, setFlash] = useState<string | undefined>();
  const file = useRef<HTMLInputElement>(null);
  const say = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(undefined), 2500); };

  const importJson = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as { scenario?: unknown };
      const s = migrate(parsed.scenario ?? parsed);
      if (s) { onLoad(s); say(`Imported "${s.name}"`); } else say('Not a scenario export');
    } catch {
      say('Could not read that file');
    }
    if (file.current) file.current.value = '';
  };

  return (
    <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" gutterSize="m" wrap>
      <EuiFlexItem grow={false}>
        <EuiButtonGroup
          legend="What are you doing?" buttonSize="m" color="primary" idSelected={state.mode} onChange={(id) => onMode(id as Mode)}
          options={[
            { id: 'forward', label: 'Size a workload', iconType: 'logoElasticsearch' },
            { id: 'reverse', label: 'Test hardware limits', iconType: 'compute' },
            { id: 'multisite', label: 'Multiple sites', iconType: 'globe' },
          ]}
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false} wrap>
          <EuiFlexItem grow={false} style={{ minWidth: 220 }}>
            <EuiInlineEditText key={state.name} inputAriaLabel="Scenario name" size="m" defaultValue={state.name}
              onSave={(v) => { onRename(v.trim() || 'Untitled scenario'); return true; }} />
          </EuiFlexItem>
          {flash && <EuiFlexItem grow={false}><EuiText size="xs" color="success">{flash}</EuiText></EuiFlexItem>}
          <EuiFlexItem grow={false}>
            <EuiButton size="s" iconType="save" onClick={() => { setSaved(saveNamed(state)); say('Saved'); }}>Save</EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiPopover isOpen={openList} closePopover={() => setOpenList(false)} panelPaddingSize="none" anchorPosition="downRight"
              button={<EuiButtonEmpty size="s" iconType="folderOpen" onClick={() => { setSaved(listSaved()); setOpenList(!openList); }}>Open</EuiButtonEmpty>}>
              <EuiContextMenuPanel style={{ minWidth: 300, maxHeight: 380, overflowY: 'auto' }}>
                {saved.length === 0 && <EuiText size="s" style={{ padding: 16 }}><p>No saved scenarios in this browser yet.</p></EuiText>}
                {saved.map((s) => (
                  <EuiFlexGroup key={s.name} gutterSize="xs" alignItems="center" responsive={false} style={{ padding: '6px 12px' }}>
                    <EuiFlexItem>
                      <EuiButtonEmpty size="s" flush="left" onClick={() => { onLoad(s.state); setOpenList(false); }}>{s.name}</EuiButtonEmpty>
                      <EuiText size="xs" color="subdued">{s.savedAt.slice(0, 16).replace('T', ' ')} · {s.state.mode === 'forward' ? 'sizing' : 'hardware limits'}</EuiText>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiButtonIcon iconType="trash" color="danger" aria-label={`Delete ${s.name}`} onClick={() => setSaved(deleteNamed(s.name))} />
                    </EuiFlexItem>
                  </EuiFlexGroup>
                ))}
              </EuiContextMenuPanel>
            </EuiPopover>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiPopover isOpen={openExport} closePopover={() => setOpenExport(false)} panelPaddingSize="none" anchorPosition="downRight"
              button={<EuiButtonEmpty size="s" iconType="export" isDisabled={!canExport} onClick={() => setOpenExport(!openExport)}>Export</EuiButtonEmpty>}>
              <EuiContextMenuPanel items={[
                <EuiContextMenuItem key="md" icon="document" onClick={() => { onExportMd(); setOpenExport(false); }}>Markdown (customer-ready)</EuiContextMenuItem>,
                <EuiContextMenuItem key="json" icon="export" onClick={() => { onExportJson(); setOpenExport(false); }}>JSON (reproducible)</EuiContextMenuItem>,
              ]} />
            </EuiPopover>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiPopover isOpen={openMore} closePopover={() => setOpenMore(false)} panelPaddingSize="none" anchorPosition="downRight"
              button={<EuiToolTip content="More"><EuiButtonIcon iconType="boxesVertical" aria-label="More scenario actions" onClick={() => setOpenMore(!openMore)} /></EuiToolTip>}>
              <EuiContextMenuPanel items={[
                <EuiContextMenuItem key="imp" icon="upload" onClick={() => { file.current?.click(); setOpenMore(false); }}>Import JSON…</EuiContextMenuItem>,
                <EuiContextMenuItem key="reset" icon="refresh" onClick={() => { onReset(); setOpenMore(false); }}>Start over with defaults</EuiContextMenuItem>,
              ]} />
            </EuiPopover>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importJson(e.target.files?.[0])} />
    </EuiFlexGroup>
  );
}
