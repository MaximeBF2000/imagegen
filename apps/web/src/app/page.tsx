'use client';

import dynamic from 'next/dynamic';

// The studio is fully client-side (live data + preferences in localStorage),
// so render it on the client only to avoid hydration mismatches.
const Studio = dynamic(() => import('@/components/studio').then((m) => m.Studio), { ssr: false });

export default function Page() {
  return <Studio />;
}
