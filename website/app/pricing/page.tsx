'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowDownToLine, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import './pricing.css';

// Mirrors FREE_SEASON in electron/services/billingService.ts. SITE.freeSeason
// defaults to TRUE: every feature is open and checkout is deliberately off.
const FREE_SEASON = SITE.freeSeason;
const FOUNDING = SITE.license.foundingUsd;
const LIST = SITE.license.listUsd;

/** A bilingual string pair. Every visible string on this page goes through tx(). */
type Pair = readonly [en: string, ar: string];

interface Tier {
  num: string;
  name: Pair;
  price: string;
  cadence: Pair;
  tagline: Pair;
  features: Pair[];
  cta: Pair;
  kind: 'download' | 'license';
}

/* NO credit packs, NO hosted inference, NO subscription, NO team tier.
   BYOK is free forever; the only paid surface is ONE one-time Owner License. */
const TIERS: Tier[] = [
  {
    num: '01',
    name: ['BYOK Free', 'مجاني بمفاتيحك'],
    price: '$0',
    cadence: ['free, forever', 'مجاني للأبد'],
    tagline: ['Bring your keys. Every local feature stays open.', 'أحضر مفاتيحك. كل ميزة محلية تبقى مفتوحة.'],
    features: [
      ['Runs on your own API keys — your provider bills you', 'تعمل بمفاتيحك أنت — ومزوّدك يفاترك'],
      ['All 12 providers — keys stay on this device', 'كل المزوّدين الـ12 — مفاتيحك تبقى على جهازك'],
      ['Files, git, terminal, shadow-commit checkpoints, versioned PLAYBOOK.md', 'ملفات، git، طرفية، نسخ shadow-commit، ملف PLAYBOOK.md بإصدارات'],
      ['MCP servers, skills and 16 specialist agents', 'خوادم MCP ومهارات و١٦ وكيلاً متخصصاً'],
      ['No subscription, no credits, no resale of inference', 'بلا اشتراك، بلا رصيد، بلا إعادة بيع للاستدلال'],
    ],
    cta: ['Download free', 'حمّل مجاناً'],
    kind: 'download',
  },
  {
    num: '02',
    name: ['Owner License', 'رخصة المالك'],
    price: `$${LIST}`,
    cadence: ['one-time payment · no subscription', 'دفعة واحدة · بلا اشتراك'],
    tagline: ['Pay once. Own it for the whole v11 series.', 'ادفع مرة واحدة. امتلكها لسلسلة v11 كاملة.'],
    features: [
      ['Everything available during the public season', 'كل ما هو متاح خلال الموسم العام'],
      ['A signed key activates the license in the desktop app', 'مفتاح موقّع يُفعّل الرخصة في تطبيق سطح المكتب'],
      ['All 16 specialist agents', 'كل الوكلاء المتخصصين الـ16'],
      ['A perpetual signed key — all v11.x updates included', 'مفتاح موقّع دائم — كل تحديثات v11.x مشمولة'],
      [`Founding cohort $${FOUNDING} · afterwards $${LIST} · one-time`, `الموجة المؤسِّسة ${FOUNDING}$ · بعدها ${LIST}$ · مرة واحدة`],
      ['BYOK stays free. No credits are sold or resold.', 'المفاتيح تبقى مجانية. لا يُباع رصيد ولا يُعاد بيعه.'],
    ],
    cta: ['Buy Owner License', 'اشترِ رخصة المالك'],
    kind: 'license',
    // `recommended` is expressed by the markup below, not by an extra flag.
  },
];

const YES: Pair = ['Yes', 'نعم'];
const NO: Pair = ['No', 'لا'];

type Cell = Pair | 'yes' | 'no';

const COLUMNS: Pair[] = [
  ['', ''],
  ['BYOK Free', 'مجاني بمفاتيحك'],
  [`Owner $${LIST}`, `المالك ${LIST}$`],
];

const COMPARE: { label: Pair; values: Cell[] }[] = [
  {
    label: ['Pricing model', 'نموذج الدفع'],
    values: [['Free', 'مجاني'], [`$${LIST} once (founding $${FOUNDING})`, `${LIST}$ مرة واحدة (المؤسِّس ${FOUNDING}$)`]],
  },
  { label: ['Bring your own keys', 'أحضر مفاتيحك'], values: ['yes', 'yes'] },
  { label: ['Recurring subscription', 'اشتراك متكرر'], values: ['no', 'no'] },
  { label: ['Local tools + living playbook', 'أدوات محلية + دليل حيّ'], values: ['yes', 'yes'] },
  {
    label: ['MCP servers', 'خوادم MCP'],
    values: [['Open during the season', 'مفتوحة خلال الموسم'], ['Open', 'مفتوحة']],
  },
  {
    label: ['Specialist agents', 'الوكلاء المتخصصون'],
    values: [['16', '١٦'], ['16', '١٦']],
  },
  {
    // Honest: there is no hosted inference in this release, so nobody sells credits.
    label: ['Hosted model credits', 'رصيد النماذج المستضافة'],
    values: ['no', 'no'],
  },
  {
    label: ['Updates', 'التحديثات'],
    values: [['v11.x', 'v11.x'], ['v11.x · perpetual key', 'v11.x · مفتاح دائم']],
  },
  { label: ['Seats', 'المقاعد'], values: [['1', '١'], ['1', '١']] },
];

/* The buy-now answer follows the gate instead of promising a fake store. */
const BUY_ANSWER: Pair = FREE_SEASON
  ? [
      'Not yet. Every feature is open with BYOK during the public season and checkout is deliberately closed. Nothing is charged. When a payment gateway is connected, this page will show a direct checkout link.',
      'ليس بعد. كل الميزات مفتوحة بمفاتيحك خلال الموسم العام والدفع مغلق عمداً. لا يُحصَّل شيء. عند ربط بوابة دفع ستعرض هذه الصفحة رابط دفع مباشراً.',
    ]
  : SITE.checkoutUrl
    ? [
        `Yes — a payment link is configured below. It opens the gateway you control; this site never takes card details, sells credits or resells inference. The one-time Owner License is $${FOUNDING} for the founding cohort and $${LIST} afterwards.`,
        `نعم — رابط دفع مُعدّ أدناه. يفتح بوابة الدفع التي تتحكم بها؛ لا يأخذ هذا الموقع بيانات البطاقة ولا يبيع رصيداً ولا يعيد بيع الاستدلال. رخصة المالك دفعة واحدة بـ ${FOUNDING}$ للموجة المؤسِّسة و${LIST}$ بعدها.`,
      ]
    : [
        'Not yet. No payment gateway is configured, so no checkout button is shown. Nothing is charged until a real payment link is published here.',
        'ليس بعد. لم تُربط أي بوابة دفع، لذلك لا يظهر زر دفع. لا يُحصَّل شيء حتى يُنشر رابط دفع حقيقي هنا.',
      ];

const FAQ: { q: Pair; a: Pair }[] = [
  {
    q: ['Is SADEEM free today?', 'هل سديم مجاني اليوم؟'],
    a: [
      'Yes. BYOK is free forever, and during the public season every feature is open — no subscription, no monthly fee and no credits to buy. Bring your keys and everything local stays free.',
      'نعم. المفاتيح مجانية للأبد، وخلال الموسم العام كل الميزات مفتوحة — بلا اشتراك وبلا رسوم شهرية وبلا رصيد يُشترى. أحضر مفاتيحك وكل شيء محلي يبقى مجانياً.',
    ],
  },
  {
    q: ['What is the Owner License?', 'ما هي رخصة المالك؟'],
    a: [
      `A one-time payment of $${LIST} ($${FOUNDING} for the founding cohort) that gives you a perpetual, signed key for the whole v11 series, including every v11.x update. It is a license, not a subscription: nothing renews, nothing is metered, and BYOK remains free either way.`,
      `دفعة واحدة بـ ${LIST}$ (${FOUNDING}$ للموجة المؤسِّسة) تمنحك مفتاحاً موقّعاً دائماً لسلسلة v11 كاملة، مع كل تحديثات v11.x. إنها رخصة لا اشتراك: لا تجديد ولا عدّاد، والمفاتيح تبقى مجانية على أي حال.`,
    ],
  },
  {
    q: ['Is there a subscription or are credits sold?', 'هل يوجد اشتراك أو يُباع رصيد؟'],
    a: [
      'No. There is no monthly plan, no hosted inference and no credit packs to top up in this release. SADEEM does not resell model usage — you connect your own keys and your provider bills you directly. BYOK stays free, and nothing is metered on local work.',
      'لا. لا توجد خطة شهرية ولا استدلال مستضاف ولا حزم رصيد في هذه النسخة. سديم لا يعيد بيع استخدام النماذج — تربط مفاتيحك ومزوّدك يفاترك مباشرة. المفاتيح تبقى مجانية، ولا يُعدّ شيء على العمل المحلي.',
    ],
  },
  {
    q: ['Can I buy a license right now?', 'هل يمكنني شراء رخصة الآن؟'],
    a: BUY_ANSWER,
  },
  {
    q: ['Does a paid license add extra capabilities?', 'هل تضيف الرخصة المدفوعة قدرات إضافية؟'],
    a: [
      'No. During the public season every local feature is open with BYOK. The one-time license is a signed key for the v11 series — a way to support the project, not a credit pack or a separate tool set. Model calls stay billed by your provider.',
      'لا. خلال الموسم العام كل ميزة محلية مفتوحة بمفاتيحك. رخصة المالك مفتاح موقّع لسلسلة v11 — وسيلة لدعم المشروع، لا حزمة رصيد ولا مجموعة أدوات منفصلة. وتبقى استدعاءات النماذج على حساب مزوّدك.',
    ],
  },
  {
    q: ['What does “perpetual signed key” mean?', 'ماذا يعني «مفتاح موقّع دائم»؟'],
    a: [
      'The key never expires and covers the whole v11 series. Its HMAC signature is verified locally by the desktop app when you activate it — the signing secret is generated on your device, so no website can honestly claim to check authenticity. The website can only check the key’s format.',
      'المفتاح لا ينتهي ويغطي سلسلة v11 كاملة. يتحقق تطبيق سطح المكتب من توقيع HMAC محلياً عند التفعيل — يُنشأ سر التوقيع على جهازك، لذلك لا يستطيع أي موقع الادعاء بصدق أنه تحقق من الأصالة. يستطيع الموقع فحص شكل المفتاح فقط.',
    ],
  },
];

const rise = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

/* SIGNATURE ELEMENT — the ledger's two ink rules. The heavy one rules the
   top edge of the first tier row, the hairline the bottom edge of the last;
   together they frame the two entries exactly. */
function LedgerRule({ kind }: { kind: 'ink' | 'hair' }) {
  return (
    <svg className={`price-ledger-rule is-${kind}`} viewBox="0 0 1200 12" preserveAspectRatio="none" aria-hidden="true">
      {kind === 'ink'
        ? <path className="price-rule-ink" pathLength={1} d="M2 6C220 4 420 8 640 5.5S1010 7 1198 5" />
        : <path className="price-rule-hair" pathLength={1} d="M2 6C260 8 520 4 780 6.5S1060 5 1198 6.5" />}
    </svg>
  );
}

/* A stamp-like seal: two concentric circles with an even dash pattern, so
   the "rough" perforation is deliberate and regular, never random. */
function FreeSeasonStamp() {
  const { tx } = useLang();
  return (
    <svg className="price-stamp" viewBox="0 0 140 140" role="img" aria-label={tx('FREE SEASON', 'موسم مجاني')}>
      <circle className="price-stamp-edge" cx="70" cy="70" r="63" pathLength={80} />
      <circle className="price-stamp-inner" cx="70" cy="70" r="55" />
      <text className="price-stamp-text" x="70" y="64" textAnchor="middle">{tx('FREE', 'موسم')}</text>
      <text className="price-stamp-text" x="70" y="85" textAnchor="middle">{tx('SEASON', 'مجاني')}</text>
      <path className="price-stamp-mark" d="M70 92l1.9 4.1 4.5.6-3.3 3.1.9 4.5L70 102.4l-4 1.9.9-4.5-3.3-3.1 4.5-.6z" />
    </svg>
  );
}

export default function PricingPage() {
  const { tx } = useLang();
  const t = (p: Pair) => tx(p[0], p[1]);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  /* A real checkout link ONLY when the free-season gate is off AND an
     explicit gateway URL is configured. Otherwise no button at all —
     a disabled control during the season, never a fake payment flow. */
  const checkoutReady = !FREE_SEASON && !!SITE.checkoutUrl;

  return (
    <div className="price-page">
      {/* ---------- hero ---------- */}
      <section className="wrap price-hero">
        <motion.div {...rise} transition={{ duration: 0.6 }}>
          <span className="label">◆ {tx('PRICING · v11.12', 'الأسعار · v11.12')}</span>
          <h1 className="display" style={{ marginTop: 26 }}>
            {tx('Free during the', 'مجاني خلال')}
            <br />
            <span className="accent italic">{tx('public season.', 'الموسم العام.')}</span>
          </h1>
          <p className="lead price-hero-lead">
            {tx(
              'BYOK is free forever. During the public season every local feature is open — no subscription, no credits, no resale of inference. One optional one-time Owner License is the only paid surface, and checkout stays closed until a real payment gateway is connected.',
              'المفاتيح مجانية للأبد. خلال الموسم العام كل ميزة محلية مفتوحة — بلا اشتراك، بلا رصيد، بلا إعادة بيع للاستدلال. رخصة المالك لمرة واحدة هي الواجهة المدفوعة الوحيدة، ويبقى الدفع مغلقاً حتى تُربط بوابة دفع حقيقية.',
            )}
          </p>
          <div className="price-hero-meta">
            <span>{FREE_SEASON ? tx('Free during the public season', 'مجاني خلال الموسم العام') : tx('One-time license available', 'الرخصة متاحة لمرة واحدة')}</span>
            <span>{tx('No subscription · no credits · your provider bills you', 'بلا اشتراك · بلا رصيد · مزوّدك يفاترك')}</span>
            <span>{SITE.name} · v{SITE.version}</span>
          </div>
        </motion.div>
      </section>

      <div className="wrap"><hr className="rule" /></div>

      {/* ---------- honest free-season / checkout status band ---------- */}
      <section className="wrap section-tight">
        <motion.div className="season-band" {...rise} transition={{ duration: 0.55 }}>
          <div className="season-band-top">
            <span className="label season-live">{tx('PUBLIC SEASON', 'الموسم العام')}</span>
            <span className="label">◆ {FREE_SEASON ? tx('EVERY FEATURE OPEN', 'كل الميزات مفتوحة') : tx('ONE-TIME LICENSE', 'رخصة لمرة واحدة')}</span>
          </div>
          <div className="season-band-body">
            <div className="season-band-copy">
              <h2 className="h3">
                {FREE_SEASON
                  ? tx('Everything is free right now.', 'كل شيء مجاني الآن.')
                  : checkoutReady
                    ? tx('One-time checkout is live.', 'الدفع لمرة واحدة متاح.')
                    : tx('Checkout is not configured yet.', 'الدفع غير مُعدّ بعد.')}
              </h2>
              <p>
                {FREE_SEASON
                  ? tx(
                      'Every feature is open with BYOK and nothing is charged during the public season: no subscription, no credits and no payment gateway. The one-time Owner License below is the planned option. A checkout link will appear here when a payment gateway is connected.',
                      'كل الميزات مفتوحة بمفاتيحك ولا يُحصَّل شيء خلال الموسم العام: بلا اشتراك أو رصيد أو بوابة دفع. رخصة المالك لمرة واحدة أدناه هي الخيار المخطط. سيظهر رابط الدفع هنا عند ربط بوابة دفع.',
                    )
                  : checkoutReady
                    ? tx(
                        'The payment link below opens the gateway URL configured for this site. It is a real one-time purchase — no subscription, no credits, no card details handled here. The desktop app verifies the license key signature locally.',
                        'رابط الدفع أدناه يفتح عنوان بوابة الدفع المُعدّ لهذا الموقع. إنها عملية شراء حقيقية لمرة واحدة — بلا اشتراك، بلا رصيد، ولا تُعالج بيانات البطاقة هنا. يتحقق تطبيق سطح المكتب من توقيع مفتاح الرخصة محلياً.',
                      )
                    : tx(
                        'No payment gateway is configured, so no checkout button is shown. Nothing is charged until a real payment link is published here.',
                        'لم تُربط أي بوابة دفع، لذلك لا يظهر زر دفع. لا يُحصَّل شيء حتى يُنشر رابط دفع حقيقي هنا.',
                      )}
              </p>
            </div>
            {FREE_SEASON && <FreeSeasonStamp />}
          </div>
        </motion.div>

        {/* ---------- two tiers as numbered editorial ledger rows ---------- */}
        <div className="sec-head" style={{ marginTop: 'clamp(40px,6vw,76px)' }}>
          <div className="sec-index">01 / {tx('THE TWO SURFACES', 'الواجهتان')}</div>
          <div className="sec-body">
            <span className="label">{tx('ONE FREE · ONE ONE-TIME LICENSE', 'واحدة مجانية · وواحدة لمرة واحدة')}</span>
            <h2 className="h2" style={{ marginTop: 14 }}>
              {tx('Own the tool.', 'امتلك الأداة.')} <span className="italic">{tx('Keep it free.', 'أبقِها مجانية.')}</span>
            </h2>
          </div>
        </div>
        <LedgerRule kind="ink" />
        <div className="tiers">
          {TIERS.map((tier, i) => (
            <motion.div className="frow price-tier price-ledger-entry" key={tier.num} {...rise} transition={{ duration: 0.5, delay: i * 0.05 }}>
              <span className="frow-num">{tier.num}</span>
              <div className="price-tier-name">
                <h3 className="h3">{t(tier.name)}</h3>
                {tier.kind === 'license' && <span className="price-rec label">{tx('ONE-TIME · NOT A SUBSCRIPTION', 'مرة واحدة · ليس اشتراكاً')}</span>}
                <span className="price-cadence">{t(tier.cadence)}</span>
              </div>
              <div>
                <p className="price-blurb">{t(tier.tagline)}</p>
                <ul className="price-list">
                  {tier.features.map((f, j) => <li key={j}>{t(f)}</li>)}
                </ul>
              </div>
              <div className="price-side">
                <div className="stat-num price-amount">{tier.price}</div>
                <span className="price-sub">{t(tier.cadence)}</span>
                {tier.kind === 'download' ? (
                  <Link className="btn btn-solid" href="/download" data-checkout={tier.kind}>
                    <ArrowDownToLine size={16} />{t(tier.cta)}
                  </Link>
                ) : FREE_SEASON ? (
                  <button className="btn" type="button" disabled data-checkout="owner-license">
                    {tx('Coming soon — free season', 'قريباً — الموسم المجاني')}
                  </button>
                ) : checkoutReady ? (
                  <a
                    className="btn btn-solid"
                    href={SITE.checkoutUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-checkout="owner-license"
                  >
                    {tx(`Buy Owner License — $${FOUNDING} founding`, `اشترِ رخصة المالك — ${FOUNDING}$ للمؤسِّس`)}<ArrowUpRight size={15} />
                  </a>
                ) : (
                  <button className="btn" type="button" disabled data-checkout="owner-license">
                    {tx('Checkout not configured', 'الدفع غير مُعدّ')}
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
        <LedgerRule kind="hair" />
        <p className="price-fine">
          {tx(
            `Prices in USD. BYOK $0 forever. Owner License $${LIST} once (founding $${FOUNDING}) — no subscription, no credits, no resale of inference. Nothing is charged during the public season.`,
            `الأسعار بالدولار. المفاتيح ٠$ للأبد. رخصة المالك ${LIST}$ مرة واحدة (المؤسِّس ${FOUNDING}$) — بلا اشتراك، بلا رصيد، بلا إعادة بيع للاستدلال. لا يُحصَّل شيء خلال الموسم العام.`,
          )}
        </p>
      </section>

      {/* ---------- comparison table ---------- */}
      <section className="wrap section-tight">
        <div className="sec-head">
          <div className="sec-index">02 / {tx('SIDE BY SIDE', 'جنباً إلى جنب')}</div>
          <div className="sec-body">
            <h2 className="h2">{tx('Every difference, in one table', 'كل الفروق في جدول واحد')}</h2>
            <p className="lead">{tx('No subscription. No hidden meter on local work.', 'بلا اشتراك. بلا عدّاد خفي على العمل المحلي.')}</p>
          </div>
        </div>
        <div className="cmp-scroll">
          <table className="table cmp-table">
            <thead>
              <tr>{COLUMNS.map((c, i) => <th key={i} scope="col">{t(c)}</th>)}</tr>
            </thead>
            <tbody>
              {COMPARE.map((row, i) => (
                <tr key={i}>
                  <th scope="row">{t(row.label)}</th>
                  {row.values.map((v, j) => (
                    <td key={j} className={v === 'yes' ? 'cmp-yes' : v === 'no' ? 'cmp-no' : undefined}>
                      {v === 'yes' ? t(YES) : v === 'no' ? t(NO) : t(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="wrap section-tight">
        <div className="sec-head">
          <div className="sec-index">03 / {tx('QUESTIONS', 'أسئلة')}</div>
          <div className="sec-body"><h2 className="h2">{tx('Straight answers', 'إجابات مباشرة')}</h2></div>
        </div>
        <div className="faq-list">
          {FAQ.map((item, i) => (
            <motion.div className="faq-item" key={i} data-open={openFaq === i} {...rise} transition={{ duration: 0.45, delay: i * 0.04 }}>
              <button
                type="button"
                className="faq-q italic"
                aria-expanded={openFaq === i}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span>{t(item.q)}</span>
                <span className="faq-sign" aria-hidden="true">+</span>
              </button>
              {openFaq === i && <p className="faq-a">{t(item.a)}</p>}
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------- closing ---------- */}
      <section className="wrap section-tight">
        <div className="price-closing">
          <span className="label">{tx('READY WHEN YOU ARE', 'جاهز متى شئت')}</span>
          <h2 className="display price-closing-title" style={{ marginTop: 16 }}>
            {tx('Make it yours.', 'اجعلها لك.')}
          </h2>
          <div className="row" style={{ marginTop: 30 }}>
            <Link className="btn btn-solid" href="/download">
              <ArrowDownToLine size={17} />{tx('Download SADEEM', 'حمّل سديم')}
            </Link>
            <a className="btn" href={SITE.repo} target="_blank" rel="noreferrer">
              {tx('View source', 'اطّلع على الكود')}<ArrowUpRight size={15} />
            </a>
          </div>
          <p className="price-fine" style={{ marginTop: 26 }}>
            {tx(
              `BYOK stays free forever. The Owner License is one payment of $${LIST} (founding $${FOUNDING}), never a subscription — and no credits are sold in this release.`,
              `المفاتيح تبقى مجانية للأبد. رخصة المالك دفعة واحدة بـ ${LIST}$ (المؤسِّس ${FOUNDING}$)، ليست اشتراكاً أبداً — ولا يُباع رصيد في هذه النسخة.`,
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
