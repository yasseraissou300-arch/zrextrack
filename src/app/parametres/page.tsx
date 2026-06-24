'use client';

// Les templates WhatsApp ont été fusionnés dans la page Messages
// (onglet « Templates ») pour tout regrouper au même endroit.
// Cette page redirige donc vers Messages.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function ParametresRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/messages');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
      <Loader2 size={22} className="animate-spin text-stone-400" />
    </div>
  );
}
