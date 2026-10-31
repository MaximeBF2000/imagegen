'use client';

import { Folder as FolderIcon, FolderInput, FolderMinus, FolderPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useFolderActions, useFolders } from '@/lib/queries';
import { useUi } from '@/lib/store';
import type { Folder } from '@/lib/types';
import { Button, MenuItem, MenuLabel, MenuSeparator, MenuSub, Modal, Spinner } from './ui/primitives';

type DialogState =
  | { mode: 'create'; onCreated?: (folder: Folder) => void }
  | { mode: 'rename'; folder: Folder }
  | { mode: 'delete'; folder: Folder }
  | null;

/** Global folder dialogs so any menu can trigger them. */
export const useFolderDialog = create<{ state: DialogState; open: (s: DialogState) => void; close: () => void }>((set) => ({
  state: null,
  open: (state) => set({ state }),
  close: () => set({ state: null }),
}));

export function FolderDialogs() {
  const { state, close } = useFolderDialog();
  const actions = useFolderActions();
  const setFolder = useUi((s) => s.setFolder);
  const currentFolder = useUi((s) => s.folder);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state?.mode === 'rename') setName(state.folder.name);
    else setName('');
  }, [state]);

  const submitName = async () => {
    if (!state || !name.trim() || busy) return;
    setBusy(true);
    try {
      if (state.mode === 'create') {
        const folder = await actions.create(name.trim());
        if (folder) {
          if (state.onCreated) state.onCreated(folder);
          else setFolder(folder.id);
          close();
        }
      } else if (state.mode === 'rename') {
        await actions.rename(state.folder.id, name.trim());
        close();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (deleteImages: boolean) => {
    if (state?.mode !== 'delete') return;
    setBusy(true);
    await actions.remove(state.folder.id, deleteImages);
    if (currentFolder === state.folder.id) setFolder('all');
    setBusy(false);
    close();
  };

  return (
    <>
      <Modal
        open={state?.mode === 'create' || state?.mode === 'rename'}
        onOpenChange={(v) => !v && close()}
        title={state?.mode === 'rename' ? 'Rename folder' : 'New folder'}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitName();
          }}
        >
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product shots"
            className="h-10 w-full rounded-lg border border-line-strong bg-bg px-3 text-sm outline-none placeholder:text-subtle focus:border-accent/50"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
              {busy && <Spinner />}
              {state?.mode === 'rename' ? 'Rename' : 'Create folder'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={state?.mode === 'delete'}
        onOpenChange={(v) => !v && close()}
        title={state?.mode === 'delete' ? `Delete “${state.folder.name}”?` : ''}
        description={
          state?.mode === 'delete' &&
          (state.folder.imageCount
            ? `This folder contains ${state.folder.imageCount} image${state.folder.imageCount > 1 ? 's' : ''}.`
            : 'This folder is empty.')
        }
      >
        <div className="flex flex-col gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => remove(false)} className="justify-start">
            <FolderMinus className="h-4 w-4" /> Delete folder, keep images
          </Button>
          {state?.mode === 'delete' && state.folder.imageCount > 0 && (
            <Button variant="danger" disabled={busy} onClick={() => remove(true)} className="justify-start border border-danger/20">
              <FolderMinus className="h-4 w-4" /> Delete folder and its {state.folder.imageCount} images
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

interface MoveProps {
  jobIds: string[];
  /** Folder the images are in (undefined = mixed / unknown). */
  currentFolderId?: string | null;
  onMoved?: () => void;
}

/** "Move to folder" submenu for any dropdown menu. */
export function MoveToFolderSub(props: MoveProps) {
  const n = props.jobIds.length;
  return (
    <MenuSub icon={<FolderInput />} label={n > 1 ? `Move ${n} images to…` : 'Move to folder…'}>
      <MoveToFolderItems {...props} />
    </MenuSub>
  );
}

/** Folder targets as plain menu items. */
export function MoveToFolderItems({ jobIds, currentFolderId, onMoved }: MoveProps) {
  const { data } = useFolders();
  const actions = useFolderActions();
  const openDialog = useFolderDialog((s) => s.open);
  const move = async (folder: Folder | null) => {
    if (await actions.move(jobIds, folder?.id ?? null, folder?.name)) onMoved?.();
  };
  return (
    <>
      <MenuLabel>Move to folder</MenuLabel>
      {data?.items.map((f) => (
        <MenuItem key={f.id} icon={<FolderIcon />} disabled={f.id === currentFolderId} onSelect={() => move(f)}>
          <span className="flex items-center justify-between gap-3">
            <span className="truncate">{f.name}</span>
            <span className="text-xs tabular-nums text-subtle">{f.imageCount}</span>
          </span>
        </MenuItem>
      ))}
      {!data?.items.length && <div className="px-2.5 py-1.5 text-xs text-subtle">No folders yet</div>}
      <MenuSeparator />
      <MenuItem icon={<FolderPlus />} onSelect={() => openDialog({ mode: 'create', onCreated: (f) => move(f) })}>
        New folder…
      </MenuItem>
      {currentFolderId !== null && (
        <MenuItem icon={<FolderMinus />} onSelect={() => move(null)}>
          Remove from folder
        </MenuItem>
      )}
    </>
  );
}

/** Drag payload for images dragged onto folders. */
export const DRAG_TYPE = 'application/x-imagegen-jobs';
