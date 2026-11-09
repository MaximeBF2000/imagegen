'use client';

import {
  AlertTriangle,
  Ban,
  Brush,
  Check,
  Download,
  ImagePlus,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, withToken } from '@/lib/api';
import { useAction, useConfig, useCreateGeneration } from '@/lib/queries';
import { type Density, useComposer, useUi } from '@/lib/store';
import type { Generation, Job } from '@/lib/types';
import { cn, download } from '@/lib/utils';
import { CopyablePrompt } from './copyable-prompt';
import { DRAG_TYPE, MoveToFolderSub } from './folders';
import { IconButton, Menu, MenuItem, MenuSeparator, Spinner } from './ui/primitives';

export function useElapsed(since: string | null, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!since) return 0;
  return Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
}

export function useImageActions() {
  const { data: config } = useConfig();
  const addAsset = useComposer((s) => s.addAsset);
  const focus = useComposer((s) => s.focus);
  const openInpaint = useUi((s) => s.openInpaint);
  const create = useCreateGeneration();
  const maxRefs = config?.limits.maxInputImages ?? 4;

  return {
    useAsReference: (job: Job) => {
      if (!job.image) return;
      if (addAsset(job.image, maxRefs)) {
        toast.success('Added as reference', { duration: 1500 });
        focus();
      } else toast.error(`You can use at most ${maxRefs} reference images`);
    },
    inpaint: (job: Job) => job.image && openInpaint(job.image),
    download: (job: Job) => job.image && download(withToken(job.image.downloadUrl)),
    remix: (gen: Generation, job: Job) => {
      if (!job.image) return;
      create.mutate(
        {
          prompt: gen.prompt,
          model: gen.model,
          inputImageIds: [job.image.id],
          count: 4,
          aspectRatio: 'auto',
          enhance: gen.enhance,
          folderId: job.folderId ?? undefined,
        },
        { onSuccess: () => toast.success('Remixing into 4 new variants', { duration: 1800 }) },
      );
    },
  };
}

interface TileProps {
  gen: Generation;
  job: Job;
  /** Placeholder aspect ratio (list view); grid tiles are square. */
  ratio: number;
  variant?: 'list' | 'grid';
  density?: Density;
  /** Grid selection handler (shift = range). */
  onSelect?: (jobId: string, shift: boolean) => void;
}

export const ImageTile = memo(function ImageTile({ gen, job, ratio, variant = 'list', density = 'md', onSelect }: TileProps) {
  const openLightbox = useUi((s) => s.openLightbox);
  const selected = useUi((s) => s.selection.includes(job.id));
  const selecting = useUi((s) => s.selection.length > 0);
  const actions = useImageActions();
  const run = useAction();
  const [loaded, setLoaded] = useState(false);
  const active = job.status === 'running' || job.status === 'queued';
  const elapsed = useElapsed(job.startedAt, job.status === 'running');
  const grid = variant === 'grid';
  const aspect = grid ? 1 : ratio;
  const prompt = gen.enhancedPrompt ?? gen.prompt;

  if (job.status === 'succeeded' && job.image) {
    const img = job.image;
    const click = (e: React.MouseEvent) => {
      if (onSelect && (selecting || e.metaKey || e.ctrlKey || e.shiftKey)) onSelect(job.id, e.shiftKey);
      else openLightbox(job.id);
    };
    return (
      <div
        draggable
        onDragStart={(e) => {
          const { selection } = useUi.getState();
          const ids = selection.includes(job.id) ? selection : [job.id];
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={cn(
          'group/tile relative overflow-hidden bg-surface-2 ring-1 transition-shadow',
          grid ? 'rounded-lg' : 'rounded-xl',
          selected ? 'ring-2 ring-accent' : 'ring-line hover:ring-line-strong',
        )}
        style={{ aspectRatio: grid ? 1 : `${img.width} / ${img.height}` }}
      >
        {!loaded && <div className="skeleton absolute inset-0" />}
        <button className={cn('absolute inset-0', selecting ? 'cursor-pointer' : 'cursor-zoom-in')} onClick={click} aria-label="Open image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withToken(img.thumbUrl)}
            alt={gen.prompt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={cn(
              'h-full w-full object-cover transition-[opacity,transform,filter] duration-500',
              loaded ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
              selected ? 'scale-[0.94] rounded-md' : 'group-hover/tile:scale-[1.03]',
            )}
          />
        </button>
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/0 to-black/25 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100',
          )}
        />

        {onSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(job.id, e.shiftKey);
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
        )}

        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 has-[[data-state=open]]:opacity-100">
          {density !== 'sm' && (
            <IconButton label="Download" variant="glass" size="icon-sm" onClick={() => actions.download(job)}>
              <Download className="h-4 w-4" />
            </IconButton>
          )}
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
            <MenuItem icon={<Maximize2 />} onSelect={() => openLightbox(job.id)}>
              Open
            </MenuItem>
            <MenuItem icon={<ImagePlus />} onSelect={() => actions.useAsReference(job)}>
              Use as reference
            </MenuItem>
            <MenuItem icon={<Brush />} onSelect={() => actions.inpaint(job)}>
              Inpaint / edit area
            </MenuItem>
            <MenuItem icon={<Shuffle />} onSelect={() => actions.remix(gen, job)}>
              Remix ×4
            </MenuItem>
            <MenuItem icon={<Download />} onSelect={() => actions.download(job)}>
              Download
            </MenuItem>
            <MoveToFolderSub jobIds={[job.id]} currentFolderId={job.folderId} />
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => run(() => api.deleteJob(job.id), { error: 'Delete failed' })}>
              Delete image
            </MenuItem>
          </Menu>
        </div>

        {grid && density !== 'sm' ? (
          <div className="absolute inset-x-1.5 bottom-1.5 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100">
            <CopyablePrompt text={prompt} onDark lines={density === 'lg' ? 3 : 2} className="px-1.5 py-1 text-[12px] leading-snug text-white/95" />
          </div>
        ) : (
          !grid && (
            <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100">
              <IconButton label="Use as reference" variant="glass" size="icon-sm" onClick={() => actions.useAsReference(job)}>
                <ImagePlus className="h-4 w-4" />
              </IconButton>
              <IconButton label="Inpaint" variant="glass" size="icon-sm" onClick={() => actions.inpaint(job)}>
                <Brush className="h-4 w-4" />
              </IconButton>
            </div>
          )
        )}
      </div>
    );
  }

  const compact = grid && density === 'sm';

  if (job.status === 'failed' || job.status === 'canceled') {
    const failed = job.status === 'failed';
    return (
      <div
        className={cn(
          'group/tile relative flex flex-col items-center justify-center gap-2 overflow-hidden p-3 text-center ring-1',
          grid ? 'rounded-lg' : 'rounded-xl',
          failed ? 'bg-danger/[0.06] ring-danger/20' : 'bg-surface ring-line',
        )}
        style={{ aspectRatio: aspect }}
      >
        {failed ? <AlertTriangle className="h-5 w-5 text-danger/80" /> : <Ban className="h-5 w-5 text-subtle" />}
        {!compact && <div className={cn('text-xs font-medium', failed ? 'text-danger/90' : 'text-subtle')}>{failed ? 'Generation failed' : 'Canceled'}</div>}
        {failed && job.error && !compact && (
          <p className="line-clamp-3 max-w-[95%] text-[11px] leading-snug text-muted" title={job.error}>
            {job.error}
          </p>
        )}
        <div className="mt-1 flex gap-1">
          <button
            onClick={() => run(() => api.retryJob(job.id), { error: 'Retry failed' })}
            title={job.error ?? 'Retry'}
            className="flex h-7 items-center gap-1 rounded-md bg-white/5 px-2.5 text-xs font-medium text-fg hover:bg-white/10"
          >
            <RotateCcw className="h-3 w-3" /> {!compact && 'Retry'}
          </button>
          <button
            onClick={() => run(() => api.deleteJob(job.id), { error: 'Delete failed' })}
            aria-label="Remove"
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-white/5 hover:text-fg"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Queued or running: skeleton with live status.
  const running = job.status === 'running';
  const enhancingPrompt = gen.enhance && !gen.enhancedPrompt && running;
  return (
    <div
      className={cn('group/tile skeleton relative overflow-hidden ring-1', grid ? 'rounded-lg' : 'rounded-xl', running ? 'skeleton-active ring-accent/25' : 'ring-line')}
      style={{ aspectRatio: aspect }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
        {running ? (
          <>
            <Spinner className="h-5 w-5 text-accent" />
            {!compact && <div className="text-xs font-medium text-fg/90">{enhancingPrompt ? 'Enhancing prompt…' : 'Generating…'}</div>}
            <div className="font-mono text-[11px] tabular-nums text-muted">
              {elapsed}s{job.attempts > 1 && !compact && ` · attempt ${job.attempts}`}
            </div>
          </>
        ) : (
          <>
            <div className="h-2 w-2 rounded-full bg-muted/70 animate-pulse-soft" />
            {!compact && <div className="text-xs font-medium text-muted">{job.error ? 'Retrying soon…' : 'In queue'}</div>}
            {job.queuePosition && <div className="font-mono text-[11px] text-subtle">#{job.queuePosition}</div>}
          </>
        )}
      </div>
      {grid && !compact && <p className="absolute inset-x-3 bottom-2.5 line-clamp-1 text-center text-[11px] text-subtle">{gen.prompt}</p>}
      {running && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/5">
          <div className="h-full w-full origin-left bg-gradient-to-r from-accent-strong to-accent-2 animate-indeterminate" />
        </div>
      )}
      {active && (
        <button
          onClick={() => run(() => api.cancelJob(job.id))}
          aria-label="Cancel"
          title="Cancel"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/70 opacity-0 backdrop-blur transition-opacity hover:text-white group-hover/tile:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
