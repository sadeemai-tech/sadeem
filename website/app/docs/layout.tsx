import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SEO, SITE } from '@/lib/site';

/* app/docs/page.tsx is a Client Component; metadata belongs in this Server
   Component layout so crawlers see title/description before hydration. */
export const metadata: Metadata = {
  title: { absolute: SEO.docs.title },
  description: SEO.docs.description,
  alternates: {
    canonical: '/docs',
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SEO.docs.title,
    description: SEO.docs.description,
    url: '/docs',
    locale: SEO.ogLocale,
    alternateLocale: [SEO.ogAlternateLocale],
    images: [{ url: SEO.ogImage, width: 1200, height: 630, type: 'image/png', alt: SEO.ogImageAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO.docs.title,
    description: SEO.docs.description,
    images: [{ url: SEO.ogImage, alt: SEO.ogImageAlt }],
  },
  robots: { index: true, follow: true },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
