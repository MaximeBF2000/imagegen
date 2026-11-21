'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CheckCheck, Download, FolderInput, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { visibleJobs } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Generation, Job } from '@/lib/types';
import { Button, Spinner } from './ui/primitives';
import { MoveToFolderItems } from './folders';
import { ImageTile } from './image-tile';

export const MIN_TILE = { sm: 130, md: 200, lg: 300 } as const;

export interface DayGroup {
  label: string;
  items: Generation[];
}

/** Flat, chronological image grid (newest first) with multi-selection. */
export function GridView({ groups }: { groups: DayGroup[] }) {
  const folder = useUi((s) => s.folder);
  const density = useUi((s) => s.density);
  const toggleSelected = useUi((s) => s.toggleSelected);
  const anchor = useRef<string | null>(null);

  const sections = useMemo(
    () =>
      groups.map((g) => ({
        label: g.label,
        tiles: g.items.flatMap((gen) => visibleJobs(gen, folder).map((job) => ({ gen, job }))),
      })),
    [groups, folder],
  );
  const selectableBySection = useMemo(
    () => sections.map((s) => s.tiles.filter((t) => t.job.status === 'succeeded').map((t) => t.job.id)),
    [sections],
  );
  const selectable = useMemo(() => selectableBySection.flat(), [selectableBySection]);
  const selection = useUi((s) => s.selection);
  const toggleMany = useUi((s) => s.toggleMany);

  // Shared with the toolbar / selection bar ("Select all").
  useEffect(() => {
    useUi.getState().setSelectable(selectable);
  }, [selectable]);
  useEffect(() => () => useUi.getState().setSelectable([]), []);

  const onSelect = useCallback(
    (jobId: string, shift: boolean) => {
      if (shift && anchor.current) {
        const a = selectable.indexOf(anchor.current);
        const b = selectable.indexOf(jobId);
        if (a >= 0 && b >= 0) {
          toggleSelected(jobId, selectable.slice(Math.min(a, b), Math.max(a, b) + 1));
          return;
        }
      }
      anchor.current = jobId;
      toggleSelected(jobId);
    },
    [selectable, toggleSelected],
  );

  // ⌘A selects every loaded image, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]') || document.querySelector('[role="dialog"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        useUi.getState().setSelection(selectable);
      } else if (e.key === 'Escape') useUi.getState().clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectable]);

  return (
    <div className="space-y-8">
      {sections.map((section, i) => {
        if (!section.tiles.length) return null;
        const ids = selectableBySection[i];
        const picked = ids.filter((id) => selection.includes(id)).length;
        const all = ids.length > 0 && picked === ids.length;
        return (
          <section key={section.label} className="group/day">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wider text-subtle">{section.label}</h2>
              {ids.length > 0 && (
                <button
                  onClick={() => toggleMany(ids)}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-subtle transition-opacity hover:bg-white/5 hover:text-fg focus-visible:opacity-100',
                    selection.length ? 'opacity-100' : 'opacity-0 group-hover/day:opacity-100 [@media(hover:none)]:opacity-100',
                  )}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {all ? 'Deselect day' : picked ? `Select all ${ids.length}` : 'Select day'}
                </button>
              )}
            </div>
            <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${MIN_TILE[density]}px, 45%), 1fr))` }}>
              {section.tiles.map(({ gen, job }) => (
                <div key={job.id} className="animate-fade-in">
                  <ImageTile gen={gen} job={job} ratio={1} variant="grid" density={density} onSelect={onSelect} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Floating action bar shown while images are selected. */
export function SelectionBar({ jobs }: { jobs: Map<string, Job> }) {
  const selection = useUi((s) => s.selection);
  const selectable = useUi((s) => s.selectable);
  const setSelection = useUi((s) => s.setSelection);
  const clear = useUi((s) => s.clearSelection);
  const [busy, setBusy] = useState<'download' | 'delete' | null>(null);
  const n = selection.length;
  if (!n) return null;

  const downloadZip = async () => {
    setBusy('download');
    try {
      const blob = await api.archiveSelection(selection);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `selection-${n}-images.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error('Download failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (n > 1 && !window.confirm(`Delete ${n} images? Their prompts are erased too (uploads are kept). This can't be undone.`)) return;
    setBusy('delete');
    try {
      const { deleted } = await api.deleteImages(selection);
      clear();
      toast.success(`${deleted} image${deleted === 1 ? '' : 's'} deleted`);
    } catch (err) {
      toast.error('Delete failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const sameFolder = new Set(selection.map((id) => jobs.get(id)?.folderId ?? null));
  const currentFolderId = sameFolder.size === 1 ? [...sameFolder][0] : undefined;

  return (
    <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="flex items-center gap-1 rounded-2xl border border-line-strong bg-surface-2/95 p-1.5 pl-4 shadow-[0_20px_60px_-10px_rgb(0_0_0/0.9)] backdrop-blur-xl animate-pop">
        <span className="mr-2 text-sm font-medium tabular-nums">
          {n} selected
        </span>
        {n < selectable.length && (
          <Button size="sm" variant="ghost" className="text-fg" onClick={() => setSelection(selectable)} title="Select all loaded images (⌘A)">
            <CheckCheck className="h-4 w-4" /> <span className="hidden sm:inline">All {selectable.length}</span>
          </Button>
        )}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" variant="ghost" className="text-fg">
              <FolderInput className="h-4 w-4" /> <span className="hidden sm:inline">Move</span>
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="top" sideOffset={8} className="z-[90] min-w-[200px] rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl animate-pop">
              <MoveToFolderItems jobIds={selection} currentFolderId={currentFolderId} onMoved={clear} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button size="sm" variant="ghost" className="text-fg" onClick={downloadZip} disabled={!!busy}>
          {busy === 'download' ? <Spinner /> : <Download className="h-4 w-4" />} <span className="hidden sm:inline">Download</span>
        </Button>
        <Button size="sm" variant="danger" onClick={remove} disabled={!!busy}>
          {busy === 'delete' ? <Spinner /> : <Trash2 className="h-4 w-4" />} <span className="hidden sm:inline">Delete</span>
        </Button>
        <div className="mx-1 h-5 w-px bg-line-strong" />
        <Button size="icon-sm" variant="ghost" onClick={clear} aria-label="Clear selection" title="Clear selection (Esc)">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
