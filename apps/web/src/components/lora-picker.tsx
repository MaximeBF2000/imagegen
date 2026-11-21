'use client';

import { AlertCircle, Check, ExternalLink, ImageIcon, Layers, Search, TextCursorInput } from 'lucide-react';
import { useState } from 'react';
import { useActiveLoras } from '@/lib/queries';
import { useComposer } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Pop } from './ui/primitives';

/**
 * Picks the LoRAs applied to new generations. Only rendered when the active model
 * has LoRAs (the model → LoRA mapping comes from GET /api/config → image.loras);
 * the selection is remembered per model.
 */
export function LoraPicker() {
  const { model, available, enabled } = useActiveLoras();
  const toggle = useComposer((s) => s.toggleLora);
  const setScale = useComposer((s) => s.setLoraScale);
  const clear = useComposer((s) => s.clearLoras);
  const setPrompt = useComposer((s) => s.setPrompt);
  const focusPrompt = useComposer((s) => s.focus);
  const [query, setQuery] = useState('');
  if (!model || !available.length) return null;

  const q = query.trim().toLowerCase();
  const shown = q
    ? available.filter((l) => [l.label, l.description, l.trigger].some((t) => t?.toLowerCase().includes(q)))
    : available;
  const label = enabled.length === 0 ? 'LoRA' : enabled.length === 1 ? available.find((l) => l.id === enabled[0].id)!.label : `${enabled.length} LoRAs`;

  return (
    <Pop
      trigger={
        <button
          className={cn(
            'flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-white/5 data-[state=open]:bg-white/5',
            enabled.length ? 'text-accent' : 'text-muted hover:text-fg',
          )}
          title="LoRAs applied to new images"
        >
          <Layers className="h-4 w-4 shrink-0" />
          <span className="hidden truncate sm:inline">{label}</span>
          {enabled.length > 0 && <span className="rounded bg-accent/15 px-1 text-[11px] tabular-nums sm:hidden">{enabled.length}</span>}
        </button>
      }
      className="w-[320px] p-0"
    >
      <div className="flex items-center justify-between px-3 pt-3 text-xs font-medium text-subtle">
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" /> LoRAs for {model.label}
        </span>
        {enabled.length > 0 && (
          <button onClick={() => clear(model.id)} className="text-subtle hover:text-fg">
            Clear
          </button>
        )}
      </div>
      <div className="relative mx-3 mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search LoRAs…"
          className="h-8 w-full rounded-lg border border-line-strong bg-bg pl-8 pr-2 text-[13px] outline-none placeholder:text-subtle focus:border-accent/50"
        />
      </div>
      <div className="mt-2 max-h-[320px] overflow-y-auto px-1.5 pb-1.5">
        {shown.length === 0 && <p className="px-2 py-4 text-center text-xs text-subtle">No LoRA matches “{query}”.</p>}
        {shown.map((l) => {
          const on = enabled.find((r) => r.id === l.id);
          return (
            <div key={l.id} className={cn('rounded-lg', on && 'bg-accent/[0.06]')}>
              <button
                onClick={() => toggle(model.id, l.id, l.defaultScale)}
                disabled={!!l.issue}
                aria-pressed={!!on}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    on ? 'border-accent bg-accent text-white' : 'border-line-strong',
                  )}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                    <span className="truncate">{l.label}</span>
                    {l.trigger && <code className="shrink-0 rounded bg-white/5 px-1 font-mono text-[10px] text-subtle">{l.trigger}</code>}
                    {l.needsImage && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded bg-sky-400/10 px-1 text-[10px] font-normal text-sky-300" title="Edits a reference image">
                        <ImageIcon className="h-2.5 w-2.5" /> edit
                      </span>
                    )}
                  </span>
                  {l.description && <span className="mt-0.5 block text-[11px] leading-snug text-subtle">{l.description}</span>}
                  {l.issue && (
                    <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-warn">
                      <AlertCircle className="mt-px h-3 w-3 shrink-0" /> {l.issue}
                    </span>
                  )}
                </span>
                {l.source && (
                  <a
                    href={l.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 text-subtle hover:text-fg"
                    title="Model page"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </button>
              {on && l.usage && <p className="px-2 pb-1.5 pl-[34px] text-[11px] leading-snug text-muted">{l.usage}</p>}
              {on && l.promptTemplate && (
                <button
                  onClick={() => {
                    setPrompt(l.promptTemplate!);
                    focusPrompt();
                  }}
                  className="mb-1.5 ml-[34px] flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10"
                  title={l.promptTemplate}
                >
                  <TextCursorInput className="h-3 w-3" /> Use its prompt
                </button>
              )}
              {on && (
                <label className="flex items-center gap-2 px-2 pb-2 pl-[34px] text-[11px] text-subtle">
                  Strength
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={on.scale}
                    onChange={(e) => setScale(model.id, l.id, Number(e.target.value))}
                    className="h-1 flex-1 accent-[rgb(139_92_246)]"
                  />
                  <span className="w-8 text-right font-mono tabular-nums text-fg">{on.scale.toFixed(2)}</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {enabled.some((r) => available.find((l) => l.id === r.id)?.trigger) && (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-subtle">Trigger words are added to the start of the prompt automatically.</p>
      )}
    </Pop>
  );
}
