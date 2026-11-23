import type { ReactNode } from 'react';
import { SEO } from '@/lib/site';
import { breadcrumbSchema, JsonLd, routeMetadata } from '@/app/(sitemaps)/seo';

/* Metadata-only wrapper. app/auth/page.tsx is a Client Component and stays
   untouched; this Server Component supplies its canonical/OG/Twitter/hreflang
   and robots fields. The pairing page is a real public utility page, so it is
   indexable and listed in the sitemap — but it makes no privacy claim that
   the page itself does not already make. */
export const metadata = routeMetadata('/auth', SEO.auth);

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: 'SADEEM', path: '/' },
          { name: 'Account pairing', path: '/auth' },
        ])}
      />
      {children}
    </>
  );
}
