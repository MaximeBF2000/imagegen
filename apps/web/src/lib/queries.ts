'use client';

import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import { useComposer } from './store';
import type { CreateGenerationInput, FolderList, FolderScope, Generation, GenerationPage, ImageEntry, ImageModelInfo, Job, QueueStats } from './types';
import { prettyModel } from './utils';

type Feed = InfiniteData<GenerationPage, string | null>;

export const keys = {
  config: ['config'] as const,
  queue: ['queue'] as const,
  feed: (folder: FolderScope, q: string) => ['generations', folder, q] as const,
  folders: ['folders'] as const,
};

/** Does an image belong to the given folder scope? */
export const jobInScope = (job: Pick<Job, 'folderId'>, folder: FolderScope) =>
  folder === 'all' || (folder === 'none' ? !job.folderId : job.folderId === folder);

export const visibleJobs = (gen: Generation, folder: FolderScope) => gen.jobs.filter((j) => jobInScope(j, folder));

export function useFolders() {
  return useQuery<FolderList>({ queryKey: keys.folders, queryFn: api.folders, staleTime: 30_000 });
}

export function useConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: api.config,
    // Poll quickly while the API or the model is starting up.
    refetchInterval: (q) => (q.state.error || q.state.data?.ready === false ? 2500 : 60_000),
    retry: false,
  });
}

/** The image model picked in the UI, falling back to the server default (or if the pick no longer exists). */
export function useActiveModel(): ImageModelInfo | undefined {
  const { data: config } = useConfig();
  const picked = useComposer((s) => s.model);
  const models = config?.image.models ?? [];
  return models.find((m) => m.id === picked) ?? models.find((m) => m.id === config?.image.model) ?? models[0];
}

/** Display name for a model id stored on a generation. */
export function useModelLabel() {
  const { data: config } = useConfig();
  return (id: string) => config?.image.models.find((m) => m.id === id)?.label ?? prettyModel(id);
}

export function useQueueStats() {
  return useQuery<QueueStats>({ queryKey: keys.queue, queryFn: api.queue, staleTime: Infinity });
}

export function useFeed(folder: FolderScope, q: string) {
  return useInfiniteQuery({
    queryKey: keys.feed(folder, q),
    queryFn: ({ pageParam }) => api.listGenerations({ cursor: pageParam, q, folder }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });
}

/** All generated images currently loaded in the feed (current folder), newest first. */
export function useImageEntries(folder: FolderScope, q: string): ImageEntry[] {
  const { data } = useFeed(folder, q);
  return useMemo(() => {
    const out: ImageEntry[] = [];
    for (const page of data?.pages ?? []) {
      for (const generation of page.items) {
        for (const job of generation.jobs) if (job.image && jobInScope(job, folder)) out.push({ job, image: job.image, generation });
      }
    }
    return out;
  }, [data]);
}

/** Insert, replace or drop a generation in every cached feed, honoring each feed's folder scope. */
export function upsertGeneration(qc: QueryClient, gen: Generation) {
  for (const [key, feed] of qc.getQueriesData<Feed>({ queryKey: ['generations'] })) {
    if (!feed) continue;
    const [, folder = 'all', q = ''] = key as [string, FolderScope?, string?];
    const belongs = gen.jobs.some((j) => jobInScope(j, folder));
    let found = false;
    const pages = feed.pages.map((p) => ({
      ...p,
      items: p.items.flatMap((g) => {
        if (g.id !== gen.id) return [g];
        found = true;
        return belongs ? [gen] : [];
      }),
    }));
    if (!found && belongs && !q && pages[0]) {
      // New generation (or moved into this folder): newest first, if newer than the top of the list.
      const top = pages[0].items[0];
      if (!top || top.createdAt <= gen.createdAt) pages[0] = { ...pages[0], items: [gen, ...pages[0].items] };
      else {
        // Older generation moved into this folder: refetch to place it correctly.
        void qc.invalidateQueries({ queryKey: key, exact: true });
      }
    }
    qc.setQueryData<Feed>(key, { ...feed, pages });
  }
}

export function removeGeneration(qc: QueryClient, id: string) {
  qc.setQueriesData<Feed>({ queryKey: ['generations'] }, (feed) =>
    feed ? { ...feed, pages: feed.pages.map((p) => ({ ...p, items: p.items.filter((g) => g.id !== id) })) } : feed,
  );
}

/** Live updates over Server-Sent Events; keeps the React Query cache in sync. */
export function useLiveEvents() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let folderTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshFolders = () => {
      clearTimeout(folderTimer);
      folderTimer = setTimeout(() => qc.invalidateQueries({ queryKey: keys.folders }), 400);
    };

    const connect = () => {
      es = new EventSource(api.eventsUrl());
      es.onopen = () => {
        setConnected(true);
        // Catch up on anything missed while disconnected.
        qc.invalidateQueries({ queryKey: ['generations'] });
        qc.invalidateQueries({ queryKey: keys.config });
        qc.invalidateQueries({ queryKey: keys.folders });
      };
      es.addEventListener('generation', (e) => {
        const gen: Generation = JSON.parse((e as MessageEvent).data);
        upsertGeneration(qc, gen);
        // Folder image counts change when images finish.
        if (gen.jobs.some((j) => j.status === 'succeeded')) refreshFolders();
      });
      es.addEventListener('generation.deleted', (e) => {
        removeGeneration(qc, JSON.parse((e as MessageEvent).data).id);
        refreshFolders();
      });
      es.addEventListener('folders', () => refreshFolders());
      es.addEventListener('queue', (e) => qc.setQueryData(keys.queue, JSON.parse((e as MessageEvent).data)));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(folderTimer);
      es?.close();
    };
  }, [qc]);

  return connected;
}

export function useCreateGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGenerationInput) => api.createGeneration(input),
    onSuccess: (gen) => upsertGeneration(qc, gen),
    onError: (err) => toast.error('Could not queue generation', { description: (err as Error).message }),
  });
}

/** Small helper for fire-and-forget actions with toast feedback. */
export function useAction() {
  const qc = useQueryClient();
  return async <T,>(fn: () => Promise<T>, opts: { success?: string; error?: string } = {}) => {
    try {
      const out = await fn();
      if (out && typeof out === 'object' && 'jobs' in (out as object)) upsertGeneration(qc, out as unknown as Generation);
      if (opts.success) toast.success(opts.success);
      return out;
    } catch (err) {
      toast.error(opts.error ?? 'Something went wrong', { description: (err as Error).message });
      return undefined;
    }
  };
}

export function useDeleteGeneration() {
  const qc = useQueryClient();
  return async (id: string) => {
    removeGeneration(qc, id);
    try {
      await api.deleteGeneration(id);
    } catch (err) {
      toast.error('Delete failed', { description: (err as Error).message });
      qc.invalidateQueries({ queryKey: ['generations'] });
    }
  };
}

/** Folder mutations with optimistic-feeling toasts; the SSE stream refreshes lists. */
export function useFolderActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.folders });
    void qc.invalidateQueries({ queryKey: ['generations'] });
  };
  return {
    create: async (name: string) => {
      try {
        const folder = await api.createFolder(name);
        // Make it known immediately (so selecting it doesn't race the refetch).
        qc.setQueryData<FolderList>(keys.folders, (list) => (list ? { ...list, items: [...list.items, folder] } : list));
        void qc.invalidateQueries({ queryKey: keys.folders });
        return folder;
      } catch (err) {
        toast.error('Could not create folder', { description: (err as Error).message });
      }
    },
    rename: async (id: string, name: string) => {
      try {
        await api.renameFolder(id, name);
        void qc.invalidateQueries({ queryKey: keys.folders });
      } catch (err) {
        toast.error('Could not rename folder', { description: (err as Error).message });
      }
    },
    remove: async (id: string, deleteImages: boolean) => {
      try {
        await api.deleteFolder(id, deleteImages);
        refresh();
        toast.success(deleteImages ? 'Folder and its images deleted' : 'Folder deleted, images kept');
      } catch (err) {
        toast.error('Could not delete folder', { description: (err as Error).message });
      }
    },
    move: async (jobIds: string[], folderId: string | null, folderName?: string) => {
      try {
        await api.moveImages(jobIds, folderId);
        refresh();
        const n = jobIds.length;
        toast.success(`${n} image${n > 1 ? 's' : ''} moved ${folderId ? `to “${folderName ?? 'folder'}”` : 'out of folders'}`, { duration: 2000 });
        return true;
      } catch (err) {
        toast.error('Move failed', { description: (err as Error).message });
        return false;
      }
    },
  };
}
