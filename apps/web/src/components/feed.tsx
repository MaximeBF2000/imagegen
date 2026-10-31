'use client';

import { FolderOpen, SearchX, ServerCrash } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { API_URL } from '@/lib/api';
import { useFeed, visibleJobs } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';
import type { Generation, Job } from '@/lib/types';
import { GenerationCard } from './generation-card';
import { GridView, SelectionBar } from './grid-view';
import { Button, Spinner } from './ui/primitives';

const EXAMPLES = [
  'A lighthouse on a cliff during a thunderstorm, dramatic long-exposure photography',
  'Isometric cozy reading nook with plants and warm lamp light, soft 3D render',
  'Portrait of an elderly fisherman with a weathered face, golden hour, 85mm film photo',
  'A neon-lit ramen shop in a rainy Tokyo alley at night, cinematic',
  'Minimal flat illustration of a fox sleeping under the moon, pastel palette',
  'Macro shot of a dew-covered spider web at sunrise, bokeh background',
];

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function Feed() {
  const search = useUi((s) => s.search);
  const folder = useUi((s) => s.folder);
  const view = useUi((s) => s.view);
  const density = useUi((s) => s.density);
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeed(folder, search);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && !isFetchingNextPage && fetchNextPage(),
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const groups = useMemo(() => {
    const out: { label: string; items: Generation[] }[] = [];
    for (const page of data?.pages ?? []) {
      for (const gen of page.items) {
        if (!visibleJobs(gen, folder).length) continue;
        const label = dayLabel(gen.createdAt);
        const last = out.at(-1);
        if (last?.label === label) last.items.push(gen);
        else out.push({ label, items: [gen] });
      }
    }
    return out;
  }, [data, folder]);

  const jobs = useMemo(() => {
    const map = new Map<string, Job>();
    for (const page of data?.pages ?? []) for (const gen of page.items) for (const j of gen.jobs) map.set(j.id, j);
    return map;
  }, [data]);

  if (isPending) return <FeedSkeleton grid={view === 'grid'} density={density} />;

  if (isError) {
    return (
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center animate-fade-in">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
          <ServerCrash className="h-6 w-6" />
        </div>
        <h3 className="text-base font-medium">Can&apos;t reach the API</h3>
        <p className="mt-1 text-sm text-muted">
          {(error as Error).message}. Make sure the API server is running (<code className="text-fg">pnpm dev</code>) at{' '}
          <code className="text-fg">{API_URL}</code>.
        </p>
        <Button className="mt-4" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!groups.length) {
    if (search) return <NoResults query={search} />;
    return folder === 'all' ? <EmptyState /> : <EmptyFolder unfiled={folder === 'none'} />;
  }

  return (
    <div className="space-y-10">
      {view === 'grid' ? (
        <GridView groups={groups} />
      ) : (
        groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-subtle">{group.label}</h2>
            <div className="space-y-9">
              {group.items.map((gen) => (
                <GenerationCard key={gen.id} gen={gen} />
              ))}
            </div>
          </section>
        ))
      )}
      <SelectionBar jobs={jobs} />
      <div ref={sentinel} className="flex h-16 items-center justify-center text-subtle">
        {isFetchingNextPage ? <Spinner /> : !hasNextPage && <span className="text-xs">That&apos;s everything ✦</span>}
      </div>
    </div>
  );
}

function FeedSkeleton({ grid, density }: { grid: boolean; density: 'sm' | 'md' | 'lg' }) {
  if (grid) {
    const min = { sm: 130, md: 200, lg: 300 }[density];
    return (
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 45%), 1fr))` }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skeleton aspect-square rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="skeleton mb-2 h-4 w-2/3 rounded" />
          <div className="skeleton mb-4 h-3 w-1/3 rounded" />
          <div className="grid max-w-[1000px] grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="skeleton aspect-square rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const setPrompt = useComposer((s) => s.setPrompt);
  const focus = useComposer((s) => s.focus);
  return (
    <div className="mx-auto mt-10 max-w-2xl text-center animate-fade-in">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        What will you <span className="text-gradient">create</span> today?
      </h2>
      <p className="mt-2 text-sm text-muted">
        Type a prompt, drop or paste images to edit them, then hit Enter. Generations run in the background, so you can queue as many as you like.
      </p>
      <div className="mt-8 grid gap-2 text-left sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setPrompt(ex);
              focus();
            }}
            className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-sm text-muted transition-colors hover:border-line-strong hover:bg-surface hover:text-fg"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyFolder({ unfiled }: { unfiled: boolean }) {
  const focus = useComposer((s) => s.focus);
  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col items-center text-center animate-fade-in">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-subtle">
        <FolderOpen className="h-6 w-6" />
      </div>
      <h3 className="text-base font-medium">{unfiled ? 'Every image is in a folder' : 'This folder is empty'}</h3>
      <p className="mt-1 text-sm text-muted">
        {unfiled
          ? 'Nice and tidy.'
          : 'Generate while this folder is open, or drag images onto it in the sidebar. You can also use “Move to folder” in an image’s menu.'}
      </p>
      {!unfiled && (
        <Button className="mt-4" size="sm" onClick={focus}>
          Write a prompt
        </Button>
      )}
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  const setSearch = useUi((s) => s.setSearch);
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center text-center animate-fade-in">
      <SearchX className="mb-3 h-8 w-8 text-subtle" />
      <p className="text-sm text-muted">
        No generations match <span className="text-fg">“{query}”</span>
      </p>
      <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSearch('')}>
        Clear search
      </Button>
    </div>
  );
}
