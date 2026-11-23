import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { SiteHeader, SiteFooter } from '@/components/chrome';
import { SEO, SITE } from '@/lib/site';
import { InkGrain } from '@/components/visuals/InkGrain';
import { ScrollProgress } from '@/components/visuals/ScrollProgress';
import { CursorHalo } from '@/components/visuals/CursorHalo';
import { PageCurtain } from '@/components/visuals/PageCurtain';
import { ArtRuntime } from '@/components/visuals/ArtRuntime';
import './globals.css';

const TITLE = SEO.home.title;
const DESCRIPTION = SEO.home.description;
const OG_IMAGE = SEO.ogImage;

/* Structured data: an Organization + one truthful SoftwareApplication entity
   + the WebSite entity. The canonical address is the purchased domain; the
   live Vercel URL keeps working meanwhile. No aggregate rating and no fake
   purchasable price.

   WebSite deliberately has NO SearchAction: this site has no on-site search
   endpoint. Google retired the sitelinks search box, and a SearchAction
   pointing at a query parameter that does not exist would be fake markup. */
const ORGANIZATION_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE.siteUrl}/#organization`,
  name: SITE.name,
  url: SITE.siteUrl,
  // The official lime-square / black-gear app mark served from /public.
  logo: `${SITE.siteUrl}/sadeem-app-logo.png`,
  sameAs: [SITE.repo],
};

const WEBSITE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE.siteUrl}/#website`,
  name: SITE.name,
  url: SITE.siteUrl,
  description: DESCRIPTION,
  inLanguage: ['ar', 'en'],
  publisher: { '@id': `${SITE.siteUrl}/#organization` },
};

const SOFTWARE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': `${SITE.siteUrl}/#software`,
  name: SITE.name,
  version: SITE.version,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows',
  description: DESCRIPTION,
  url: SITE.siteUrl,
  image: `${SITE.siteUrl}${OG_IMAGE}`,
  inLanguage: ['ar', 'en'],
  isAccessibleForFree: true,
  publisher: { '@id': `${SITE.siteUrl}/#organization` },
  featureList: [
    'Local-first coding agent',
    'Bring your own key (BYOK) across 12 providers',
    'Living PLAYBOOK.md that learns from each run',
    '145 real tools with approval gates',
    'Connect your own MCP servers',
    'Bilingual Arabic (RTL) and English interface',
  ],
  /* Honest FREE_SEASON offer: $0 today, no checkout and no paid price claimed.
     The planned one-time license is documented in prose on /pricing only. */
  offers: {
    '@type': 'Offer',
    price: 0,
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    description: 'Free during the public season with bring-your-own-key. No subscription, no checkout, no credits.',
    url: `${SITE.siteUrl}/download`,
  },
};

/* FAQPage mirrors, verbatim, the four English Q&As rendered by
   components/home/SEOContent.tsx. Structured data only; copy lives in one
   place per surface, and the canonical domain stays sadeem-ai.com. */
const FAQ_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  [
    'Is SADEEM really a local-first AI coding agent — does it work offline?',
    'Local-first describes where your project lives: files, indexes, the living PLAYBOOK.md and your credentials stay on your Windows machine, and dangerous commands require approval. Model inference still needs a provider — connect an online model (OpenAI, Anthropic, Google, OpenRouter and others via BYOK) or a local model through Ollama or LM Studio. With a local model the agent can keep working without an internet connection, so it is offline-capable rather than offline-only. SADEEM is free during the public season.',
  ],
  [
    'What does “bring your own key” mean, and which providers are supported?',
    'Bring your own key (BYOK) means you supply the API key from a provider you choose — SADEEM does not resell inference or sit behind a proxy. Keys are stored locally and sent directly to that provider. Twelve providers are supported, including Anthropic, OpenAI, Google, Ollama, Mistral, DeepSeek, xAI, OpenRouter, Groq, Azure, LM Studio and Together. Switch models per task while the agent, its 145 tools and its playbook stay the same.',
  ],
  [
    'How does privacy-first coding with MCP actually protect my code?',
    'MCP (Model Context Protocol) is an open standard for connecting an assistant to external tools and data. SADEEM lets you add your own MCP servers - GitHub, Figma, Supabase, Playwright, Notion and more are common choices. You choose which servers to add, every tool call is visible, and risky actions wait for approval. Each MCP server is its own service, so review what data it can reach before enabling it; privacy-first means you decide, not that every server is local.',
  ],
  [
    'Is there an Arabic AI coding assistant, or is the interface English only?',
    'SADEEM is bilingual by design. The interface runs in full Arabic RTL with Cairo typography, and you can prompt in Arabic or English. Code comments, commit messages and the living playbook can be written in either language, so Arabic-speaking developers can work without translating their thinking. Switch language with one tap; nothing is mixed and no direction is broken.',
  ],
];

const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE.siteUrl}/#faq`,
  mainEntity: FAQ_ENTRIES.map(([question, answer]) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE.siteUrl),
  title: { default: TITLE, template: '%s · SADEEM' },
  applicationName: SITE.name,
  description: DESCRIPTION,
  // No `keywords` meta tag: Google has ignored it since 2009, and the old
  // list repeated the same idea four ways. One natural phrase per route in
  // SEO.* instead — see docs/SEO-WORDS-V1144.md §3.2.
  authors: [{ name: 'SADEEM' }],
  creator: 'SADEEM',
  publisher: 'SADEEM',
  category: 'Developer Tools',
  /* One URL serves both languages; the client LangProvider updates
     <html lang/dir> after load. There is no crawlable /ar or /en route, so
     no hreflang alternates are emitted — three tags pointing at one URL are
     noise, not localisation. See docs/SEO-WORDS-V1144.md §3.2. */
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: TITLE,
    description: DESCRIPTION,
    url: SITE.siteUrl,
    locale: SEO.ogLocale,
    alternateLocale: [SEO.ogAlternateLocale],
    images: [
      { url: OG_IMAGE, width: 1200, height: 630, type: 'image/png', alt: SEO.ogImageAlt },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: OG_IMAGE, alt: SEO.ogImageAlt }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  /* Icons are handled by Next.js file conventions: app/icon.png is emitted
     as the tab <link rel="icon"> and app/apple-icon.png as the iOS touch icon.
     public/favicon.svg and public/favicon.png stay as direct-request copies
     of the same real SADEEM mark. */
};

const THEME_INIT = `(function(){try{var t=localStorage.getItem('sadeem-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;
/* Arm reveal/hairline hiding before first paint — content stays visible when JS is off. */
const MOTION_INIT = `try{document.documentElement.dataset.js='1'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: MOTION_INIT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(ORGANIZATION_SCHEMA).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(SOFTWARE_SCHEMA).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(WEBSITE_SCHEMA).replace(/</g, '\\u003c'),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(FAQ_SCHEMA).replace(/</g, '\\u003c'),
          }}
        />
      </head>
      <body>
        <InkGrain />
        <ScrollProgress />
        <PageCurtain />
        <CursorHalo />
        <ArtRuntime />
        <Providers>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
