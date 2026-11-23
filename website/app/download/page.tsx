import type { Metadata } from 'next';
import { DownloadPage } from '@/components/download/DownloadPage';
import { SEO, SITE } from '@/lib/site';
import './download.css';

export const metadata: Metadata = {
  title: { absolute: SEO.download.title },
  description: SEO.download.description,
  alternates: {
    canonical: '/download',
  },
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SEO.download.title,
    description: SEO.download.description,
    url: '/download',
    locale: SEO.ogLocale,
    alternateLocale: [SEO.ogAlternateLocale],
    images: [{ url: SEO.ogImage, width: 1200, height: 630, type: 'image/png', alt: SEO.ogImageAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO.download.title,
    description: SEO.download.description,
    images: [{ url: SEO.ogImage, alt: SEO.ogImageAlt }],
  },
  robots: { index: true, follow: true },
};

/* A calm release summary: version, platform and what the download contains.
   Checksums live only in a collapsed verification panel. Pure CSS language
   toggling keeps this a server component — no Date, no random, no client state. */
function Bi({ en, ar }: { en: string; ar: string }) {
  return (
    <>
      <span className="dl-en">{en}</span>
      <span className="dl-ar">{ar}</span>
    </>
  );
}

function ReleaseInstrument() {
  return (
    <section className="wrap dl-inst-sec" aria-label="Download information">
      <div className="dl-inst">
        <span className="crosshairs" aria-hidden="true"><i /><i /><i /><i /></span>
        <div className="dl-inst-head">
          <span className="label">
            <Bi en="RELEASE" ar="الإصدار" /> / v{SITE.version}
          </span>
          <span className="label"><Bi en="WINDOWS 10/11 · x64" ar="ويندوز 10/11 · x64" /></span>
        </div>

        <div className="dl-inst-grid">
          <div className="dl-inst-version">
            <span className="dl-inst-kicker mono"><Bi en="VERSION" ar="الإصدار" /></span>
            <div className="dl-inst-ver-num">{SITE.version}</div>
            <span className="dl-inst-state mono">
              <Bi en="FREE DURING THE PUBLIC SEASON · BRING YOUR OWN KEY" ar="مجاني خلال الموسم العام · أحضر مفتاحك الخاص" />
            </span>
          </div>

          <div className="dl-inst-mark" aria-hidden="true">
            <svg viewBox="0 0 160 160">
              <g className="dl-inst-orbit" fill="none" stroke="var(--accent)" strokeWidth=".8">
                <circle cx="80" cy="80" r="66" strokeDasharray="2 9" opacity=".55" />
                <circle cx="80" cy="14" r="2.2" fill="var(--accent)" stroke="none" />
              </g>
              <g fill="none" stroke="currentColor" strokeWidth=".8" opacity=".16">
                <circle cx="80" cy="80" r="54" />
                <path d="M80 8v144M8 80h144" />
              </g>
              <g className="dl-inst-glyph" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="48" y="48" width="29" height="29" />
                <rect x="83" y="48" width="29" height="29" />
                <rect x="48" y="83" width="29" height="29" />
                <rect x="83" y="83" width="29" height="29" />
              </g>
            </svg>
          </div>

          <div className="dl-inst-hashes">
            <div className="dl-inst-hash">
              <span className="label"><Bi en="INCLUDED" ar="المرفقات" /></span>
              <p className="small">
                <Bi en="Windows installer and portable ZIP. The same app, two ways to run it." ar="مثبّت ويندوز وملف مضغوط محمول. التطبيق نفسه بطريقتين للتشغيل." />
              </p>
            </div>
            <div className="dl-inst-hash">
              <details>
                <summary className="label"><Bi en="VERIFY CHECKSUM" ar="تحقّق من البصمة" /></summary>
                <div>
                  <span className="label">SHA-256 / <Bi en="SETUP.EXE" ar="المثبّت.EXE" /></span>
                  <code dir="ltr">{SITE.download.exeSha256}</code>
                </div>
                <div>
                  <span className="label">SHA-256 / <Bi en="PORTABLE.ZIP" ar="المحمول.ZIP" /></span>
                  <code dir="ltr">{SITE.download.zipSha256}</code>
                </div>
              </details>
            </div>
          </div>
        </div>

        <hr className="rule-art dl-inst-rule" />
        <div className="dl-inst-foot">
          <span className="mono"><Bi en="INSTALLER · PORTABLE ZIP · SAME APP" ar="مثبّت · ملف مضغوط محمول · التطبيق نفسه" /></span>
          <span className="mono">SADEEM / {SITE.version}</span>
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <>
      <ReleaseInstrument />
      <DownloadPage />
    </>
  );
}
