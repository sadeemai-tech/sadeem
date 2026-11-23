import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SEO, SITE } from '@/lib/site';

/* app/features/page.tsx is a Client Component (hooks), and Next.js 16 only
   allows `metadata` in Server Components. A metadata-only route layout keeps
   canonical / OG / hreflang per page without touching the page's behaviour. */
export const metadata: Metadata = {
  title: { absolute: SEO.features.title },
  description: SEO.features.description,
  alternates: {
    canonical: '/features',
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SEO.features.title,
    description: SEO.features.description,
    url: '/features',
    locale: SEO.ogLocale,
    alternateLocale: [SEO.ogAlternateLocale],
    images: [{ url: SEO.ogImage, width: 1200, height: 630, type: 'image/png', alt: SEO.ogImageAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO.features.title,
    description: SEO.features.description,
    images: [{ url: SEO.ogImage, alt: SEO.ogImageAlt }],
  },
  robots: { index: true, follow: true },
};

export default function FeaturesLayout({ children }: { children: ReactNode }) {
  return children;
}
