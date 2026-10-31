'use client';

import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfig } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';

/** Window-wide drag & drop and clipboard paste of images into the composer. */
export function DropZone() {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const { data: config } = useConfig();
  const max = config?.limits.maxInputImages ?? 4;

  useEffect(() => {
    const addFiles = (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length) return false;
      const { references, addFiles, focus } = useComposer.getState();
      const room = max - references.length;
      if (room <= 0) {
        toast.error(`You can use at most ${max} reference images`);
        return true;
      }
      if (images.length > room) toast.warning(`Only ${room} more image${room > 1 ? 's' : ''} can be added (max ${max})`);
      void addFiles(images, max);
      focus();
      return true;
    };
    const blocked = () => !!useUi.getState().inpaintAsset;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || blocked()) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    };
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!blocked()) addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (blocked()) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        if (addFiles(files)) toast.success('Image pasted as reference', { duration: 1500 });
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [max]);

  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-fade-in">
      <div className="absolute inset-4 rounded-3xl border-2 border-dashed border-accent/50" />
      <div className="flex flex-col items-center gap-3 text-center animate-pop">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <ImagePlus className="h-8 w-8" />
        </div>
        <div className="text-lg font-medium">Drop images to use as references</div>
        <div className="text-sm text-muted">Up to {max} images · JPG, PNG, WebP…</div>
      </div>
    </div>
  );
}
