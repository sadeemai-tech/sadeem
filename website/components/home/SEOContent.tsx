'use client';

/**
 * SEOContent — an editorial, research-grounded explainer for the homepage.
 *
 * Design contract (matches app/globals.css, the live editorial system):
 *   - numbered section head + hairline "ink plates", never a boxed card grid
 *   - typography and colour come only from existing CSS custom properties
 *   - bilingual through the site's useLang()/tx() pair; first render is 'ar'
 *     on both server and client, so hydration is deterministic
 *   - native <details>/<summary> FAQ: no state, no JS toggle
 *   - NO new motion is introduced here, so the global reduced-motion kill
 *     switch in globals.css covers this section in full by construction
 *   - logical flow + inherited `dir` make it RTL-safe without overrides
 *
 * S1 mounts <SEOContent /> in app/page.tsx before the final CTA.
 */

import { useLang } from '@/lib/i18n';

const HEAD = {
  en: {
    index: '§ / THE SHIPPED BEHAVIOUR',
    label: 'WHAT IS IN THIS RELEASE',
    a: 'A local-first AI coding agent',
    b: 'that shows its work.',
    lead:
      'Search for a local-first AI coding agent, an assistant that uses your own API key, or an Arabic AI coding assistant. Here is the shipped behaviour: which files it writes, which calls leave your machine, which steps wait for approval, and what gets checked before it says done.',
  },
  ar: {
    index: '§ / السلوك المُشحن',
    label: 'ما الذي يتوفّر في هذا الإصدار',
    a: 'وكيل برمجة ذكي يعمل محلياً',
    b: 'يُظهر عمله.',
    lead:
      'ابحث عن وكيل برمجة ذكي يعمل محلياً، أو مساعد يستخدم مفتاح API الخاص بك، أو مساعد برمجة عربي. إليك السلوك المتاح فعلاً: الملفات التي يكتبها، والاستدعاءات التي تغادر جهازك، والخطوات التي تنتظر موافقتك، وما يُفحص قبل أن يُعلن الانتهاء.',
  },
} as const;

type Subsection = {
  no: string;
  plate: 'local' | 'key' | 'mcp';
  en: { title: string; body: string };
  ar: { title: string; body: string };
};

const SECTIONS: Subsection[] = [
  {
    no: '01',
    plate: 'local',
    en: {
      title: 'A local-first AI coding agent, not a cloud tenant',
      body:
        'Most assistants send your repository to a remote service. In SADEEM the agent, its 145 tools and its PLAYBOOK.md run from your machine. Files and credentials stay on disk; provider calls go straight to the provider you chose. The same engine runs in a terminal: sadeem run takes one task and exits, with no Electron binary. Long tasks continue across rounds and compact at the model’s real context window. PLAYBOOK.md is plain markdown you can read, edit or delete. Inference still needs a provider — pick Ollama or LM Studio for a local model and the agent can keep working without an internet connection. Offline-capable, not offline-only.',
    },
    ar: {
      title: 'وكيل برمجة محليّ أولاً، لا مستأجر في السحابة',
      body:
        'معظم المساعدات ترسل مستودعك إلى خدمة بعيدة. في سادم يعمل الوكيل وأدواته الـ١٤٥ وملف PLAYBOOK.md من جهازك. تبقى الملفات وبيانات الاعتماد على القرص، وتذهب استدعاءات المزوّد مباشرة إلى المزوّد الذي اخترته. يعمل المحرك نفسه في الطرفية: يأمر sadeem run بمهمة واحدة ثم يخرج بلا ملف Electron. تستمر المهام الطويلة في جولات جديدة، ويُضغط السياق عند النافذة الحقيقية للنموذج. PLAYBOOK.md ملف Markdown عادي تقرأه وتعدّله وتحذفه. الاستنتاج يحتاج مزوّداً: اختر Ollama أو LM Studio للحصول على نموذج محلي فيستطيع الوكيل الاستمرار دون اتصال بالإنترنت. قابل للعمل دون اتصال، لا يعمل دون اتصال فقط.',
    },
  },
  {
    no: '02',
    plate: 'key',
    en: {
      title: 'Bring your own key, then lock down the edges',
      body:
        'Keys are stored locally. Calls go straight to the provider, which bills you; there is no relay and no resold inference. Permission modes control writes and commands: plan, default, autoEdit, fullAccess. Plan and review stay read-only. Text fetched from a web page, an MCP server or a repo README is marked with its origin. A hostile instruction in that text cannot push an install or destructive command through on autopilot — the run stops and shows the source. The harness checks “done” against files, commands and tests; a verifier from another model family re-checks with read-only commands. Real changes produce a signed proof package anyone can verify and re-run without a key. The gates check evidence; they cannot guarantee the model’s answer is wise.',
    },
    ar: {
      title: 'أحضر مفتاحك، ثم أغلق الحواف',
      body:
        'تُحفظ المفاتيح محلياً. وتذهب الاستدعاءات مباشرة إلى المزوّد الذي يفاترك، بلا وسيط ولا إعادة بيع للاستدلال. تتحكم أوضاع الصلاحية في التعديلات والأوامر: plan وdefault وautoEdit وfullAccess. يبقى وضعا plan والمراجعة للقراءة فقط. يُوسَم أي نص قادم من صفحة ويب أو سيرفر MCP أو ملف README بمصدره. لا تستطيع تعليمات ضارة في ذلك النص دفع أمر تثبيت أو أمر مدمر تلقائياً — يتوقف التشغيل ويُظهر المصدر. تتحقق المنصّة من «تم» مقابل الملفات والأوامر والاختبارات، ويعيد مدقّق من عائلة نموذج أخرى الفحص بأوامر للقراءة فقط. كل تغيير حقيقي يُنتج حزمة إثبات موقّعة يستطيع أي شخص التحقق منها وإعادة تشغيلها بلا مفتاح. البوابات تفحص الأدلة، ولا تضمن حكمة إجابة النموذج.',
    },
  },
  {
    no: '03',
    plate: 'mcp',
    en: {
      title: 'Privacy-first coding with MCP — and in Arabic',
      body:
        'MCP is an open standard for reaching outside the editor. Connect servers over stdio, HTTP or SSE. You decide what gets connected. Descriptions are scanned for poisoning, servers can be quarantined, and a changed tool definition needs fresh approval. Specialist agents run in parallel with the full tool registry — they differ by role, not by capability. Before an edit, a git shadow-commit snapshots your files without touching your index or stash; /undo restores files and the conversation together. Ask for an Arabic report and get a real .docx or .pdf with correct RTL shaping. Every string on this site carries one language, so nothing is mixed and no direction is broken.',
    },
    ar: {
      title: 'خصوصية مع MCP — وبالعربية أيضاً',
      body:
        'MCP معيار مفتوح للوصول إلى ما خارج المحرر. اربط السيرفرات عبر stdio أو HTTP أو SSE. أنت من يقرر ما يُوصل. تفحص الأوصاف بحثاً عن التسميم، ويمكن حظر السيرفر، ويحتاج أي تغيير في تعريف أداة موافقة جديدة. يعمل الوكلاء المتخصصون بالتوازي والسجل الكامل للأدوات — تختلف الأدوار لا القدرات. قبل التعديل يلتقط الوكيل نسخة shadow-commit دون لمس الفهرس أو الـstash، ويُرجع /undo الملفات والمحادثة معاً. اطلب تقريراً عربياً فتحصل على ملف .docx أو .pdf بتشكيل RTL صحيح. كل نص في هذا الموقع بلغة واحدة، فلا خلط ولا اتجاه مكسور.',
    },
  },
];

type QA = { en: { q: string; a: string }; ar: { q: string; a: string } };

/** English strings here are mirrored verbatim in layout.tsx FAQPage JSON-LD. */
const FAQ: QA[] = [
  {
    en: {
      q: 'Is SADEEM really a local-first AI coding agent — does it work offline?',
      a: 'Local-first describes where your project lives: files, indexes, the living PLAYBOOK.md and your credentials stay on your Windows machine, and dangerous commands require approval. Model inference still needs a provider — connect an online model (OpenAI, Anthropic, Google, OpenRouter and others via BYOK) or a local model through Ollama or LM Studio. With a local model the agent can keep working without an internet connection, so it is offline-capable rather than offline-only. SADEEM is free during the public season.',
    },
    ar: {
      q: 'هل سادم وكيل برمجة ذكي يعمل محلياً بالفعل — هل يعمل دون إنترنت؟',
      a: '«محلي أولاً» تعني أن مشروعك وفهرسك وملف PLAYBOOK.md ومفاتيحك تبقى على جهاز ويندوز، وأن الأوامر الخطرة تنتظر موافقتك. الاستنتاج ذاته يحتاج مزوّداً: اتصل بنموذج عبر الإنترنت (OpenAI أو Anthropic أو Google أو OpenRouter وغيرها عبر مفتاحك)، أو بنموذج محلي عبر Ollama أو LM Studio. مع نموذج محلي يستطيع الوكيل الاستمرار دون اتصال، لذا هو «قابل للعمل دون اتصال» لا «يعمل دون اتصال فقط». سادم مجاني خلال الموسم العام.',
    },
  },
  {
    en: {
      q: 'What does “bring your own key” mean, and which providers are supported?',
      a: 'Bring your own key (BYOK) means you supply the API key from a provider you choose — SADEEM does not resell inference or sit behind a proxy. Keys are stored locally and sent directly to that provider. Twelve providers are supported, including Anthropic, OpenAI, Google, Ollama, Mistral, DeepSeek, xAI, OpenRouter, Groq, Azure, LM Studio and Together. Switch models per task while the agent, its 145 tools and its playbook stay the same.',
    },
    ar: {
      q: 'ماذا يعني «أحضر مفتاحك»، وما المزوّدون المدعومون؟',
      a: 'يعني أن تزوّد سادم بمفتاح API من مزوّد تختاره — لا يبيع سادم الاستنتاج ولا يتوسطه وكيل. تُحفظ المفاتيح محلياً وتُرسل مباشرة إلى المزوّد. يدعم سادم ١٢ مزوّداً، منها Anthropic وOpenAI وGoogle وOllama وMistral وDeepSeek وxAI وOpenRouter وGroq وAzure وLM Studio وTogether. بدّل النموذج حسب المهمة بينما يبقى الوكيل وأدواته الـ١٤٥ ودليله كما هي.',
    },
  },
  {
    en: {
      q: 'How does privacy-first coding with MCP actually protect my code?',
      a: 'MCP (Model Context Protocol) is an open standard for connecting an assistant to external tools and data. SADEEM lets you add your own MCP servers - GitHub, Figma, Supabase, Playwright, Notion and more are common choices. You choose which servers to add, every tool call is visible, and risky actions wait for approval. Each MCP server is its own service, so review what data it can reach before enabling it; privacy-first means you decide, not that every server is local.',
    },
    ar: {
      q: 'كيف تحمي الخصوصية مع MCP كودي فعلاً؟',
      a: 'MCP (بروتوكول سياق النموذج) معيار مفتوح لربط المساعد بأدوات وبيانات خارجية. اربط سيرفرات MCP التي تختارها — GitHub وFigma وSupabase وPlaywright وNotion خيارات شائعة. أنت من يقرر الخوادم المضافة، وكل استدعاء أداة ظاهر، والأوامر الخطرة تنتظر موافقتك. كل خادم خدمة مستقلة، لذا راجع البيانات التي يمكنه الوصول إليها قبل تفعيله. الخصوصية هنا تعني أن القرار قرارك، لا أن كل خادم محلي.',
    },
  },
  {
    en: {
      q: 'Is there an Arabic AI coding assistant, or is the interface English only?',
      a: 'SADEEM is bilingual by design. The interface runs in full Arabic RTL with Cairo typography, and you can prompt in Arabic or English. Code comments, commit messages and the living playbook can be written in either language, so Arabic-speaking developers can work without translating their thinking. Switch language with one tap; nothing is mixed and no direction is broken.',
    },
    ar: {
      q: 'هل يوجد مساعد برمجة ذكي بالعربية، أم أن الواجهة إنجليزية فقط؟',
      a: 'سادم ثنائي اللغة بالتصميم. تعمل الواجهة بالعربية الكاملة مع اتجاه RTL وخط القاهرة، ويمكنك كتابة المطالبات بالعربية أو الإنجليزية. تعليقات الكود ورسائل الالتزام والدليل الحيّ يمكن أن تُكتب بأي من اللغتين، فيعمل المطوّرون العرب دون ترجمة أفكارهم. تبديل اللغة بلمسة واحدة، بلا خلط بين اللغات ولا اتجاه مكسور.',
    },
  },
];

/**
 * Small authored hairline drawing — one per subsection. Pure geometry,
 * no external art dependency, inherits the page's ink/faint tokens.
 */
function Plate({ kind }: { kind: Subsection['plate'] }) {
  return (
    <svg
      viewBox="0 0 240 160"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ width: '100%', height: '100%', color: 'var(--faint)' }}
    >
      {kind === 'local' && (
        <>
          <circle cx="120" cy="78" r="62" strokeDasharray="2 7" opacity=".45" />
          <rect x="84" y="42" width="72" height="72" rx="3" />
          <rect x="96" y="56" width="48" height="34" rx="2" opacity=".6" />
          <circle cx="110" cy="73" r="8" />
          <path d="M116 73h18M128 73v7M134 73v5" />
          <path d="M40 142h160" opacity=".4" />
          <circle cx="120" cy="10" r="1.6" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === 'key' && (
        <>
          <circle cx="120" cy="80" r="48" strokeDasharray="2 8" opacity=".4" />
          <circle cx="120" cy="80" r="10" />
          <path d="M120 30v40M120 90v40M70 80h40M130 80h40" opacity=".5" />
          <circle cx="120" cy="24" r="3" fill="currentColor" stroke="none" />
          <circle cx="120" cy="136" r="3" fill="currentColor" stroke="none" />
          <circle cx="64" cy="80" r="3" fill="currentColor" stroke="none" />
          <circle cx="176" cy="80" r="3" fill="currentColor" stroke="none" />
          <path d="M18 148h204" opacity=".4" />
        </>
      )}
      {kind === 'mcp' && (
        <>
          <circle cx="120" cy="80" r="46" />
          <circle cx="120" cy="80" r="14" />
          <path d="M120 34v32M120 94v32M74 80h32M134 80h32" />
          <path d="M52 40A92 92 0 0 1 188 40" opacity=".45" />
          <path d="M52 120A92 92 0 0 0 188 120" opacity=".45" />
          <circle cx="120" cy="80" r="3" fill="var(--accent-fill)" stroke="none" />
          <path d="M20 148h200" opacity=".4" />
        </>
      )}
    </svg>
  );
}

export function SEOContent() {
  const { tx } = useLang();

  return (
    <section className="section wrap" id="guide" aria-labelledby="seo-title">
      <div className="sec-head">
        <div className="sec-index">{tx(HEAD.en.index, HEAD.ar.index)}</div>
        <div className="sec-body">
          <span className="label">{tx(HEAD.en.label, HEAD.ar.label)}</span>
          <h2 className="h2" id="seo-title" style={{ marginTop: 16 }}>
            {tx(HEAD.en.a, HEAD.ar.a)} <em className="accent italic">{tx(HEAD.en.b, HEAD.ar.b)}</em>
          </h2>
          <p className="lead">{tx(HEAD.en.lead, HEAD.ar.lead)}</p>
        </div>
      </div>

      {SECTIONS.map((s) => (
        <article className="frow" key={s.no}>
          <span className="frow-num mono">{s.no}</span>
          <h3 className="h3">{tx(s.en.title, s.ar.title)}</h3>
          <p>{tx(s.en.body, s.ar.body)}</p>
          <div className="frow-art" aria-hidden="true">
            <Plate kind={s.plate} />
          </div>
        </article>
      ))}

      <hr className="rule" style={{ marginTop: 'clamp(48px,7vw,88px)' }} />

      <div style={{ marginTop: 36 }}>
        <span className="label">{tx('FAQ', 'الأسئلة الشائعة')}</span>
        <h3 className="h3" style={{ marginTop: 12 }}>
          {tx('Limits and answers, stated plainly.', 'الحدود والإجابات، بوضوح.')}
        </h3>

        <div style={{ marginTop: 28 }}>
          {FAQ.map((f) => (
            <details className="faq-item" key={f.en.q}>
              <summary className="faq-q" style={{ listStyle: 'none' }}>
                <span>{tx(f.en.q, f.ar.q)}</span>
                <span className="mono" aria-hidden="true" style={{ color: 'var(--accent)', fontSize: 15, lineHeight: 1 }}>
                  +
                </span>
              </summary>
              <p className="faq-a">{tx(f.en.a, f.ar.a)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
