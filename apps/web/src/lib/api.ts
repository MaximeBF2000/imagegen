import type { AppConfig, Asset, CreateGenerationInput, Folder, FolderList, FolderScope, Generation, GenerationPage, QueueStats } from './types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4310').replace(/\/$/, '');
const TOKEN = process.env.NEXT_PUBLIC_API_TOKEN || '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_URL}`, 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(msg || `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

/** Appends the token to asset URLs when the API is protected (img tags can't send headers). */
export const withToken = (url: string) => (TOKEN ? `${url}${url.includes('?') ? '&' : '?'}token=${TOKEN}` : url);

export const api = {
  config: () => request<AppConfig>('/config'),
  queue: () => request<QueueStats>('/queue'),
  listGenerations: (params: { cursor?: string | null; q?: string; limit?: number; folder?: FolderScope }) => {
    const qs = new URLSearchParams();
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.q) qs.set('q', params.q);
    if (params.folder && params.folder !== 'all') qs.set('folderId', params.folder);
    qs.set('limit', String(params.limit ?? 12));
    return request<GenerationPage>(`/generations?${qs}`);
  },
  createGeneration: (input: CreateGenerationInput) =>
    request<Generation>('/generations', { method: 'POST', body: JSON.stringify(input) }),
  deleteGeneration: (id: string) => request<void>(`/generations/${id}`, { method: 'DELETE' }),
  cancelGeneration: (id: string) => request<Generation>(`/generations/${id}/cancel`, { method: 'POST' }),
  retryGeneration: (id: string) => request<Generation>(`/generations/${id}/retry`, { method: 'POST' }),
  retryJob: (id: string) => request<Generation>(`/jobs/${id}/retry`, { method: 'POST' }),
  cancelJob: (id: string) => request<Generation>(`/jobs/${id}/cancel`, { method: 'POST' }),
  deleteJob: (id: string) => request<void>(`/jobs/${id}`, { method: 'DELETE' }),
  enhancePrompt: (prompt: string, imageIds: string[] = [], mode?: 'generate' | 'edit' | 'inpaint') =>
    request<{ prompt: string }>('/prompts/enhance', { method: 'POST', body: JSON.stringify({ prompt, imageIds, mode }) }),
  upload: async (files: Blob[], kind: 'upload' | 'mask' = 'upload') => {
    const form = new FormData();
    files.forEach((f, i) => form.append('files', f, f instanceof File ? f.name : `image-${i}.png`));
    form.append('kind', kind);
    return request<Asset[]>('/assets', { method: 'POST', body: form });
  },
  eventsUrl: () => withToken(`${API_URL}/api/events`),

  folders: () => request<FolderList>('/folders'),
  createFolder: (name: string) => request<Folder>('/folders', { method: 'POST', body: JSON.stringify({ name }) }),
  renameFolder: (id: string, name: string) => request<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteFolder: (id: string, deleteImages = false) => request<void>(`/folders/${id}?deleteImages=${deleteImages}`, { method: 'DELETE' }),
  moveImages: (ids: string[], folderId: string | null) =>
    request<{ moved: number }>('/images/move', { method: 'POST', body: JSON.stringify({ ids, folderId }) }),
  /** Streams directly from the API (no memory cost in the browser). */
  archiveUrl: (scope: FolderScope) =>
    withToken(scope === 'all' ? `${API_URL}/api/archive` : scope === 'none' ? `${API_URL}/api/archive?folderId=none` : `${API_URL}/api/folders/${scope}/archive`),
  /** Zip of a selection of images (job ids). */
  archiveSelection: async (ids: string[]) => {
    const res = await fetch(`${API_URL}/api/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
    return res.blob();
  },
};
