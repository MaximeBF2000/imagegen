import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AspectRatio, Generation } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Width / height ratio used to size placeholders before images exist. */
export function ratioOf(gen: Pick<Generation, 'aspectRatio' | 'inputImages' | 'jobs'>): number {
  const done = gen.jobs.find((j) => j.image)?.image;
  if (done) return done.width / done.height;
  return ratioValue(gen.aspectRatio, gen.inputImages[0]);
}

export function ratioValue(ratio: AspectRatio, fallback?: { width: number; height: number }) {
  if (ratio === 'auto') return fallback ? fallback.width / fallback.height : 1;
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

export function prettyModel(model: string) {
  const name = model.split('/').pop() ?? model;
  return name
    .replace(/^flux[.-]?(\d)/i, 'FLUX.$1')
    .replace(/-/g, ' ')
    .replace(/\b(\d+)b\b/i, '$1B')
    .replace(/\bklein\b/i, 'Klein');
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback when the async Clipboard API is unavailable or denied.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    const active = document.activeElement as HTMLElement | null;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    active?.focus?.({ preventScroll: true });
    return ok;
  }
}

/** Triggers a browser download of a cross-origin file (uses Content-Disposition from the API). */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = () => (isMac() ? '⌘' : 'Ctrl');
