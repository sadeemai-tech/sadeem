import type { ReactNode } from 'react';
import { SEO } from '@/lib/site';
import { breadcrumbSchema, JsonLd, routeMetadata } from '@/app/(sitemaps)/seo';

/* Metadata-only wrapper. app/changelog/page.tsx exports no `metadata`, so this
   Server Component is the single source for canonical/OG/Twitter/robots fields.
   A page-level export would override SEO.changelog — see docs/SEO-WORDS-V1144.md.
   No visual DOM. */
export const metadata = routeMetadata('/changelog', SEO.changelog);

export default function ChangelogLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'SADEEM', path: '/' },
          { name: 'Changelog', path: '/changelog' },
        ])}
      />
      {children}
    </>
  );
}
