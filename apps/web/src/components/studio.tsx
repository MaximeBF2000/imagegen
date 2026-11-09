'use client';

import { Cpu, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useConfig, useLiveEvents } from '@/lib/queries';
import { useComposer, useUi } from '@/lib/store';
import { ApiDialog } from './api-dialog';
import { Composer } from './composer';
import { DropZone } from './drop-zone';
import { Feed } from './feed';
import { FolderDialogs } from './folders';
import { Header } from './header';
import { InpaintEditor } from './inpaint-editor';
import { Lightbox } from './lightbox';
import { Sidebar } from './sidebar';
import { Toolbar } from './toolbar';

export function Studio() {
  const connected = useLiveEvents();
  const { data: config } = useConfig();

  // "/" focuses the prompt from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !t.closest('input, textarea, [contenteditable]') && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        useComposer.getState().focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Restore "generate into the open folder" after a reload.
  useEffect(() => {
    const { folder } = useUi.getState();
    if (folder !== 'all' && folder !== 'none') useComposer.getState().setFolderId(folder);
  }, []);

  return (
    <>
      <Header connected={connected} />
      <div className="mx-auto flex max-w-[1680px]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-28 sm:px-6">
          {config && !config.ready && <ReadinessBanner issues={config.issues} />}
          <div className="z-20 -mx-4 bg-gradient-to-b from-bg via-bg/95 to-transparent px-4 pb-6 pt-5 sm:-mx-6 sm:px-6 lg:sticky lg:top-[60px]">
            <div className="mx-auto max-w-3xl">
              <Composer />
            </div>
          </div>
          <Toolbar />
          <Feed />
        </main>
      </div>
      <Lightbox />
      <InpaintEditor />
      <ApiDialog />
      <DropZone />
      <FolderDialogs />
    </>
  );
}

function ReadinessBanner({ issues }: { issues: string[] }) {
  const loading = issues.some((i) => i.startsWith('Loading'));
  return (
    <div
      className={
        'mt-5 flex items-start gap-3 rounded-xl border p-4 text-sm animate-fade-in ' +
        (loading ? 'border-accent/25 bg-accent/[0.06]' : 'border-warn/25 bg-warn/[0.07]')
      }
    >
      {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" /> : <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
      <div>
        <div className={loading ? 'font-medium text-accent' : 'font-medium text-warn'}>
          {loading ? 'Warming up the model' : 'The local model isn’t available'}
        </div>
        {issues.map((issue) => (
          <p key={issue} className="mt-0.5 text-muted">
            {issue}
          </p>
        ))}
        {!loading && <p className="mt-1 text-xs text-subtle">You can still queue generations: they'll run as soon as the model is ready.</p>}
      </div>
    </div>
  );
}
