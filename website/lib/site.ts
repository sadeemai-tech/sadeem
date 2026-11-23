// Single source of truth for the SADEEM website.
export const SITE = {
  name: 'SADEEM',
  version: '11.12.0',
  // Honest: one local-first coding agent among many, not "the" or "the first".
  tagline: 'A local-first coding agent that learns with you.',
  // Canonical domain. The current Vercel preview URL still resolves; this is
  // the durable address that canonical/OG/sitemap metadata points to.
  siteUrl: 'https://sadeem-ai.com',
  repo: 'https://github.com/sadeemai-tech/sadeem',
  // Must match electron/services/authService.ts -> completeWebAuth payload.
  deepLinkScheme: 'sadeem',
  deepLinkCallback: 'sadeem://auth/callback',
  // The app calls <site>/auth#pair=<code>&mode=signup|signin on the canonical
  // domain sadeem-ai.com (see app/auth/page.tsx).
  authPath: '/auth',
  // Release artifacts (served from /downloads on the same site).
  // Release binaries exceed Vercel's 100 MB per-file limit, so they are served
  // from Vercel Blob. Hashes are of these exact files (scripts/publish-release.mjs).
  download: {
    exe: 'https://lvwklw93yzewutw4.public.blob.vercel-storage.com/sadeem/SADEEM-Setup-11.12.0.exe',
    zip: 'https://lvwklw93yzewutw4.public.blob.vercel-storage.com/sadeem/SADEEM-11.12.0-win.zip',
    // v11.43 — Vercel Blob store suspended (billing inactive). Installers are
    // served as static parts from /dl/* and reassembled in-browser (see
    // ChunkedDownload.tsx). Hashes are of the CURRENT release/ build.
    exeSha256: '644f804506aa0aa60bee86d5418073646f173c14ebb02408885fa7815a631dba',
    zipSha256: '278c8aa8fab2b2df8ed1d5de539783f5f0eb7da94bf55a62e645f711648e8dc4',
  },
  // The in-app updater needs a real hosted feed. Until one is published, the
  // app falls back to this official https feed, which is served from the site.
  updateFeed: 'https://sadeem-ai.com/updates/',
  supportEmail: 'support@sadeem.app',

  // ---------- monetization (one-time Owner License only) ----------
  // Mirrors electron/services/billingService.ts FREE_SEASON. Default SAFE:
  // true until a payment gateway + webhook + key minting are live. Set
  // NEXT_PUBLIC_FREE_SEASON=false at build time only when checkout is real.
  freeSeason: process.env.NEXT_PUBLIC_FREE_SEASON !== 'false',
  // The real payment gateway URL. EMPTY by default — the pricing page shows
  // no button at all when this is empty, rather than a fake payment button.
  // Set NEXT_PUBLIC_CHECKOUT_URL at build time, or fill this in below.
  checkoutUrl: process.env.NEXT_PUBLIC_CHECKOUT_URL?.trim() || '',
  // One-time, not a subscription. BYOK stays $0 forever; no credits are sold.
  license: { foundingUsd: 79, listUsd: 99 },
} as const;

export type Lang = 'en' | 'ar';

// ---------------------------------------------------------------------------
// SEO metadata constants — DATA ONLY. Titles, descriptions, social-card fields
// and a stable sitemap lastModified date live here so every route shares one
// source of truth. Download hashes and checkout/billing config above are NOT
// touched by this block.
// ---------------------------------------------------------------------------
export const SEO = {
  siteName: 'SADEEM',
  // Generated at build time by app/opengraph-image.tsx (1200×630 PNG).
  ogImage: '/opengraph-image',
  ogImageAlt: 'SADEEM — local-first AI coding agent with bring-your-own-key and MCP',
  // Open Graph locale follows the document's default language (ar, dir=rtl).
  // The alternate is the language the in-app toggle switches to.
  ogLocale: 'ar_AE',
  ogAlternateLocale: 'en_US',
  // Fixed, build-stable value: a deterministic sitemap is easier to cache and
  // does not change on every deploy (release date of v11.12.0).
  lastModified: '2026-11-22',
  // Front-load the category or action word; one natural phrase per route.
  // Titles are unique and <= 60 chars, descriptions unique and <= 160 chars,
  // as checked by tests-v1142-seo.mjs. Arabic variants require crawlable /ar
  // routes before they can be served as metadata — see docs/SEO-WORDS-V1144.md.
  home: {
    title: 'SADEEM — Local-First AI Coding Agent with BYOK & MCP',
    description:
      'Local-first AI coding agent for Windows: BYOK across 12 providers, 145 tools, MCP, living playbook. Arabic RTL and English. Free during the public season.',
  },
  features: {
    title: '145 Tools, MCP & Subagents — SADEEM Features',
    description:
      'Local-first AI coding agent: 145 tools, 16 specialist agents, MCP servers, shadow-commit checkpoints, signed proof and approval gates for risky commands.',
  },
  pricing: {
    title: 'Pricing — Free Public Season & One-Time License | SADEEM',
    description:
      'BYOK is free. Every local feature is open in the public season: no subscription, no credits, no resale of inference. One-time license planned; checkout closed.',
  },
  download: {
    title: 'Download SADEEM for Windows — v11.12.0',
    description:
      'Download SADEEM 11.12.0 for Windows 10/11 x64: NSIS installer or portable ZIP. Local-first and free during the public season.',
  },
  docs: {
    title: 'SADEEM Docs — Setup, API Keys, MCP & Tools',
    description:
      'SADEEM documentation: install the app or CLI, add a provider key, set up MCP and subagents, and use the versioned playbook. Arabic and English.',
  },
  changelog: {
    title: 'Changelog — SADEEM Release History',
    description:
      'SADEEM releases from v10.3.0 to v11.12.0, with the changes, fixes and tool updates taken from the repository release notes.',
  },
  auth: {
    title: 'SADEEM Account Pairing — Desktop Sign-In',
    description:
      'Pair this browser with the SADEEM desktop app using a short-lived code. The password stays hashed in your browser; nothing is uploaded.',
  },
} as const;
