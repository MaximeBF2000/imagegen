'use client';

import { Download, Folder as FolderIcon, FolderOpen, FolderPlus, Images, Inbox, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, withToken } from '@/lib/api';
import { useFolderActions, useFolders } from '@/lib/queries';
import { useUi } from '@/lib/store';
import type { Folder, FolderScope } from '@/lib/types';
import { cn, download } from '@/lib/utils';
import { DRAG_TYPE, useFolderDialog } from './folders';
import { Menu, MenuItem, MenuSeparator, Tip } from './ui/primitives';

export function Sidebar() {
  const { data } = useFolders();
  const folder = useUi((s) => s.folder);
  const setFolder = useUi((s) => s.setFolder);
  const openDialog = useFolderDialog((s) => s.open);

  // The remembered folder no longer exists.
  useEffect(() => {
    if (data && folder !== 'all' && folder !== 'none' && !data.items.some((f) => f.id === folder)) setFolder('all');
  }, [data, folder, setFolder]);

  return (
    <nav className="sticky top-[60px] hidden h-[calc(100dvh-60px)] w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line px-3 py-5 lg:flex">
      <NavItem scope="all" active={folder === 'all'} onClick={() => setFolder('all')} icon={<Images />} label="All images" count={data?.allCount} />
      <NavItem scope="none" active={folder === 'none'} onClick={() => setFolder('none')} icon={<Inbox />} label="Unfiled" count={data?.unfiledCount} />

      <div className="mb-1 mt-5 flex items-center justify-between px-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">Folders</span>
        <Tip label="New folder" side="right">
          <button
            onClick={() => openDialog({ mode: 'create' })}
            aria-label="New folder"
            className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-white/5 hover:text-fg"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
      {data?.items.map((f) => (
        <NavItem
          key={f.id}
          scope={f.id}
          folder={f}
          active={folder === f.id}
          onClick={() => setFolder(f.id)}
          icon={folder === f.id ? <FolderOpen /> : <FolderIcon />}
          label={f.name}
          count={f.imageCount}
        />
      ))}
      {data && !data.items.length && (
        <button
          onClick={() => openDialog({ mode: 'create' })}
          className="mx-1 mt-1 rounded-xl border border-dashed border-line-strong px-3 py-4 text-center text-xs leading-relaxed text-subtle transition-colors hover:border-accent/40 hover:text-fg"
        >
          <FolderPlus className="mx-auto mb-1.5 h-4 w-4" />
          Create a folder to organize your images. Drag images onto it.
        </button>
      )}
    </nav>
  );
}

function NavItem({
  scope,
  folder,
  active,
  onClick,
  icon,
  label,
  count,
}: {
  scope: FolderScope;
  folder?: Folder;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  const [over, setOver] = useState(false);
  const actions = useFolderActions();
  const openDialog = useFolderDialog((s) => s.open);
  const clearSelection = useUi((s) => s.clearSelection);
  const droppable = scope !== 'all';

  return (
    <div
      className={cn(
        'group/nav relative flex h-9 items-center rounded-lg transition-colors',
        active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
        over && 'bg-accent/15 text-fg ring-1 ring-accent/50',
      )}
      onDragOver={(e) => {
        if (!droppable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!droppable || !raw) return;
        e.preventDefault();
        const ids: string[] = JSON.parse(raw);
        if (await actions.move(ids, scope === 'none' ? null : scope, label)) clearSelection();
      }}
    >
      <button onClick={onClick} className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-[13.5px]">
        {folder?.covers[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={withToken(folder.covers[0].thumbUrl)} alt="" className="h-5 w-5 shrink-0 rounded object-cover ring-1 ring-line-strong" />
        ) : (
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4', active && 'text-accent')}>{icon}</span>
        )}
        <span className="truncate">{label}</span>
      </button>
      {count !== undefined && (
        <span className={cn('pr-2.5 text-xs tabular-nums text-subtle', folder && 'group-hover/nav:hidden has-[[data-state=open]]:hidden')}>{count}</span>
      )}
      {folder && (
        <div className="hidden pr-1 group-hover/nav:block has-[[data-state=open]]:block">
          <Menu
            align="start"
            trigger={
              <button aria-label="Folder actions" className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-white/10 hover:text-fg">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <MenuItem icon={<Download />} disabled={!folder.imageCount} onSelect={() => download(api.archiveUrl(folder.id))}>
              Download all ({folder.imageCount})
            </MenuItem>
            <MenuItem icon={<Pencil />} onSelect={() => openDialog({ mode: 'rename', folder })}>
              Rename
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => openDialog({ mode: 'delete', folder })}>
              Delete folder
            </MenuItem>
          </Menu>
        </div>
      )}
    </div>
  );
}
