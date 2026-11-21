'use client';

import dynamic from 'next/dynamic';

const Studio = dynamic(() => import('@/components/studio').then((m) => m.Studio), { ssr: false });

export default function UploadsPage() {
  return <Studio page="uploads" />;
}
