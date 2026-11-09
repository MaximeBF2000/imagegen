'use client';

import { Ban, Brush, ChevronDown, Copy, CornerUpLeft, ImageIcon, MoreHorizontal, RotateCcw, Sparkles, Trash2, Type } from 'lucide-react';
import { memo, useState } from 'react';
import { toast } from 'sonner';
import { api, withToken } from '@/lib/api';
import { useAction, useConfig, useCreateGeneration, useDeleteGeneration, useModelLabel, visibleJobs } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';
import type { Generation } from '@/lib/types';
import { cn, copyText, ratioOf, timeAgo } from '@/lib/utils';
import { CopyablePrompt } from './copyable-prompt';
import { MoveToFolderSub } from './folders';
import { ImageTile } from './image-tile';
import { Menu, MenuItem, MenuSeparator, Tip } from './ui/primitives';

const MODE_META = {
  'text-to-image': { icon: Type, label: 'Text to image' },
  'image-to-image': { icon: ImageIcon, label: 'Image to image' },
  inpaint: { icon: Brush, label: 'Inpaint' },
} as const;

export const GenerationCard = memo(function GenerationCard({ gen }: { gen: Generation }) {
  const [showEnhanced, setShowEnhanced] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { data: config } = useConfig();
  const modelLabel = useModelLabel();
  const composer = useComposer();
  const create = useCreateGeneration();
  const remove = useDeleteGeneration();
  const run = useAction();
  const folder = useUi((s) => s.folder);
  const jobs = visibleJobs(gen, folder);

  const ratio = ratioOf(gen);
  const cols = Math.min(jobs.length || 1, 4);
  // Keep tiles at a pleasant size: wide images get wider tiles, tall ones narrower.
  const tileWidth = Math.min(340, Math.max(170, 300 * Math.sqrt(ratio)));
  const active = gen.progress.queued + gen.progress.running > 0;
  const failedCount = gen.progress.failed + gen.progress.canceled;
  const mode = MODE_META[gen.mode];
  const displayPrompt = gen.enhancedPrompt && showEnhanced ? gen.enhancedPrompt : gen.prompt;
  const maxRefs = config?.limits.maxInputImages ?? 4;

  const reuse = (usePrompt: string) => {
    composer.setPrompt(usePrompt);
    composer.clearReferences();
    for (const a of gen.inputImages) composer.addAsset(a, maxRefs);
    composer.setAspectRatio(gen.aspectRatio);
    composer.setCount(gen.count);
    composer.focus();
  };

  const rerun = () =>
    create.mutate(
      {
        prompt: gen.prompt,
        model: gen.model,
        count: gen.count,
        aspectRatio: gen.aspectRatio,
        inputImageIds: gen.inputImages.map((a) => a.id),
        maskId: gen.mask?.id,
        enhance: gen.enhance,
        folderId: folder !== 'all' && folder !== 'none' ? folder : (gen.folderId ?? undefined),
      },
      { onSuccess: () => toast.success('Queued again with new seeds', { duration: 1800 }) },
    );

  return (
    <article className="group/card animate-fade-in">
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <CopyablePrompt text={displayPrompt} lines={expanded ? 0 : 2} className="-mx-1.5 px-1.5 py-0.5 text-[14.5px] leading-relaxed text-fg/95" />
            {displayPrompt.length > 140 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse prompt' : 'Expand prompt'}
                className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-white/5 hover:text-fg"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
            <span className="flex items-center gap-1">
              <mode.icon className="h-3.5 w-3.5" /> {mode.label}
            </span>
            <span className="tabular-nums">{gen.aspectRatio === 'auto' ? 'Auto ratio' : gen.aspectRatio}</span>
            <span className="tabular-nums">
              {jobs.filter((j) => j.status === 'succeeded').length}/{jobs.length} images
              {jobs.length < gen.jobs.length && <span className="text-subtle"> (+{gen.jobs.length - jobs.length} elsewhere)</span>}
            </span>
            <span>{modelLabel(gen.model)}</span>
            {gen.label && <span className="rounded bg-white/5 px-1.5 py-0.5 text-muted">{gen.label}</span>}
            <time dateTime={gen.createdAt} title={new Date(gen.createdAt).toLocaleString()}>
              {timeAgo(gen.createdAt)}
            </time>
            {gen.enhance && !gen.enhancedPrompt && active && (
              <span className="flex items-center gap-1 text-accent animate-pulse-soft">
                <Sparkles className="h-3 w-3" /> Enhancing…
              </span>
            )}
            {gen.enhancedPrompt && (
              <button
                onClick={() => setShowEnhanced((v) => !v)}
                className="flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20"
              >
                <Sparkles className="h-3 w-3" />
                {showEnhanced ? 'Enhanced · show original' : 'Original · show enhanced'}
              </button>
            )}
          </div>
        </div>

        {gen.inputImages.length > 0 && (
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            {gen.inputImages.map((a, i) => (
              <Tip key={a.id} label={i === 0 && gen.mask ? 'Source image (inpainted)' : `Input ${i + 1}`}>
                <div className="relative h-10 w-10 overflow-hidden rounded-lg ring-1 ring-line-strong">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={withToken(a.thumbUrl)} alt="" className="h-full w-full object-cover" />
                  {i === 0 && gen.mask && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={withToken(gen.mask.thumbUrl)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-60 mix-blend-screen"
                    />
                  )}
                </div>
              </Tip>
            ))}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 sm:has-[[data-state=open]]:opacity-100">
          <Tip label="Reuse settings in prompt box">
            <button
              onClick={() => reuse(gen.prompt)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-fg"
              aria-label="Reuse"
            >
              <CornerUpLeft className="h-4 w-4" />
            </button>
          </Tip>
          <Tip label="Run again (new seeds)">
            <button
              onClick={rerun}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-fg"
              aria-label="Run again"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </Tip>
          <Menu
            trigger={
              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-fg" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <MenuItem icon={<Copy />} onSelect={async () => (await copyText(gen.prompt)) && toast.success('Prompt copied', { duration: 1200 })}>
              Copy prompt
            </MenuItem>
            {gen.enhancedPrompt && (
              <>
                <MenuItem
                  icon={<Sparkles />}
                  onSelect={async () => (await copyText(gen.enhancedPrompt!)) && toast.success('Enhanced prompt copied', { duration: 1200 })}
                >
                  Copy enhanced prompt
                </MenuItem>
                <MenuItem icon={<CornerUpLeft />} onSelect={() => reuse(gen.enhancedPrompt!)}>
                  Reuse enhanced prompt
                </MenuItem>
              </>
            )}
            {jobs.some((j) => j.status === 'succeeded') && (
              <MoveToFolderSub
                jobIds={jobs.filter((j) => j.status === 'succeeded').map((j) => j.id)}
                currentFolderId={folder === 'all' ? undefined : folder === 'none' ? null : folder}
              />
            )}
            {active && (
              <MenuItem icon={<Ban />} onSelect={() => run(() => api.cancelGeneration(gen.id))}>
                Cancel pending
              </MenuItem>
            )}
            {failedCount > 0 && !active && (
              <MenuItem icon={<RotateCcw />} onSelect={() => run(() => api.retryGeneration(gen.id))}>
                Retry failed ({failedCount})
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={() => remove(gen.id)}>
              Delete generation
            </MenuItem>
          </Menu>
        </div>
      </header>

      <div
        className="grid gap-2 sm:gap-2.5 [--cols:min(var(--n),2)] sm:[--cols:var(--n)]"
        style={
          {
            '--n': cols,
            gridTemplateColumns: 'repeat(var(--cols), minmax(0, 1fr))',
            maxWidth: `calc(${cols} * ${tileWidth}px + ${(cols - 1) * 10}px)`,
          } as React.CSSProperties
        }
      >
        {jobs.map((job) => (
          <ImageTile key={job.id} gen={gen} job={job} ratio={ratio} />
        ))}
      </div>
    </article>
  );
});
