'use client';

import { KeyRound } from 'lucide-react';
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
          {config && !config.ready && (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn/[0.07] p-4 text-sm animate-fade-in">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div>
                <div className="font-medium text-warn">Almost ready: one setting is missing</div>
                {config.issues.map((issue) => (
                  <p key={issue} className="mt-0.5 text-muted">
                    {issue}
                  </p>
                ))}
              </div>
            </div>
          )}
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
