'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';
import type { Asset, AspectRatio, FolderScope, LoraRef } from './types';

export interface Reference {
  key: string;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  asset?: Asset;
  error?: string;
  /** Uploaded from this composer (vs. an existing image reused as reference). */
  uploaded?: boolean;
}

interface ComposerState {
  prompt: string;
  /** Prompt before the last "enhance", so it can be undone. */
  promptBeforeEnhance: string | null;
  references: Reference[];
  aspectRatio: AspectRatio;
  count: number;
  seed: number | null;
  autoEnhance: boolean;
  /** Selected image model id (null = the server's default). */
  model: string | null;
  /** Enabled LoRAs, remembered per model id. */
  loras: Record<string, LoraRef[]>;
  focusToken: number;
  /** Folder new generations go into (null = no folder). */
  folderId: string | null;
  /** Recently submitted prompts, newest first (↑ in an empty prompt box recalls them). */
  history: string[];

  setFolderId: (id: string | null) => void;
  /** Called after a successful submit: remembers the prompt and clears the box. */
  commitPrompt: (prompt: string) => void;
  setPrompt: (prompt: string) => void;
  applyEnhanced: (prompt: string) => void;
  undoEnhance: () => void;
  setAspectRatio: (r: AspectRatio) => void;
  setCount: (n: number) => void;
  setSeed: (n: number | null) => void;
  setAutoEnhance: (v: boolean) => void;
  setModel: (id: string) => void;
  /** Turns a LoRA on (at `defaultScale`) or off for `model`. */
  toggleLora: (model: string, id: string, defaultScale: number) => void;
  setLoraScale: (model: string, id: string, scale: number) => void;
  clearLoras: (model: string) => void;
  addFiles: (files: File[], max: number) => Promise<void>;
  addAsset: (asset: Asset, max: number) => boolean;
  removeReference: (key: string) => void;
  /** Drops references to assets that were deleted. */
  forgetAssets: (ids: string[]) => void;
  clearReferences: () => void;
  /** Removes a prompt from the ↑ history (its generation was deleted). */
  forgetPrompt: (prompt: string) => void;
  focus: () => void;
}

let keySeq = 0;

export const useComposer = create<ComposerState>()(
  persist(
    (set, get) => ({
      prompt: '',
      promptBeforeEnhance: null,
      references: [],
      aspectRatio: '1:1',
      count: 1,
      seed: null,
      autoEnhance: false,
      model: null,
      loras: {},
      focusToken: 0,
      folderId: null,
      history: [],

      setFolderId: (folderId) => set({ folderId }),
      commitPrompt: (prompt) =>
        set((s) => ({
          prompt: s.prompt.trim() === prompt.trim() ? '' : s.prompt,
          promptBeforeEnhance: null,
          history: [prompt, ...s.history.filter((p) => p !== prompt)].slice(0, 50),
        })),
      setPrompt: (prompt) => set({ prompt }),
      applyEnhanced: (prompt) => set((s) => ({ promptBeforeEnhance: s.prompt, prompt })),
      undoEnhance: () => set((s) => (s.promptBeforeEnhance !== null ? { prompt: s.promptBeforeEnhance, promptBeforeEnhance: null } : {})),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setCount: (count) => set({ count }),
      setSeed: (seed) => set({ seed }),
      setAutoEnhance: (autoEnhance) => set({ autoEnhance }),
      setModel: (model) => set({ model }),
      toggleLora: (model, id, defaultScale) =>
        set((s) => {
          const current = s.loras[model] ?? [];
          const next = current.some((l) => l.id === id) ? current.filter((l) => l.id !== id) : [...current, { id, scale: defaultScale }];
          return { loras: { ...s.loras, [model]: next } };
        }),
      setLoraScale: (model, id, scale) =>
        set((s) => ({ loras: { ...s.loras, [model]: (s.loras[model] ?? []).map((l) => (l.id === id ? { ...l, scale } : l)) } })),
      clearLoras: (model) => set((s) => ({ loras: { ...s.loras, [model]: [] } })),
      focus: () => set((s) => ({ focusToken: s.focusToken + 1 })),

      addFiles: async (files, max) => {
        const images = files.filter((f) => f.type.startsWith('image/'));
        const room = Math.max(0, max - get().references.length);
        const accepted = images.slice(0, room);
        if (!accepted.length) return;
        const added: Reference[] = accepted.map((f) => ({
          key: `ref-${++keySeq}`,
          previewUrl: URL.createObjectURL(f),
          status: 'uploading',
          uploaded: true,
        }));
        set((s) => ({
          references: [...s.references, ...added],
          aspectRatio: s.references.length === 0 ? 'auto' : s.aspectRatio,
        }));
        await Promise.all(
          accepted.map(async (file, i) => {
            const key = added[i].key;
            try {
              const [asset] = await api.upload([file]);
              // Removed while uploading (the upload stays on the Uploads page).
              if (!get().references.some((r) => r.key === key)) return;
              set((s) => ({ references: s.references.map((r) => (r.key === key ? { ...r, status: 'ready', asset } : r)) }));
            } catch (err) {
              set((s) => ({
                references: s.references.map((r) =>
                  r.key === key ? { ...r, status: 'error', error: (err as Error).message } : r,
                ),
              }));
            }
          }),
        );
      },

      addAsset: (asset, max) => {
        const refs = get().references;
        if (refs.some((r) => r.asset?.id === asset.id)) return true;
        if (refs.length >= max) return false;
        set((s) => ({
          references: [...s.references, { key: `ref-${++keySeq}`, previewUrl: asset.thumbUrl, status: 'ready', asset }],
          aspectRatio: s.references.length === 0 ? 'auto' : s.aspectRatio,
        }));
        return true;
      },

      removeReference: (key) =>
        set((s) => {
          const references = s.references.filter((r) => r.key !== key);
          return {
            references,
            aspectRatio: references.length === 0 && s.aspectRatio === 'auto' ? '1:1' : s.aspectRatio,
          };
        }),
      clearReferences: () => set((s) => ({ references: [], aspectRatio: s.aspectRatio === 'auto' ? '1:1' : s.aspectRatio })),
      forgetAssets: (ids) =>
        set((s) => {
          const references = s.references.filter((r) => !r.asset || !ids.includes(r.asset.id));
          if (references.length === s.references.length) return {};
          return { references, aspectRatio: references.length === 0 && s.aspectRatio === 'auto' ? '1:1' : s.aspectRatio };
        }),
      forgetPrompt: (prompt) => set((s) => ({ history: s.history.filter((p) => p !== prompt) })),
    }),
    {
      name: 'imagegen-composer',
      version: 2,
      // v2: new defaults (1 variant, the server's default model, now Qwen-Image 2.1).
      migrate: (persisted: any, version) => {
        const state = persisted ?? {};
        return version < 2 ? { ...state, count: 1, model: null, loras: state.loras ?? {} } : state;
      },
      // Persist settings + draft, not in-flight uploads.
      partialize: (s) => ({
        prompt: s.prompt,
        aspectRatio: s.aspectRatio === 'auto' ? '1:1' : s.aspectRatio,
        count: s.count,
        autoEnhance: s.autoEnhance,
        model: s.model,
        loras: s.loras,
        history: s.history,
      }),
    },
  ),
);

export type ViewMode = 'grid' | 'list';
export type Density = 'sm' | 'md' | 'lg';

interface UiState {
  /** Image (job id) open in the lightbox. */
  lightboxJobId: string | null;
  /** Asset being inpainted. */
  inpaintAsset: Asset | null;
  apiDialogOpen: boolean;
  search: string;
  folder: FolderScope;
  /** Selected image (job) ids in the grid. */
  selection: string[];
  /** Ids of every selectable image currently loaded in the grid (newest first). */
  selectable: string[];
  view: ViewMode;
  density: Density;
  openLightbox: (jobId: string) => void;
  closeLightbox: () => void;
  openInpaint: (asset: Asset) => void;
  closeInpaint: () => void;
  setApiDialogOpen: (v: boolean) => void;
  setSearch: (q: string) => void;
  setFolder: (folder: FolderScope) => void;
  toggleSelected: (jobId: string, range?: string[]) => void;
  setSelection: (ids: string[]) => void;
  setSelectable: (ids: string[]) => void;
  /** Adds `ids` to the selection, or removes them all when every one is already selected. */
  toggleMany: (ids: string[]) => void;
  clearSelection: () => void;
  setView: (view: ViewMode) => void;
  setDensity: (density: Density) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      lightboxJobId: null,
      inpaintAsset: null,
      apiDialogOpen: false,
      search: '',
      folder: 'all',
      selection: [],
      selectable: [],
      view: 'grid',
      density: 'md',
      openLightbox: (lightboxJobId) => set({ lightboxJobId }),
      closeLightbox: () => set({ lightboxJobId: null }),
      openInpaint: (inpaintAsset) => set({ inpaintAsset }),
      closeInpaint: () => set({ inpaintAsset: null }),
      setApiDialogOpen: (apiDialogOpen) => set({ apiDialogOpen }),
      setSearch: (search) => set({ search }),
      setFolder: (folder) => {
        set({ folder, selection: [] });
        // Generating while inside a folder targets that folder by default.
        useComposer.getState().setFolderId(folder === 'all' || folder === 'none' ? null : folder);
      },
      toggleSelected: (jobId, range) =>
        set((s) => {
          if (range?.length) return { selection: [...new Set([...s.selection, ...range])] };
          return { selection: s.selection.includes(jobId) ? s.selection.filter((id) => id !== jobId) : [...s.selection, jobId] };
        }),
      setSelection: (selection) => set({ selection }),
      setSelectable: (selectable) =>
        // Drop selected images that disappeared (deleted, filtered out).
        set((s) => ({ selectable, selection: s.selection.filter((id) => selectable.includes(id)) })),
      toggleMany: (ids) =>
        set((s) => {
          const all = ids.every((id) => s.selection.includes(id));
          return { selection: all ? s.selection.filter((id) => !ids.includes(id)) : [...new Set([...s.selection, ...ids])] };
        }),
      clearSelection: () => set({ selection: [] }),
      setView: (view) => set({ view }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: 'imagegen-ui',
      version: 1,
      partialize: (s) => ({ view: s.view, density: s.density, folder: s.folder }),
    },
  ),
);
