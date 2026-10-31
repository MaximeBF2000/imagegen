'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn, copyText } from '@/lib/utils';

/** Hook returning a copy function and a transient "copied" flag for visual feedback. */
export function useCopy(duration = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    if (!(await copyText(text))) {
      toast.error('Could not access the clipboard');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), duration);
  };
  return { copied, copy };
}

/**
 * A prompt that copies itself to the clipboard on click, with a brief
 * highlight + "Copied" badge as feedback.
 */
export function CopyablePrompt({
  text,
  className,
  lines = 2,
  onDark,
}: {
  text: string;
  className?: string;
  /** Clamp to N lines (0 = no clamp). */
  lines?: 0 | 1 | 2 | 3 | 4;
  /** Rendered over an image (lighter colors). */
  onDark?: boolean;
}) {
  const { copied, copy } = useCopy();
  const clamp = { 0: '', 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[lines];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void copy(text);
      }}
      title="Click to copy prompt"
      className={cn(
        'group/copy relative block w-full cursor-copy rounded-md text-left transition-colors duration-200',
        copied ? (onDark ? 'bg-white/15' : 'bg-accent/10') : onDark ? 'hover:bg-white/10' : 'hover:bg-white/[0.04]',
        className,
      )}
    >
      <span className={cn('block', clamp)}>{text}</span>
      <span
        className={cn(
          'pointer-events-none absolute -top-2.5 right-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium shadow-lg transition-all duration-200',
          copied
            ? 'translate-y-0 bg-success text-black opacity-100'
            : cn('translate-y-1 opacity-0 group-hover/copy:translate-y-0 group-hover/copy:opacity-100', onDark ? 'bg-black/80 text-white' : 'bg-surface-3 text-muted'),
        )}
      >
        {copied ? <Check className="h-3 w-3" strokeWidth={3} /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}
