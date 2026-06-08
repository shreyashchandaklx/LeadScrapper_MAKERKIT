'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface Props {
  src: string;
  page?: string;
  title: string;
}

/**
 * Wraps the Leadscrapper iframe. Two responsibilities:
 *  1. On every parent route change, post a `resetPage` message to the iframe
 *     so the SPA syncs its internal page state with the URL we landed on.
 *  2. Intercept clicks on the Makerkit sidebar links that point to the SAME
 *     URL we're already on — Next.js treats those as no-ops, but we still
 *     want the iframe SPA to snap back to that section (e.g. clicking
 *     "Lead Manager" while already at /lead-manager should always show the
 *     Lead Manager view, even if the iframe drifted to a detail/search
 *     view internally).
 */
export default function LeadscrapperFrameClient({ src, page, title }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pathname = usePathname();

  // (1) Sync iframe to the parent URL whenever pathname changes.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !page) return;
    const post = () => {
      try {
        iframe.contentWindow?.postMessage(
          { type: 'leadscrapper:setPage', page },
          'https://leadscrapper.pixnom.com'
        );
      } catch {
        /* cross-origin guard */
      }
    };
    // The iframe may not have loaded yet on first mount.
    post();
    iframe.addEventListener('load', post);
    return () => iframe.removeEventListener('load', post);
  }, [pathname, page]);

  // (2) Catch same-URL clicks on sidebar links.
  useEffect(() => {
    if (!page) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      // Only react when the link targets THIS page.
      const href = anchor.getAttribute('href') || '';
      if (href !== pathname) return;
      const iframe = iframeRef.current;
      iframe?.contentWindow?.postMessage(
        { type: 'leadscrapper:setPage', page },
        'https://leadscrapper.pixnom.com'
      );
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [pathname, page]);

  return (
    <div className="h-[calc(100vh-4rem)]">
      <iframe
        ref={iframeRef}
        src={src}
        className="h-full w-full border-0"
        title={title}
      />
    </div>
  );
}
