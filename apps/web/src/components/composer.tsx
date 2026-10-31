'use client';

import {
  ArrowUp,
  Brush,
  Check,
  Dices,
  Folder as FolderIcon,
  FolderPlus,
  ImagePlus,
  Inbox,
  Loader2,
  Lock,
  RectangleHorizontal,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useConfig, useCreateGeneration, useFolders } from '@/lib/queries';
import { type Reference, useComposer, useUi } from '@/lib/store';
import type { AspectRatio } from '@/lib/types';
import { cn, modKey, ratioValue } from '@/lib/utils';
import { useFolderDialog } from './folders';
import { Button, IconButton, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, Pop, Spinner, Tip } from './ui/primitives';

const RATIOS: AspectRatio[] = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];
const COUNTS = [1, 2, 3, 4, 8];

export function Composer() {
  const c = useComposer();
  const { data: config } = useConfig();
  const create = useCreateGeneration();
  const openInpaint = useUi((s) => s.openInpaint);
  const [enhancing, setEnhancing] = useState(false);
  const historyIndex = useRef(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const maxRefs = config?.limits.maxInputImages ?? 4;

  // Autosize the prompt box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [c.prompt]);

  // External focus requests (e.g. "Reuse prompt", "/" shortcut).
  useEffect(() => {
    if (!c.focusToken) return;
    const el = textareaRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [c.focusToken]);

  const uploading = c.references.some((r) => r.status === 'uploading');
  const readyRefs = c.references.filter((r) => r.status === 'ready' && r.asset);
  const canSubmit = c.prompt.trim().length > 0 && !uploading && !enhancing;

  const submit = () => {
    if (!canSubmit) return;
    const prompt = c.prompt.trim();
    create.mutate(
      {
        prompt,
        count: c.count,
        aspectRatio: c.aspectRatio,
        seed: c.seed ?? undefined,
        inputImageIds: readyRefs.map((r) => r.asset!.id),
        enhance: c.autoEnhance,
        folderId: c.folderId ?? undefined,
      },
      {
        onSuccess: () => {
          // Clear the box for the next idea (↑ brings this prompt back).
          useComposer.getState().commitPrompt(prompt);
          historyIndex.current = -1;
          toast.success(`Queued ${c.count} image${c.count > 1 ? 's' : ''}`, { duration: 1800 });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
      },
    );
  };

  const enhance = async () => {
    if (!c.prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const { prompt } = await api.enhancePrompt(c.prompt, readyRefs.map((r) => r.asset!.id));
      c.applyEnhanced(prompt);
      toast.success('Prompt enhanced', {
        description: 'Undo anytime with the ↺ button',
        duration: 2500,
      });
    } catch (err) {
      toast.error('Enhancement failed', { description: (err as Error).message });
    } finally {
      setEnhancing(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // Shell-style history: ↑/↓ cycle through previous prompts while the box is empty or browsing.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && c.history.length && (!c.prompt || historyIndex.current >= 0)) {
      const atEdge = e.key === 'ArrowUp' ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
      if (atEdge || !c.prompt) {
        const next = historyIndex.current + (e.key === 'ArrowUp' ? 1 : -1);
        if (next < -1 || next >= c.history.length) return;
        e.preventDefault();
        historyIndex.current = next;
        c.setPrompt(next === -1 ? '' : c.history[next]);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      // Plain Enter submits too (Shift+Enter = newline), like a chat box.
      e.preventDefault();
      submit();
    }
  };

  const ratioOptions: AspectRatio[] = readyRefs.length || c.references.length ? ['auto', ...RATIOS] : RATIOS;

  return (
    <div
      className={cn(
        'group/composer relative rounded-2xl border border-line-strong bg-surface/90 shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl transition-colors',
        'focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_rgb(139_92_246/0.08),0_20px_60px_-20px_rgb(0_0_0/0.8)]',
      )}
    >
      {c.references.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
          {c.references.map((ref, i) => (
            <ReferenceChip
              key={ref.key}
              reference={ref}
              index={i}
              onRemove={() => c.removeReference(ref.key)}
              onInpaint={ref.asset ? () => openInpaint(ref.asset!) : undefined}
            />
          ))}
          {c.references.length > 1 && (
            <button onClick={c.clearReferences} className="ml-1 text-xs text-subtle hover:text-fg">
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <textarea
          ref={textareaRef}
          value={c.prompt}
          onChange={(e) => {
            historyIndex.current = -1;
            c.setPrompt(e.target.value);
          }}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={enhancing}
          placeholder={
            c.references.length
              ? 'Describe how to transform the image(s)… e.g. “make it a watercolor painting”'
              : 'Describe the image you want to create…'
          }
          className="block w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed text-fg placeholder:text-subtle focus:outline-none disabled:opacity-60"
        />
        {enhancing && (
          <div className="pointer-events-none absolute inset-x-3 inset-y-2 overflow-hidden rounded-xl">
            <div className="skeleton skeleton-active absolute inset-0 opacity-70" />
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-accent">
              <Sparkles className="h-4 w-4 animate-pulse-soft" /> Enhancing your prompt…
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            c.addFiles(Array.from(e.target.files ?? []), maxRefs);
            e.target.value = '';
          }}
        />
        <IconButton
          label={c.references.length >= maxRefs ? `Max ${maxRefs} images` : 'Add reference images (or paste / drop)'}
          onClick={() => fileRef.current?.click()}
          disabled={c.references.length >= maxRefs}
        >
          <ImagePlus className="h-[18px] w-[18px]" />
        </IconButton>

        <AspectPicker value={c.aspectRatio} options={ratioOptions} onChange={c.setAspectRatio} reference={readyRefs[0]?.asset} />
        <CountPicker value={c.count} onChange={c.setCount} />
        <SeedPicker value={c.seed} onChange={c.setSeed} />
        <FolderPicker value={c.folderId} onChange={c.setFolderId} />

        <div className="ml-auto flex items-center gap-1">
          {c.promptBeforeEnhance !== null && !enhancing && (
            <IconButton label="Undo enhancement" onClick={c.undoEnhance}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
          )}
          <Tip label={c.autoEnhance ? 'Auto-enhance on submit: ON' : 'Auto-enhance on submit: OFF'}>
            <button
              onClick={() => c.setAutoEnhance(!c.autoEnhance)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                c.autoEnhance ? 'bg-accent/15 text-accent' : 'text-subtle hover:bg-white/5 hover:text-fg',
              )}
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Auto</span>
            </button>
          </Tip>
          <Button variant="ghost" size="sm" onClick={enhance} disabled={!c.prompt.trim() || enhancing} className="text-accent hover:text-accent">
            {enhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="hidden sm:inline">Enhance</span>
          </Button>
          <Tip label="Generate" shortcut="↵">
            <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit || create.isPending} className="ml-1 pl-3 pr-3.5">
              {create.isPending ? <Spinner /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
              Generate
              <span className="hidden rounded bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:inline">×{c.count}</span>
            </Button>
          </Tip>
        </div>
      </div>
    </div>
  );
}

function ReferenceChip({
  reference,
  index,
  onRemove,
  onInpaint,
}: {
  reference: Reference;
  index: number;
  onRemove: () => void;
  onInpaint?: () => void;
}) {
  return (
    <div className="group/ref relative h-16 w-16 overflow-hidden rounded-xl border border-line-strong bg-surface-2 animate-pop">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white/90 backdrop-blur">
        {index + 1}
      </span>
      {reference.status === 'uploading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <Spinner className="text-white" />
        </div>
      )}
      {reference.status === 'error' && (
        <Tip label={reference.error ?? 'Upload failed'}>
          <div className="absolute inset-0 flex items-center justify-center bg-danger/40 text-[10px] font-semibold text-white">
            Failed
          </div>
        </Tip>
      )}
      <button
        onClick={onRemove}
        aria-label="Remove image"
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover/ref:opacity-100 focus:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
      {onInpaint && (
        <button
          onClick={onInpaint}
          className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded-md bg-black/70 py-0.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover/ref:opacity-100 focus:opacity-100"
        >
          <Brush className="h-3 w-3" /> Inpaint
        </button>
      )}
    </div>
  );
}

function RatioShape({ ratio, active, reference }: { ratio: AspectRatio; active?: boolean; reference?: { width: number; height: number } }) {
  const r = ratioValue(ratio, reference);
  const max = 16;
  const w = r >= 1 ? max : Math.round(max * r);
  const h = r >= 1 ? Math.round(max / r) : max;
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span
        className={cn('rounded-[3px] border-[1.5px]', active ? 'border-accent' : 'border-current', ratio === 'auto' && 'border-dashed')}
        style={{ width: w, height: h }}
      />
    </span>
  );
}

function AspectPicker({
  value,
  options,
  onChange,
  reference,
}: {
  value: AspectRatio;
  options: AspectRatio[];
  onChange: (r: AspectRatio) => void;
  reference?: { width: number; height: number };
}) {
  return (
    <Pop
      trigger={
        <button className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-white/5 hover:text-fg data-[state=open]:bg-white/5 data-[state=open]:text-fg">
          <RatioShape ratio={value} reference={reference} />
          {value === 'auto' ? 'Auto' : value}
        </button>
      }
      className="w-[264px]"
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-subtle">
        <RectangleHorizontal className="h-3.5 w-3.5" /> Aspect ratio
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((r) => (
          <button
            key={r}
            onClick={() => onChange(r)}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs transition-colors',
              r === value ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg',
            )}
          >
            <RatioShape ratio={r} active={r === value} reference={reference} />
            {r === 'auto' ? 'Match input' : r}
          </button>
        ))}
      </div>
    </Pop>
  );
}

function CountPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Tip label="Number of variants">
      <div className="flex h-8 items-center rounded-lg bg-white/[0.03] p-0.5">
        {COUNTS.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              'h-7 min-w-7 rounded-md px-1.5 text-[13px] font-medium tabular-nums transition-colors',
              n === value ? 'bg-surface-3 text-fg shadow-sm' : 'text-subtle hover:text-fg',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </Tip>
  );
}

function SeedPicker({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  useEffect(() => setDraft(value?.toString() ?? ''), [value]);
  return (
    <Pop
      trigger={
        <button
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-white/5 data-[state=open]:bg-white/5',
            value === null ? 'text-muted hover:text-fg' : 'text-accent',
          )}
        >
          {value === null ? <Dices className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{value === null ? 'Random' : value}</span>
        </button>
      }
      className="w-64"
    >
      <div className="mb-1 text-xs font-medium text-subtle">Seed</div>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        Fix a seed to get reproducible results. Variants use seed, seed+1, seed+2…
      </p>
      <div className="flex gap-2">
        <input
          value={draft}
          inputMode="numeric"
          placeholder="Random"
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 10))}
          onBlur={() => onChange(draft ? Math.min(2_147_483_647, Number(draft)) : null)}
          onKeyDown={(e) => e.key === 'Enter' && onChange(draft ? Math.min(2_147_483_647, Number(draft)) : null)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 font-mono text-sm outline-none focus:border-accent/50"
        />
        <IconButton label="Random seed value" variant="secondary" onClick={() => onChange(Math.floor(Math.random() * 1_000_000_000))}>
          <Dices className="h-4 w-4" />
        </IconButton>
      </div>
      {value !== null && (
        <button onClick={() => onChange(null)} className="mt-2 text-xs text-subtle hover:text-fg">
          Back to random
        </button>
      )}
      <div className="mt-3 border-t border-line pt-2 text-[11px] text-subtle">
        Tip: <Kbd>↵</Kbd> to generate, <Kbd>⇧</Kbd> <Kbd>↵</Kbd> for a new line, <Kbd>↑</Kbd> in an empty box recalls previous prompts.
      </div>
    </Pop>
  );
}

function FolderPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data } = useFolders();
  const openDialog = useFolderDialog((s) => s.open);
  const current = data?.items.find((f) => f.id === value);
  return (
    <Menu
      align="start"
      trigger={
        <button
          className={cn(
            'flex h-8 max-w-[160px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-white/5 data-[state=open]:bg-white/5',
            current ? 'text-accent' : 'text-muted hover:text-fg',
          )}
          title="Folder to save new images into"
        >
          <FolderIcon className="h-4 w-4 shrink-0" />
          <span className="hidden truncate sm:inline">{current?.name ?? 'No folder'}</span>
        </button>
      }
    >
      <MenuLabel>Save new images to</MenuLabel>
      <MenuItem icon={value === null ? <Check /> : <Inbox />} onSelect={() => onChange(null)}>
        No folder
      </MenuItem>
      {data?.items.map((f) => (
        <MenuItem key={f.id} icon={f.id === value ? <Check /> : <FolderIcon />} onSelect={() => onChange(f.id)}>
          {f.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<FolderPlus />} onSelect={() => openDialog({ mode: 'create', onCreated: (f) => onChange(f.id) })}>
        New folder…
      </MenuItem>
    </Menu>
  );
}
