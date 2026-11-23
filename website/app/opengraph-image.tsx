import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SEO, SITE } from '@/lib/site';

/* Build-time generated social card (1200×630 PNG). No network calls, no fonts
   to download — the local logo is the only asset and is ~7 KB. Text is English
   so the default @vercel/og font renders every glyph; the site itself is fully
   bilingual and switches <html lang/dir> at runtime. */
export const runtime = 'nodejs';
export const alt = SEO.ogImageAlt;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const logoData = await readFile(
  join(process.cwd(), 'public', 'sadeem-app-logo.png'),
  'base64',
);
const logoSrc = `data:image/png;base64,${logoData}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0d0f0e',
          color: '#dde8ce',
          padding: 72,
          border: `1px solid #2a3226`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} width={64} height={64} alt="" />
            <div style={{ display: 'flex', fontSize: 40, letterSpacing: 5, marginLeft: 22 }}>
              SADEEM
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 22, color: '#b6f24a', letterSpacing: 2 }}>
            v{SITE.version}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 78, lineHeight: 1.08, letterSpacing: -2 }}>
            The agent that
          </div>
          <div style={{ display: 'flex', fontSize: 78, lineHeight: 1.08, color: '#b6f24a', letterSpacing: -2 }}>
            grows with you.
          </div>
          <div style={{ display: 'flex', fontSize: 27, marginTop: 30, color: '#9aa98c' }}>
            Local-first AI coding agent · BYOK · MCP · Arabic + English
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #2a3226',
            paddingTop: 24,
          }}
        >
          <div style={{ display: 'flex', fontSize: 23, color: '#b6f24a' }}>
            FREE DURING THE PUBLIC SEASON · NO SUBSCRIPTION
          </div>
          <div style={{ display: 'flex', fontSize: 23, color: '#9aa98c' }}>sadeem-ai.com</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
