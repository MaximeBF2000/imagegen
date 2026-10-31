'use client';

import * as Tooltip from '@radix-ui/react-tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={300} skipDelayDuration={100}>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: '!bg-surface-2 !border-line-strong !text-fg !rounded-xl !shadow-2xl',
              description: '!text-muted',
            },
          }}
        />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
