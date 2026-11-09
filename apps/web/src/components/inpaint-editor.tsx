'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUp, Brush, Eraser, Eye, EyeOff, FlipHorizontal2, Sparkles, Trash, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, withToken } from '@/lib/api';
import { useActiveModel, useCreateGeneration } from '@/lib/queries';
import { useUi } from '@/lib/store';
import type { Asset } from '@/lib/types';
import { cn, modKey } from '@/lib/utils';
import { Button, IconButton, Kbd, Spinner, Tip } from './ui/primitives';

type Tool = 'brush' | 'eraser';
const STROKE = 'rgb(167, 139, 250)';
const MAX_HISTORY = 20;

export function InpaintEditor() {
  const asset = useUi((s) => s.inpaintAsset);
  const close = useUi((s) => s.closeInpaint);
  return (
    <Dialog.Root open={!!asset} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/95 animate-fade-in" />
        <Dialog.Content
          className="fixed inset-0 z-[60] flex flex-col outline-none lg:flex-row"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Inpainting editor</Dialog.Title>
          {asset && <Editor key={asset.id} asset={asset} onDone={close} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Editor({ asset, onDone }: { asset: Asset; onDone: () => void }) {
  const closeLightbox = useUi((s) => s.closeLightbox);
  const create = useCreateGeneration();
  const model = useActiveModel();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const history = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [size, setSize] = useState(48);
  const [showMask, setShowMask] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [hasMask, setHasMask] = useState(false);
  const [historyLen, setHistoryLen] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(2);
  const [enhance, setEnhance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Fit the image into the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const pad = e.contentRect.width < 640 ? 16 : 56;
      const k = Math.min((e.contentRect.width - pad) / asset.width, (e.contentRect.height - pad) / asset.height, 1.5);
      setDisplay({ w: asset.width * k, h: asset.height * k });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asset.width, asset.height]);

  const ctx = () => canvasRef.current!.getContext('2d', { willReadFrequently: true })!;
  const scale = display.w ? asset.width / display.w : 1; // natural px per display px

  const checkMask = useCallback(() => {
    const data = ctx().getImageData(0, 0, asset.width, asset.height).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 0) return setHasMask(true);
    }
    setHasMask(false);
  }, [asset.width, asset.height]);

  const snapshot = () => {
    history.current.push(ctx().getImageData(0, 0, asset.width, asset.height));
    if (history.current.length > MAX_HISTORY) history.current.shift();
    setHistoryLen(history.current.length);
  };

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    ctx().putImageData(prev, 0, 0);
    setHistoryLen(history.current.length);
    checkMask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkMask]);

  const clear = () => {
    snapshot();
    ctx().clearRect(0, 0, asset.width, asset.height);
    setHasMask(false);
  };

  const invert = () => {
    snapshot();
    const c = ctx();
    const img = c.getImageData(0, 0, asset.width, asset.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 167;
      d[i + 1] = 139;
      d[i + 2] = 250;
      d[i + 3] = 255 - d[i + 3];
    }
    c.putImageData(img, 0, 0);
    checkMask();
  };

  const toNatural = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (asset.width / rect.width), y: (e.clientY - rect.top) * (asset.height / rect.height) };
  };

  const strokeTo = (p: { x: number; y: number }) => {
    const c = ctx();
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    c.strokeStyle = STROKE;
    c.fillStyle = STROKE;
    c.lineWidth = size * scale;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const from = last.current ?? p;
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last.current = p;
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input')) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'b') setTool('brush');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === '[') setSize((s) => Math.max(4, Math.round(s / 1.25)));
      else if (e.key === ']') setSize((s) => Math.min(300, Math.round(s * 1.25)));
      else if (e.key === 'h') setShowMask((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const exportMask = async (): Promise<Blob> => {
    const src = canvasRef.current!;
    const white = document.createElement('canvas');
    white.width = asset.width;
    white.height = asset.height;
    const w = white.getContext('2d')!;
    w.drawImage(src, 0, 0);
    w.globalCompositeOperation = 'source-in';
    w.fillStyle = '#fff';
    w.fillRect(0, 0, asset.width, asset.height);
    const out = document.createElement('canvas');
    out.width = asset.width;
    out.height = asset.height;
    const o = out.getContext('2d')!;
    o.fillStyle = '#000';
    o.fillRect(0, 0, asset.width, asset.height);
    o.drawImage(white, 0, 0);
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
  };

  const submit = async () => {
    if (!hasMask) return toast.error('Paint over the area you want to change first');
    if (!prompt.trim()) return toast.error('Describe what should appear in the painted area');
    setSubmitting(true);
    try {
      const [mask] = await api.upload([await exportMask()], 'mask');
      await create.mutateAsync({ prompt: prompt.trim(), model: model?.id, inputImageIds: [asset.id], maskId: mask.id, count, aspectRatio: 'auto', enhance });
      toast.success(`Inpainting ${count} variant${count > 1 ? 's' : ''}…`, { duration: 2000 });
      onDone();
      closeLightbox();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error('Could not start inpainting', { description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex h-14 shrink-0 items-center gap-1 overflow-x-auto px-3">
          <div className="flex items-center rounded-lg bg-white/[0.04] p-0.5">
            <ToolButton active={tool === 'brush'} onClick={() => setTool('brush')} label="Brush" shortcut="B">
              <Brush className="h-4 w-4" />
            </ToolButton>
            <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} label="Eraser" shortcut="E">
              <Eraser className="h-4 w-4" />
            </ToolButton>
          </div>
          <Tip label="Brush size" shortcut="[ ]">
            <label className="ml-2 flex items-center gap-2 text-xs text-muted">
              <span className="hidden sm:inline">Size</span>
              <input
                type="range"
                min={4}
                max={300}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="w-24 accent-[#a78bfa] sm:w-32"
              />
              <span className="w-8 font-mono tabular-nums">{size}</span>
            </label>
          </Tip>
          <div className="mx-2 h-5 w-px bg-line-strong" />
          <IconButton label="Undo" shortcut={`${modKey()} Z`} onClick={undo} disabled={!historyLen} tipSide="bottom">
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <IconButton label="Invert mask" onClick={invert} tipSide="bottom">
            <FlipHorizontal2 className="h-4 w-4" />
          </IconButton>
          <IconButton label="Clear mask" onClick={clear} disabled={!hasMask} tipSide="bottom">
            <Trash className="h-4 w-4" />
          </IconButton>
          <IconButton label={showMask ? 'Hide mask' : 'Show mask'} shortcut="H" onClick={() => setShowMask((v) => !v)} tipSide="bottom">
            {showMask ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </IconButton>
          <div className="ml-auto">
            <Dialog.Close asChild>
              <IconButton label="Close" shortcut="Esc" tipSide="bottom">
                <X className="h-5 w-5" />
              </IconButton>
            </Dialog.Close>
          </div>
        </div>

        {/* Canvas */}
        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div className="relative overflow-hidden rounded-md shadow-2xl" style={{ width: display.w, height: display.h }}>
            {!imgLoaded && <div className="skeleton absolute inset-0" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withToken(asset.url)}
              alt=""
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              className="absolute inset-0 h-full w-full select-none object-cover"
            />
            <canvas
              ref={canvasRef}
              width={asset.width}
              height={asset.height}
              className={cn('absolute inset-0 h-full w-full touch-none transition-opacity', showMask ? 'opacity-60' : 'opacity-0')}
              style={{ cursor: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                snapshot();
                last.current = null;
                strokeTo(toNatural(e));
                if (!showMask) setShowMask(true);
              }}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                if (e.buttons & 1 && last.current) strokeTo(toNatural(e));
              }}
              onPointerUp={() => {
                last.current = null;
                checkMask();
              }}
              onPointerLeave={() => setCursor(null)}
            />
            {cursor && (
              <div
                className={cn(
                  'pointer-events-none absolute rounded-full border-2 mix-blend-difference',
                  tool === 'eraser' ? 'border-dashed border-white' : 'border-white',
                )}
                style={{ width: size, height: size, left: cursor.x - size / 2, top: cursor.y - size / 2 }}
              />
            )}
          </div>
          {!hasMask && imgLoaded && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-line-strong bg-black/70 px-4 py-2 text-xs text-muted backdrop-blur">
              Paint over the area you want to change
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      <aside className="flex shrink-0 flex-col gap-4 border-t border-line bg-surface/80 p-5 backdrop-blur-xl lg:w-[360px] lg:border-l lg:border-t-0">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Brush className="h-4 w-4 text-accent" /> Inpaint
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Paint the region to regenerate, then describe what should appear there. Everything outside the mask is preserved pixel-for-pixel.
          </p>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={4}
          placeholder="e.g. a red vintage bicycle leaning against the wall"
          className="w-full resize-none rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-sm leading-relaxed outline-none placeholder:text-subtle focus:border-accent/50"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">Variants</span>
          <div className="flex rounded-lg bg-white/[0.04] p-0.5">
            {[1, 2, 4].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={cn(
                  'h-7 w-9 rounded-md text-[13px] font-medium tabular-nums',
                  n === count ? 'bg-surface-3 text-fg' : 'text-subtle hover:text-fg',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <label className="flex cursor-pointer items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Enhance prompt with AI
          </span>
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} className="h-4 w-4 accent-[#a78bfa]" />
        </label>
        <Button variant="primary" size="lg" onClick={submit} disabled={submitting || !hasMask || !prompt.trim()} className="mt-auto">
          {submitting ? <Spinner /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />} Generate
        </Button>
        <p className="text-center text-[11px] text-subtle">
          <Kbd>B</Kbd> brush · <Kbd>E</Kbd> eraser · <Kbd>[</Kbd> <Kbd>]</Kbd> size · <Kbd>H</Kbd> hide
        </p>
      </aside>
    </>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  shortcut,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  shortcut: string;
  children: React.ReactNode;
}) {
  return (
    <Tip label={label} shortcut={shortcut} side="bottom">
      <button
        onClick={onClick}
        aria-label={label}
        className={cn('flex h-8 w-9 items-center justify-center rounded-md transition-colors', active ? 'bg-accent/20 text-accent' : 'text-muted hover:text-fg')}
      >
        {children}
      </button>
    </Tip>
  );
}
