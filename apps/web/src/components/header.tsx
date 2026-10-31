'use client';

import { Code2, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useConfig, useQueueStats } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { cn, prettyModel } from '@/lib/utils';
import { Button, Kbd, Tip } from './ui/primitives';

export function Header({ connected }: { connected: boolean }) {
  const { data: config } = useConfig();
  const { data: queue } = useQueueStats();
  const setApiOpen = useUi((s) => s.setApiDialogOpen);
  const busy = (queue?.running ?? 0) + (queue?.queued ?? 0) > 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] max-w-[1680px] items-center gap-3 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">
            Imagegen <span className="font-normal text-subtle">Studio</span>
          </span>
        </a>
        {config && (
          <Tip label={`${config.image.provider} · ${config.image.model}`} side="bottom">
            <span className="hidden rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted md:inline">
              {prettyModel(config.image.model)}
            </span>
          </Tip>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SearchBox />
          <Tip
            label={
              connected
                ? busy
                  ? `${queue?.running} running · ${queue?.queued} waiting · ${queue?.concurrency} at a time`
                  : 'Queue is idle'
                : 'Reconnecting to live updates…'
            }
            side="bottom"
          >
            <div
              className={cn(
                'flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium tabular-nums transition-colors',
                busy ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line bg-surface text-muted',
              )}
            >
              <span className="relative flex h-2 w-2">
                {busy && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />}
                <span
                  className={cn('relative inline-flex h-2 w-2 rounded-full', !connected ? 'bg-warn' : busy ? 'bg-accent' : 'bg-success')}
                />
              </span>
              {busy ? (
                <span>
                  {queue?.running} running
                  {!!queue?.queued && <span className="hidden sm:inline"> · {queue.queued} queued</span>}
                </span>
              ) : (
                <span>{connected ? 'Idle' : 'Offline'}</span>
              )}
            </div>
          </Tip>
          <Button variant="ghost" size="sm" onClick={() => setApiOpen(true)}>
            <Code2 className="h-4 w-4" />
            <span className="hidden sm:inline">API</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function SearchBox() {
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const [draft, setDraft] = useState(search);
  const [open, setOpen] = useState(!!search);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(draft.trim()), 250);
    return () => clearTimeout(t);
  }, [draft, setSearch]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => input.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) {
    return (
      <Tip label="Search prompts" shortcut="⌘K" side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search"
          onClick={() => {
            setOpen(true);
            setTimeout(() => input.current?.focus());
          }}
        >
          <Search className="h-4 w-4" />
        </Button>
      </Tip>
    );
  }
  return (
    <div className="flex h-8 w-44 items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 animate-pop focus-within:border-accent/50 sm:w-64">
      <Search className="h-3.5 w-3.5 shrink-0 text-subtle" />
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft('');
            setOpen(false);
          }
        }}
        onBlur={() => !draft && setOpen(false)}
        placeholder="Search prompts…"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
      />
      {draft ? (
        <button onClick={() => setDraft('')} aria-label="Clear search" className="text-subtle hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Kbd className="hidden sm:inline-flex">esc</Kbd>
      )}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-accent-gradient shadow-[0_4px_16px_-4px_rgb(168_85_247/0.8)]', className)}>
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor" stroke="none" />
        <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none" opacity=".8" />
      </svg>
    </span>
  );
}
