'use client';

import { ImageUpscale } from 'lucide-react';
import { useConfig, useUpscale } from '@/lib/queries';
import type { Asset } from '@/lib/types';
import { MenuItem, MenuLabel, MenuSub } from './ui/primitives';

/**
 * "Upscale" submenu: one item per scale factor of every available upscaler
 * (grouped by upscaler when there are several).
 */
export function UpscaleSub({ image, folderId }: { image: Asset; folderId?: string | null }) {
  const { data: config } = useConfig();
  const upscale = useUpscale();
  const upscalers = config?.upscale?.upscalers ?? [];
  if (!upscalers.length) return null;
  const many = upscalers.length > 1;

  return (
    <MenuSub icon={<ImageUpscale />} label="Upscale">
      {upscalers.map((u) => (
        <div key={u.id}>
          {many && <MenuLabel>{u.label}</MenuLabel>}
          {u.scales.map((scale) => {
            const w = image.width * scale;
            const h = image.height * scale;
            return (
              <MenuItem key={scale} disabled={Math.max(w, h) > u.maxSide} onSelect={() => upscale(image.id, scale, { upscaler: u.id, folderId })}>
                <span className="flex items-center justify-between gap-4">
                  <span>×{scale}</span>
                  <span className="font-mono text-[11px] tabular-nums text-subtle">
                    {w}×{h}
                  </span>
                </span>
              </MenuItem>
            );
          })}
          {!many && (
            <div className="max-w-[220px] px-2.5 pb-1.5 pt-1 text-[11px] leading-snug text-subtle">
              {u.label}
              {u.issue ? ` · ${u.issue}` : ''}
            </div>
          )}
        </div>
      ))}
    </MenuSub>
  );
}
