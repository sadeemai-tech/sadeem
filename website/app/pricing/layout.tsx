import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SEO, SITE } from '@/lib/site';

/* app/pricing/page.tsx is a Client Component; metadata belongs in this Server
   Component layout. Descriptions state FREE_SEASON honestly — no fake price. */
export const metadata: Metadata = {
  title: { absolute: SEO.pricing.title },
  description: SEO.pricing.description,
  alternates: {
    canonical: '/pricing',
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SEO.pricing.title,
    description: SEO.pricing.description,
    url: '/pricing',
    locale: SEO.ogLocale,
    alternateLocale: [SEO.ogAlternateLocale],
    images: [{ url: SEO.ogImage, width: 1200, height: 630, type: 'image/png', alt: SEO.ogImageAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO.pricing.title,
    description: SEO.pricing.description,
    images: [{ url: SEO.ogImage, alt: SEO.ogImageAlt }],
  },
  robots: { index: true, follow: true },
};

export default function PricingLayout({ children }: { children: ReactNode }) {
  return children;
}
