'use client';

import {
  Check,
  ChevronDown,
  Download,
  Folder as FolderIcon,
  FolderPlus,
  Images,
  Inbox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useFolders } from '@/lib/queries';
import { type Density, useUi } from '@/lib/store';
import { cn, download } from '@/lib/utils';
import { useFolderDialog } from './folders';
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Tip } from './ui/primitives';

const DENSITIES: { value: Density; label: string; cells: number }[] = [
  { value: 'lg', label: 'Large tiles', cells: 2 },
  { value: 'md', label: 'Medium tiles', cells: 3 },
  { value: 'sm', label: 'Small tiles', cells: 4 },
];

/** Header of the image area: current folder, counts, view options and bulk download. */
export function Toolbar() {
  const { data } = useFolders();
  const folder = useUi((s) => s.folder);
  const setFolder = useUi((s) => s.setFolder);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const search = useUi((s) => s.search);
  const openDialog = useFolderDialog((s) => s.open);

  const current = data?.items.find((f) => f.id === folder);
  const title = folder === 'all' ? 'All images' : folder === 'none' ? 'Unfiled' : (current?.name ?? 'Folder');
  const count = folder === 'all' ? data?.allCount : folder === 'none' ? data?.unfiledCount : current?.imageCount;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {/* Folder switcher: a dropdown on small screens (sidebar is hidden there). */}
      <Menu
        align="start"
        trigger={
          <button className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-left lg:pointer-events-none">
            <span className="truncate text-lg font-semibold tracking-tight">{title}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-subtle lg:hidden" />
          </button>
        }
      >
        <MenuItem icon={<Images />} onSelect={() => setFolder('all')}>
          All images
        </MenuItem>
        <MenuItem icon={<Inbox />} onSelect={() => setFolder('none')}>
          Unfiled
        </MenuItem>
        {!!data?.items.length && <MenuSeparator />}
        {data?.items.map((f) => (
          <MenuItem key={f.id} icon={folder === f.id ? <Check /> : <FolderIcon />} onSelect={() => setFolder(f.id)}>
            {f.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<FolderPlus />} onSelect={() => openDialog({ mode: 'create' })}>
          New folder…
        </MenuItem>
      </Menu>
      {count !== undefined && (
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs tabular-nums text-muted">
          {count} image{count === 1 ? '' : 's'}
        </span>
      )}
      {search && <span className="text-xs text-subtle">matching “{search}”</span>}

      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex h-8 items-center rounded-lg bg-white/[0.04] p-0.5">
          <Tip label="Grid" side="bottom">
            <button
              onClick={() => setView('grid')}
              aria-label="Grid view"
              className={cn('flex h-7 w-8 items-center justify-center rounded-md', view === 'grid' ? 'bg-surface-3 text-fg' : 'text-subtle hover:text-fg')}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </Tip>
          <Tip label="Grouped by prompt" side="bottom">
            <button
              onClick={() => setView('list')}
              aria-label="List view"
              className={cn('flex h-7 w-8 items-center justify-center rounded-md', view === 'list' ? 'bg-surface-3 text-fg' : 'text-subtle hover:text-fg')}
            >
              <List className="h-4 w-4" />
            </button>
          </Tip>
        </div>
        {view === 'grid' && (
          <div className="hidden h-8 items-center rounded-lg bg-white/[0.04] p-0.5 sm:flex">
            {DENSITIES.map((d) => (
              <Tip key={d.value} label={d.label} side="bottom">
                <button
                  onClick={() => setDensity(d.value)}
                  aria-label={d.label}
                  className={cn('flex h-7 w-8 items-center justify-center rounded-md', density === d.value ? 'bg-surface-3 text-fg' : 'text-subtle hover:text-fg')}
                >
                  <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${d.cells}, 1fr)` }}>
                    {Array.from({ length: d.cells * d.cells }).map((_, i) => (
                      <span key={i} className="rounded-[1px] bg-current" style={{ width: 12 / d.cells, height: 12 / d.cells }} />
                    ))}
                  </span>
                </button>
              </Tip>
            ))}
          </div>
        )}
        <Tip label={`Download ${count ?? ''} images as .zip (with prompts & seeds)`} side="bottom">
          <Button size="sm" variant="secondary" disabled={!count} onClick={() => download(api.archiveUrl(folder))}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Download all</span>
          </Button>
        </Tip>
        {current && (
          <Menu
            trigger={
              <IconButton label="Folder actions" size="icon-sm" tipSide="bottom">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil />} onSelect={() => openDialog({ mode: 'rename', folder: current })}>
              Rename folder
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={() => openDialog({ mode: 'delete', folder: current })}>
              Delete folder
            </MenuItem>
          </Menu>
        )}
      </div>
    </div>
  );
}
