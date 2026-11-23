import type { MetadataRoute } from 'next';
import { SEO, SITE } from '@/lib/site';

/* Next.js metadata route → /sitemap.xml (statically generated at build time).
   All seven public pages are listed with the stable SEO.lastModified date.
   The sitemap repeats the same ar/en/x-default self-referencing hreflang
   declared in each route's metadata: one bilingual URL, not separate /ar
   and /en paths. */
type SitemapPage = {
  path: string;
  changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
};

const PAGES: SitemapPage[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/features', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/download', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/auth', changeFrequency: 'yearly', priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.siteUrl.replace(/\/$/, '');
  // Stable build-time date from the SEO constant so the sitemap does not
  // churn on every deploy and the source guard stays deterministic.
  const lastModified = SEO.lastModified;
  return PAGES.map(({ path, changeFrequency, priority }) => {
    const url = `${base}${path}`;
    return {
      url,
      lastModified,
      changeFrequency,
      priority,
      // v11.44 — no self-referencing hreflang (one URL serves both languages
      // via the client toggle; Google ignores ar/en pointing at the same URL).
      images: [`${base}${SEO.ogImage}`],
    };
  });
}
