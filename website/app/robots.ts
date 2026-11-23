import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/* Generated /robots.txt. Every public route — including /auth and /changelog —
   is crawlable and listed in the sitemap, so there are no blocked paths.
   The wildcard rule already covers AI crawlers (GPTBot, OAI-SearchBot,
   ClaudeBot, PerplexityBot and others); the explicit rules below make that
   intent unambiguous without changing behaviour. Release binaries are served
   from Vercel Blob and are not part of this site.

   A static copy also exists at public/robots.txt with identical directives;
   this generated route is the source of truth. */
export default function robots(): MetadataRoute.Robots {
  const base = SITE.siteUrl.replace(/\/$/, '');
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      {
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'ClaudeBot',
          'Claude-User',
          'anthropic-ai',
          'PerplexityBot',
          'Perplexity-User',
          'CCBot',
        ],
        allow: '/',
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
