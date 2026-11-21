'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, ChevronLeft, ChevronRight, Download, ExternalLink, ImagePlus, MoreHorizontal, Trash2, Upload as UploadIcon, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, withToken } from '@/lib/api';
import { keys, useConfig, useUploads } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';
import type { Upload } from '@/lib/types';
import { cn, download, formatBytes } from '@/lib/utils';
import { MIN_TILE } from './grid-view';
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Spinner, Tip } from './ui/primitives';
import { UpscaleSub } from './upscale-menu';

/** "Uploaded medias" page: every uploaded image, with multi-select and bulk delete. */
export function UploadsView() {
  const qc = useQueryClient();
  const router = useRouter();
  const density = useUi((s) => s.density);
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useUploads();
  const uploads = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.total;
  const ids = useMemo(() => uploads.map((u) => u.id), [uploads]);
  const [selection, setSelection] = useState<string[]>([]);
  const [preview, setPreview] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const anchor = useRef<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const selecting = selection.length > 0;
  const allSelected = ids.length > 0 && selection.length === ids.length;

  // Drop selected uploads that disappeared.
  useEffect(() => setSelection((s) => s.filter((id) => ids.includes(id))), [ids]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggle = useCallback(
    (id: string, shift: boolean) => {
      if (shift && anchor.current) {
        const a = ids.indexOf(anchor.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
          setSelection((s) => [...new Set([...s, ...range])]);
          return;
        }
      }
      anchor.current = id;
      setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    },
    [ids],
  );

  // ⌘A selects every loaded upload, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]') || document.querySelector('[role="dialog"]') || preview !== null) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(ids);
      } else if (e.key === 'Escape') setSelection([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, preview]);

  const remove = async (targets: string[]) => {
    const n = targets.length;
    const used = uploads.filter((u) => targets.includes(u.id) && u.usedBy > 0).length;
    const warning = used ? ` ${used} ${used === 1 ? 'is' : 'are'} used as a reference by generations, which will no longer show it.` : '';
    if ((n > 1 || used) && !window.confirm(`Delete ${n} uploaded image${n === 1 ? '' : 's'}?${warning} This can't be undone.`)) return false;
    try {
      const { deleted, ids: gone } = await api.deleteUploads(targets);
      useComposer.getState().forgetAssets(gone);
      setSelection((s) => s.filter((id) => !gone.includes(id)));
      void qc.invalidateQueries({ queryKey: keys.uploads });
      if (used) void qc.invalidateQueries({ queryKey: ['generations'] });
      toast.success(`${deleted} upload${deleted === 1 ? '' : 's'} deleted`);
      return true;
    } catch (err) {
      toast.error('Delete failed', { description: (err as Error).message });
      return false;
    }
  };

  const addFiles = async (files: FileList | null) => {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setUploading(true);
    try {
      // The API accepts up to 8 files per request.
      for (let i = 0; i < images.length; i += 8) await api.upload(images.slice(i, i + 8));
      toast.success(`${images.length} image${images.length === 1 ? '' : 's'} uploaded`, { duration: 1500 });
    } catch (err) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploading(false);
      void qc.invalidateQueries({ queryKey: keys.uploads });
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* No sidebar on small screens: a way back to the images. */}
        <Button size="icon-sm" variant="ghost" className="lg:hidden" onClick={() => router.push('/')} aria-label="Back to images">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Uploaded medias</h1>
        {total !== undefined && (
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs tabular-nums text-muted">
            {total} image{total === 1 ? '' : 's'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {ids.length > 0 && (
            <Tip label={allSelected ? 'Clear selection (Esc)' : 'Select all loaded uploads (⌘A)'} side="bottom">
              <Button size="sm" variant="secondary" onClick={() => setSelection(allSelected ? [] : ids)}>
                <CheckCheck className="h-4 w-4" />
                <span className="hidden sm:inline">{allSelected ? 'Deselect' : 'Select all'}</span>
              </Button>
            </Tip>
          )}
          <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <UploadIcon className="h-4 w-4" />}
            <span className="hidden sm:inline">Upload</span>
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {isPending ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-5 w-5 text-subtle" />
        </div>
      ) : isError ? (
        <div className="mx-auto mt-16 max-w-sm text-center text-sm text-muted">
          <p>Couldn’t load uploads: {(error as Error).message}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : !uploads.length ? (
        <div className="mx-auto mt-16 flex max-w-sm flex-col items-center text-center animate-fade-in">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-subtle">
            <UploadIcon className="h-6 w-6" />
          </div>
          <h2 className="font-medium">No uploads yet</h2>
          <p className="mt-1 text-sm text-muted">Images you add as references (drag & drop, paste or pick) are kept here.</p>
        </div>
      ) : (
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${MIN_TILE[density]}px, 45%), 1fr))` }}>
          {uploads.map((u, i) => (
            <UploadTile
              key={u.id}
              upload={u}
              selected={selection.includes(u.id)}
              selecting={selecting}
              onSelect={toggle}
              onOpen={() => setPreview(i)}
              onDelete={() => void remove([u.id])}
            />
          ))}
        </div>
      )}
      <div ref={sentinel} className="h-px" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-subtle" />
        </div>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="flex items-center gap-1 rounded-2xl border border-line-strong bg-surface-2/95 p-1.5 pl-4 shadow-[0_20px_60px_-10px_rgb(0_0_0/0.9)] backdrop-blur-xl animate-pop">
            <span className="mr-2 text-sm font-medium tabular-nums">{selection.length} selected</span>
            {selection.length < ids.length && (
              <Button size="sm" variant="ghost" className="text-fg" onClick={() => setSelection(ids)} title="Select all loaded uploads (⌘A)">
                <CheckCheck className="h-4 w-4" /> <span className="hidden sm:inline">All {ids.length}</span>
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => void remove(selection)}>
              <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Delete</span>
            </Button>
            <div className="mx-1 h-5 w-px bg-line-strong" />
            <Button size="icon-sm" variant="ghost" onClick={() => setSelection([])} aria-label="Clear selection" title="Clear selection (Esc)">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {preview !== null && uploads[preview] && (
        <Preview uploads={uploads} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function useAsReference() {
  const { data: config } = useConfig();
  const addAsset = useComposer((s) => s.addAsset);
  const focus = useComposer((s) => s.focus);
  const max = config?.limits.maxInputImages ?? 4;
  return (u: Upload) => {
    if (addAsset(u, max)) {
      toast.success('Added as reference', { duration: 1500 });
      focus();
    } else toast.error(`You can use at most ${max} reference images`);
  };
}

function UploadTile({
  upload: u,
  selected,
  selecting,
  onSelect,
  onOpen,
  onDelete,
}: {
  upload: Upload;
  selected: boolean;
  selecting: boolean;
  onSelect: (id: string, shift: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const reference = useAsReference();

  return (
    <div
      className={cn(
        'group/tile relative aspect-square overflow-hidden rounded-lg bg-surface-2 ring-1 transition-shadow animate-fade-in',
        selected ? 'ring-2 ring-accent' : 'ring-line hover:ring-line-strong',
      )}
    >
      {!loaded && <div className="skeleton absolute inset-0" />}
      <button
        className={cn('absolute inset-0', selecting ? 'cursor-pointer' : 'cursor-zoom-in')}
        onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onSelect(u.id, e.shiftKey) : onOpen())}
        aria-label="Open image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withToken(u.thumbUrl)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={cn(
            'h-full w-full object-cover transition-[opacity,transform] duration-500',
            loaded ? 'opacity-100' : 'opacity-0',
            selected ? 'scale-[0.94] rounded-md' : 'group-hover/tile:scale-[1.03]',
          )}
        />
      </button>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/25 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100" />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect(u.id, e.shiftKey);
        }}
        aria-label={selected ? 'Deselect' : 'Select'}
        className={cn(
          'absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-150',
          selected
            ? 'border-accent bg-accent text-white opacity-100'
            : cn('border-white/80 bg-black/30 text-transparent backdrop-blur hover:bg-black/50', selecting ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100'),
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 has-[[data-state=open]]:opacity-100">
        <IconButton label="Use as reference" variant="glass" size="icon-sm" onClick={() => reference(u)}>
          <ImagePlus className="h-4 w-4" />
        </IconButton>
        <Menu
          trigger={
            <button
              aria-label="More actions"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/45 text-white backdrop-blur-md hover:bg-black/65"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          <MenuItem icon={<ExternalLink />} onSelect={() => window.open(withToken(u.url), '_blank', 'noopener,noreferrer')}>
            Open image outside app
          </MenuItem>
          <MenuItem icon={<ImagePlus />} onSelect={() => reference(u)}>
            Use as reference
          </MenuItem>
          <UpscaleSub image={u} folderId={null} />
          <MenuItem icon={<Download />} onSelect={() => download(withToken(u.downloadUrl))}>
            Download
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
            Delete upload
          </MenuItem>
        </Menu>
      </div>

      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 text-[11px] text-white/90 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100">
        <span className="font-mono tabular-nums">
          {u.width}×{u.height} · {formatBytes(u.bytes)}
        </span>
        <span className="rounded bg-black/40 px-1.5 py-0.5">{u.usedBy ? `Used by ${u.usedBy}` : 'Unused'}</span>
      </div>
    </div>
  );
}

/** Minimal full-screen viewer with ← → navigation. */
function Preview({ uploads, index, onIndex, onClose }: { uploads: Upload[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const u = uploads[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < uploads.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, uploads.length, onIndex, onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-6 backdrop-blur animate-fade-in" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withToken(u.url)} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <div className="absolute right-4 top-4 flex gap-1" onClick={(e) => e.stopPropagation()}>
        <IconButton label="Open image outside app" tipSide="bottom" onClick={() => window.open(withToken(u.url), '_blank', 'noopener,noreferrer')}>
          <ExternalLink className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="Close" shortcut="Esc" tipSide="bottom" onClick={onClose}>
          <X className="h-5 w-5" />
        </IconButton>
      </div>
      {index > 0 && (
        <button
          aria-label="Previous"
          onClick={(e) => (e.stopPropagation(), onIndex(index - 1))}
          className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {index < uploads.length - 1 && (
        <button
          aria-label="Next"
          onClick={(e) => (e.stopPropagation(), onIndex(index + 1))}
          className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs tabular-nums text-white/60">
        {index + 1} / {uploads.length} · {u.width}×{u.height}
      </div>
    </div>
  );
}
