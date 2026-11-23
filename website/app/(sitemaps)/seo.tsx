import type { Metadata } from 'next';
import { SEO, SITE } from '@/lib/site';

/* ---------------------------------------------------------------------------
   Shared, build-time SEO helpers (data + rendering only — no page bodies).
   Used by the metadata-only route layouts that complete coverage for routes
   whose own page.tsx cannot export `metadata` (Next.js 16: Server Components
   only) or already exports a minimal title.

   This file lives in a route group with no page.tsx, so it emits no route.
   --------------------------------------------------------------------------- */

type RoutePair = { title: string; description: string };

/** Full metadata for one canonical route. Every value is static and local. */
export function routeMetadata(route: string, pair: RoutePair): Metadata {
  return {
    title: { absolute: pair.title },
    description: pair.description,
    // One URL serves both languages. There are no crawlable /ar or /en
    // routes, so no hreflang alternates are emitted: pointing ar, en and
    // x-default at the same URL is a no-op, not localisation.
    alternates: {
      canonical: route,
    },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      title: pair.title,
      description: pair.description,
      url: route,
      locale: SEO.ogLocale,
      alternateLocale: [SEO.ogAlternateLocale],
      images: [
        {
          url: SEO.ogImage,
          width: 1200,
          height: 630,
          type: 'image/png',
          alt: SEO.ogImageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: pair.title,
      description: pair.description,
      images: [{ url: SEO.ogImage, alt: SEO.ogImageAlt }],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
  };
}

/** A real BreadcrumbList trail on the canonical domain (no fake ancestors). */
export function breadcrumbSchema(
  trail: ReadonlyArray<{ name: string; path: string }>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(({ name, path }, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: `${SITE.siteUrl.replace(/\/$/, '')}${path}`,
    })),
  };
}

/** Inject one JSON-LD block. '<' is escaped so a string can never close the
    script element (defensive, even though all data here is build-time local). */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  );
}
