'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Brush,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerUpLeft,
  Download,
  Folder as FolderIcon,
  ImagePlus,
  Info,
  Shuffle,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, withToken } from '@/lib/api';
import { useAction, useConfig, useFolders, useImageEntries } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';
import type { ImageEntry } from '@/lib/types';
import { cn, copyText, formatBytes, prettyModel } from '@/lib/utils';
import { useImageActions } from './image-tile';
import { CopyablePrompt } from './copyable-prompt';
import { MoveToFolderItems } from './folders';
import { Button, IconButton, Kbd, Menu } from './ui/primitives';

export function Lightbox() {
  const jobId = useUi((s) => s.lightboxJobId);
  const open = useUi((s) => s.openLightbox);
  const close = useUi((s) => s.closeLightbox);
  const inpaintOpen = useUi((s) => !!s.inpaintAsset);
  const search = useUi((s) => s.search);
  const folder = useUi((s) => s.folder);
  const entries = useImageEntries(folder, search);
  const [showInfo, setShowInfo] = useState(true);
  const index = entries.findIndex((e) => e.job.id === jobId);
  const entry = index >= 0 ? entries[index] : null;
  const lastIndex = useRef(0);
  if (index >= 0) lastIndex.current = index;

  // The current image was deleted: move to a neighbour (or close).
  useEffect(() => {
    if (jobId && index < 0) {
      const fallback = entries[Math.min(lastIndex.current, entries.length - 1)];
      if (fallback) open(fallback.job.id);
      else close();
    }
  }, [jobId, index, entries, open, close]);

  const go = useCallback(
    (delta: number) => {
      const next = entries[index + delta];
      if (next) open(next.job.id);
    },
    [entries, index, open],
  );

  return (
    <Dialog.Root open={!!jobId && !!entry} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/92 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          className="fixed inset-0 z-50 flex flex-col outline-none lg:flex-row"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => inpaintOpen && e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Image viewer</Dialog.Title>
          {entry && (
            <>
              <Viewer
                entry={entry}
                index={index}
                total={entries.length}
                go={go}
                showInfo={showInfo}
                toggleInfo={() => setShowInfo((v) => !v)}
                entries={entries}
                disabled={inpaintOpen}
              />
              {showInfo && <InfoPanel entry={entry} />}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Viewer({
  entry,
  index,
  total,
  go,
  showInfo,
  toggleInfo,
  entries,
  disabled,
}: {
  entry: ImageEntry;
  index: number;
  total: number;
  go: (d: number) => void;
  showInfo: boolean;
  toggleInfo: () => void;
  entries: ImageEntry[];
  disabled: boolean;
}) {
  const close = useUi((s) => s.closeLightbox);
  const open = useUi((s) => s.openLightbox);
  const actions = useImageActions();
  const run = useAction();
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [fullLoaded, setFullLoaded] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const filmstrip = useRef<HTMLDivElement>(null);
  const { image, job } = entry;

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    setFullLoaded(false);
    filmstrip.current?.querySelector(`[data-id="${job.id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [job.id]);

  const remove = useCallback(() => {
    void run(() => api.deleteJob(job.id), { success: 'Image deleted', error: 'Delete failed' });
  }, [run, job.id]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowright' || k === 'l') go(1);
      else if (k === 'arrowleft' || k === 'h') go(-1);
      else if (k === 'd') actions.download(job);
      else if (k === 'e') actions.inpaint(job);
      else if (k === 'r') {
        actions.useAsReference(job);
        close();
      } else if (k === 'i') toggleInfo();
      else if (k === '0') setView({ scale: 1, x: 0, y: 0 });
      else if (k === '+' || k === '=') setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.5) }));
      else if (k === '-') setView((v) => (v.scale / 1.5 <= 1 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: v.scale / 1.5 }));
      else if (k === 'delete' || k === 'backspace') remove();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, actions, job, close, toggleInfo, remove, disabled]);

  // Zoom around the cursor with the wheel / trackpad pinch.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
        const scale = Math.min(8, Math.max(1, v.scale * factor));
        if (scale === 1) return { scale: 1, x: 0, y: 0 };
        const k = scale / v.scale;
        return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = stageSize.w < 640 ? 16 : 48;
  const fit = Math.min((stageSize.w - pad) / image.width, (stageSize.h - pad) / image.height, 1.5);
  const fitted = { width: Math.max(0, image.width * fit), height: Math.max(0, image.height * fit) };

  const zoomed = view.scale > 1;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <span className="font-mono text-xs tabular-nums text-muted">
          {index + 1} / {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Zoom out" shortcut="−" tipSide="bottom" onClick={() => setView((v) => (v.scale / 1.5 <= 1 ? { scale: 1, x: 0, y: 0 } : { ...v, scale: v.scale / 1.5 }))} disabled={!zoomed}>
            <ZoomOut className="h-[18px] w-[18px]" />
          </IconButton>
          <button onClick={() => setView({ scale: 1, x: 0, y: 0 })} className="w-12 font-mono text-xs tabular-nums text-muted hover:text-fg">
            {Math.round(view.scale * 100)}%
          </button>
          <IconButton label="Zoom in" shortcut="+" tipSide="bottom" onClick={() => setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.5) }))}>
            <ZoomIn className="h-[18px] w-[18px]" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-line-strong" />
          <IconButton label="Download" shortcut="D" tipSide="bottom" onClick={() => actions.download(job)}>
            <Download className="h-[18px] w-[18px]" />
          </IconButton>
          <IconButton label={showInfo ? 'Hide details' : 'Show details'} shortcut="I" tipSide="bottom" onClick={toggleInfo} className={cn(showInfo && 'text-fg')}>
            <Info className="h-[18px] w-[18px]" />
          </IconButton>
          <Dialog.Close asChild>
            <IconButton label="Close" shortcut="Esc" tipSide="bottom">
              <X className="h-5 w-5" />
            </IconButton>
          </Dialog.Close>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={stage}
        className={cn('relative min-h-0 flex-1 overflow-hidden select-none', zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;
          setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: -cx * 1.5, y: -cy * 1.5 }));
        }}
        onPointerDown={(e) => {
          if (!zoomed) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onClick={(e) => {
          // Click on the empty backdrop (not the image) closes when not zoomed.
          if (!zoomed && e.target === e.currentTarget) close();
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transition: drag.current ? 'none' : 'transform 0.18s ease-out',
          }}
          onClick={(e) => {
            if (!zoomed && e.target === e.currentTarget) close();
          }}
        >
          <div className="relative overflow-hidden rounded-md shadow-2xl" style={fitted}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withToken(image.thumbUrl)}
              alt=""
              draggable={false}
              className={cn('absolute inset-0 h-full w-full object-cover blur-sm transition-opacity', fullLoaded && 'opacity-0')}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={image.id}
              src={withToken(image.url)}
              alt={entry.generation.prompt}
              draggable={false}
              onLoad={() => setFullLoaded(true)}
              className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', fullLoaded ? 'opacity-100' : 'opacity-0')}
            />
          </div>
        </div>

        {index > 0 && (
          <button
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {index < total - 1 && (
          <button
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Filmstrip */}
      <div ref={filmstrip} className="flex h-[76px] shrink-0 items-center gap-1.5 overflow-x-auto px-4 py-2">
        {entries.map((e) => (
          <button
            key={e.job.id}
            data-id={e.job.id}
            onClick={() => open(e.job.id)}
            className={cn(
              'h-14 shrink-0 overflow-hidden rounded-md ring-2 transition',
              e.job.id === job.id ? 'opacity-100 ring-accent' : 'opacity-45 ring-transparent hover:opacity-90',
            )}
            style={{ aspectRatio: `${e.image.width} / ${e.image.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withToken(e.image.thumbUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

function InfoPanel({ entry }: { entry: ImageEntry }) {
  const { generation: gen, job, image } = entry;
  const actions = useImageActions();
  const close = useUi((s) => s.closeLightbox);
  const composer = useComposer();
  const { data: config } = useConfig();
  const run = useAction();

  const { data: folders } = useFolders();
  const folderName = job.folderId ? (folders?.items.find((f) => f.id === job.folderId)?.name ?? 'Folder') : 'None';

  const copy = async (text: string, what: string) => (await copyText(text)) && toast.success(`${what} copied`, { duration: 1200 });

  const rows: [string, React.ReactNode][] = [
    ['Dimensions', `${image.width} × ${image.height}`],
    ['File', `${image.mime.split('/')[1].toUpperCase()} · ${formatBytes(image.bytes)}`],
    [
      'Seed',
      <button key="seed" onClick={() => copy(String(job.seed), 'Seed')} className="font-mono hover:text-accent" title="Copy seed">
        {job.seed}
      </button>,
    ],
    [
      'Folder',
      <Menu
        key="folder"
        trigger={
          <button className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/5 hover:text-accent" title="Move to folder">
            <FolderIcon className="h-3.5 w-3.5" />
            {folderName}
          </button>
        }
      >
        <MoveToFolderItems jobIds={[job.id]} currentFolderId={job.folderId} />
      </Menu>,
    ],
    ['Model', prettyModel(gen.model)],
    ['Mode', gen.mode.replace(/-/g, ' ')],
    ['Created', new Date(job.finishedAt ?? gen.createdAt).toLocaleString()],
  ];
  if (job.startedAt && job.finishedAt) {
    rows.splice(4, 0, ['Duration', `${((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000).toFixed(1)}s`]);
  }

  return (
    <aside className="flex max-h-[45dvh] shrink-0 flex-col overflow-y-auto border-t border-line bg-surface/70 backdrop-blur-xl lg:max-h-none lg:w-[360px] lg:border-l lg:border-t-0">
      <div className="space-y-5 p-5">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-subtle">Prompt</h3>
            <button onClick={() => copy(gen.prompt, 'Prompt')} className="text-subtle hover:text-fg" aria-label="Copy prompt">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <CopyablePrompt text={gen.prompt} lines={0} className="-mx-1.5 px-1.5 py-1 text-sm leading-relaxed text-fg/90" />
        </section>

        {gen.enhancedPrompt && (
          <section className="rounded-xl border border-accent/15 bg-accent/[0.05] p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-accent">
                <Sparkles className="h-3.5 w-3.5" /> Enhanced prompt
              </h3>
              <button onClick={() => copy(gen.enhancedPrompt!, 'Enhanced prompt')} className="text-accent/70 hover:text-accent" aria-label="Copy enhanced prompt">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <CopyablePrompt text={gen.enhancedPrompt} lines={0} className="-mx-1.5 px-1.5 py-1 text-[13px] leading-relaxed text-fg/80" />
          </section>
        )}

        {gen.inputImages.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-subtle">Inputs</h3>
            <div className="flex gap-2">
              {gen.inputImages.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={withToken(a.thumbUrl)} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-line-strong" />
              ))}
              {gen.mask && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={withToken(gen.mask.thumbUrl)} alt="mask" title="Inpainting mask" className="h-14 w-14 rounded-lg object-cover ring-1 ring-accent/40" />
              )}
            </div>
          </section>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-subtle">{k}</dt>
              <dd className="text-right text-fg/85">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => actions.download(job)} className="col-span-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button onClick={() => actions.inpaint(job)}>
            <Brush className="h-4 w-4" /> Inpaint
            <Kbd className="ml-auto">E</Kbd>
          </Button>
          <Button
            onClick={() => {
              actions.useAsReference(job);
              close();
            }}
          >
            <ImagePlus className="h-4 w-4" /> Reference
            <Kbd className="ml-auto">R</Kbd>
          </Button>
          <Button onClick={() => actions.remix(gen, job)}>
            <Shuffle className="h-4 w-4" /> Remix ×4
          </Button>
          <Button
            onClick={() => {
              composer.setPrompt(gen.prompt);
              composer.clearReferences();
              for (const a of gen.inputImages) composer.addAsset(a, config?.limits.maxInputImages ?? 4);
              composer.setAspectRatio(gen.aspectRatio);
              composer.setSeed(null);
              composer.focus();
              close();
            }}
          >
            <CornerUpLeft className="h-4 w-4" /> Reuse
          </Button>
          <Button variant="danger" className="col-span-2" onClick={() => run(() => api.deleteJob(job.id), { success: 'Image deleted' })}>
            <Trash2 className="h-4 w-4" /> Delete image
          </Button>
        </div>
        <p className="hidden text-center text-[11px] text-subtle lg:block">
          <Kbd>←</Kbd> <Kbd>→</Kbd> navigate · scroll to zoom · double-click to zoom
        </p>
      </div>
    </aside>
  );
}
