'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Check, CircleCheck, Loader2, Play, Sparkles, Wrench } from 'lucide-react';
import { useLang } from '@/lib/i18n';

type Phase = 'typing' | 'thinking' | 'tool' | 'verify' | 'answer' | 'done';

const ORDER: Phase[] = ['typing', 'thinking', 'tool', 'verify', 'answer', 'done'];

const PHASES: { key: Phase; en: string; ar: string }[] = [
  { key: 'typing', en: 'PROMPT', ar: 'الطلب' },
  { key: 'thinking', en: 'THINK', ar: 'تفكير' },
  { key: 'tool', en: 'TOOL', ar: 'أداة' },
  { key: 'verify', en: 'VERIFY', ar: 'تحقق' },
  { key: 'answer', en: 'ANSWER', ar: 'إجابة' },
  { key: 'done', en: 'DONE', ar: 'تم' },
];

/* A tiny, self-contained animation vocabulary. Scoped under .td-demo so it
   cannot leak into the rest of the site, and fully disabled for reduced
   motion / the site-wide art kill switches. Only transform/opacity are
   animated — nothing here can trigger layout. */
const KEYFRAMES = `
.td-demo .td-caret{display:inline-block;width:1.5px;height:1.05em;margin-inline-start:2px;
  background:var(--accent);vertical-align:-2px;animation:td-blink 1.1s steps(1) infinite}
.td-demo .td-dot{width:4px;height:4px;border-radius:50%;background:var(--accent);
  animation:td-pulse 1.25s ease-in-out infinite}
.td-demo .td-dot:nth-child(2){animation-delay:.16s}
.td-demo .td-dot:nth-child(3){animation-delay:.32s}
.td-demo .td-spin{animation:td-spin 1.4s linear infinite}
.td-demo .td-scan{animation:td-scan 4.8s linear infinite}
.td-demo .td-live{animation:td-live 2.6s ease-in-out infinite}
@keyframes td-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes td-pulse{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
@keyframes td-spin{to{transform:rotate(360deg)}}
@keyframes td-scan{0%{transform:translateY(-120px);opacity:0}12%,88%{opacity:1}100%{transform:translateY(360px);opacity:0}}
@keyframes td-live{0%,100%{opacity:.4}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .td-demo .td-caret,.td-demo .td-dot,.td-demo .td-spin,
  .td-demo .td-scan,.td-demo .td-live{animation:none!important}
}
html.reduce-motion .td-demo .td-caret,html.reduce-motion .td-demo .td-dot,
html.reduce-motion .td-demo .td-spin,html.reduce-motion .td-demo .td-scan,
html.reduce-motion .td-demo .td-live,
html[data-art='off'] .td-demo .td-caret,html[data-art='off'] .td-demo .td-dot,
html[data-art='off'] .td-demo .td-spin,html[data-art='off'] .td-demo .td-scan,
html[data-art='off'] .td-demo .td-live{animation:none!important}
`;

const shellStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  padding: '26px clamp(18px, 3vw, 30px) 18px',
  isolation: 'isolate',
  overflow: 'hidden',
  color: 'var(--ink)',
  fontFamily: 'var(--mono)',
};

const gridStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  pointerEvents: 'none',
  opacity: 0.7,
  backgroundImage:
    'linear-gradient(to right, var(--line-soft) 1px, transparent 1px),' +
    'linear-gradient(to bottom, var(--line-soft) 1px, transparent 1px)',
  backgroundSize: '26px 26px',
  maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.9), transparent 90%)',
  WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,.9), transparent 90%)',
};

const cornerStyle = (corner: 'tl' | 'tr' | 'bl' | 'br'): CSSProperties => ({
  position: 'absolute',
  width: 12,
  height: 12,
  zIndex: 2,
  pointerEvents: 'none',
  borderTop: corner.startsWith('t') ? '1px solid var(--line-strong)' : undefined,
  borderBottom: corner.startsWith('b') ? '1px solid var(--line-strong)' : undefined,
  borderLeft: corner.endsWith('l') ? '1px solid var(--line-strong)' : undefined,
  borderRight: corner.endsWith('r') ? '1px solid var(--line-strong)' : undefined,
  top: corner.startsWith('t') ? 9 : undefined,
  bottom: corner.startsWith('b') ? 9 : undefined,
  left: corner.endsWith('l') ? 9 : undefined,
  right: corner.endsWith('r') ? 9 : undefined,
});

const baseRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

/**
 * The visual centerpiece: a self-playing session that types a prompt,
 * pauses to "think", calls a tool, verifies it, streams the answer and
 * lands on a learning event. It is explicitly an illustrative session —
 * never presented as a live recording. The loop is disabled and the final
 * frame rendered immediately for reduced-motion visitors; all state starts
 * deterministically so server and client markup match on hydration.
 */
export function TerminalDemo() {
  const { tx } = useLang();
  const reduce = !!useReducedMotion();

  const prompt = tx('add a refresh-token flow to the API', 'أضف تدوير رموز التحديث إلى الـ API');
  const answer = tx(
    'Done. Refresh tokens rotate on use. Tests cover rotation and expiry; the run report lists the files touched and the commands run.',
    'تم. تُدار رموز التحديث عند الاستخدام. تغطي الاختبارات التدوير والانتهاء، ويسرد تقرير التشغيل الملفات المعدّلة والأوامر المنفّذة.',
  );
  const learned = tx(
    'SADEEM learned: this repo uses pnpm — saved to PLAYBOOK.md.',
    'تعلّم سادم: هذا المستودع يستخدم pnpm — حُفظ في PLAYBOOK.md.',
  );
  const status = tx('illustrative session', 'جلسة توضيحية');
  const note = tx('example workflow · runs locally on your machine', 'سير عمل توضيحي · يعمل محلياً على جهازك');
  const reading = tx('reading workspace files', 'جارٍ قراءة ملفات مساحة العمل');
  const passed = tx('tests passed', 'نجحت الاختبارات');

  const words = useMemo(() => answer.split(' '), [answer]);

  const [phase, setPhase] = useState<Phase>('typing');
  const [typed, setTyped] = useState(0);
  const [streamed, setStreamed] = useState(0);

  // Reduced motion: jump to the finished frame; no timers are ever started.
  useEffect(() => {
    if (reduce) {
      setTyped(prompt.length);
      setStreamed(words.length);
      setPhase('done');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    let delay = 0;
    let next: (() => void) | null = null;

    switch (phase) {
      case 'typing':
        delay = typed < prompt.length ? 42 : 340;
        next = () => (typed < prompt.length ? setTyped((v) => v + 1) : setPhase('thinking'));
        break;
      case 'thinking':
        delay = 620;
        next = () => setPhase('tool');
        break;
      case 'tool':
        delay = 820;
        next = () => setPhase('verify');
        break;
      case 'verify':
        delay = 950;
        next = () => setPhase('answer');
        break;
      case 'answer':
        delay = streamed < words.length ? 125 : 520;
        next = () => (streamed < words.length ? setStreamed((v) => v + 1) : setPhase('done'));
        break;
      case 'done':
        delay = 4600;
        next = () => {
          setTyped(0);
          setStreamed(0);
          setPhase('typing');
        };
        break;
    }

    const timer = setTimeout(() => next?.(), delay);
    return () => clearTimeout(timer);
  }, [phase, typed, streamed, prompt.length, words.length, reduce]);

  const active = ORDER.indexOf(phase);

  const showThinking = phase === 'thinking';
  const showTool = active >= 2;
  const showVerify = active >= 3;
  const showAnswer = active >= 4;
  const showLearned = phase === 'done';

  return (
    <div className="term-shell td-demo" style={shellStyle} aria-label={tx('Animated SADEEM session demo', 'عرض متحرك لجلسة سادم')}>
      <style>{KEYFRAMES}</style>

      {/* mono grid + a slow measurement sweep */}
      <div aria-hidden="true" style={gridStyle} />
      <div className="td-scan" aria-hidden="true" style={{
        position: 'absolute', top: 0, left: '18%', width: 1, height: 44, zIndex: 1,
        background: 'linear-gradient(to bottom, transparent, var(--accent-fill), transparent)',
        opacity: 0.22, pointerEvents: 'none',
      }} />

      {/* fine graduations along the top edge */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: 10, left: '8%', right: '8%', zIndex: 1,
        display: 'flex', justifyContent: 'space-between', pointerEvents: 'none',
      }}>
        {Array.from({ length: 41 }, (_, i) => (
          <i key={i} style={{
            display: 'block', width: 1, height: i % 5 === 0 ? 9 : 4,
            background: i % 5 === 0 ? 'var(--line-strong)' : 'var(--line)',
          }} />
        ))}
      </div>

      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <span key={c} aria-hidden="true" style={cornerStyle(c)} />
      ))}

      <div style={{ position: 'relative', zIndex: 2 }}>
        {/* header */}
        <div style={{ ...baseRow, justifyContent: 'space-between', paddingBottom: 13, borderBottom: '1px solid var(--line)' }}>
          <span style={{ ...baseRow, gap: 9, fontSize: 10, letterSpacing: '0.18em', color: 'var(--dim)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-fill)' }} />
            SADEEM <span style={{ color: 'var(--faint)' }}>/ SESSION</span>
          </span>
          <span style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--faint)' }}>~/workspace</span>
          <span style={{ ...baseRow, gap: 7, fontSize: 10, letterSpacing: '0.1em', color: 'var(--dim)' }}>
            <span className="td-live" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
            {status}
          </span>
        </div>

        {/* phase ruler — six marks that light up as the story advances */}
        <div aria-hidden="true" style={{ display: 'flex', gap: 8, padding: '12px 0 14px' }}>
          {PHASES.map((p, i) => {
            const on = i <= active;
            const current = i === active;
            return (
              <span key={p.key} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  display: 'block', width: '100%', height: 1,
                  background: on ? 'var(--accent)' : 'var(--line)',
                  opacity: current ? 1 : on ? 0.6 : 1,
                }} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                  <span style={{ width: 1, height: current ? 12 : 7, background: on ? 'var(--accent)' : 'var(--line-strong)' }} />
                  <span style={{
                    fontSize: 8.5, letterSpacing: '0.14em', whiteSpace: 'nowrap',
                    color: current ? 'var(--accent)' : on ? 'var(--dim)' : 'var(--faint)',
                  }}>{tx(p.en, p.ar)}</span>
                </span>
              </span>
            );
          })}
        </div>

        {/* session body — a fixed min-height keeps every phase steady */}
        <div style={{ minHeight: 222, padding: '4px 0 2px', fontSize: 13, lineHeight: 1.85 }}>
          {/* the typed prompt */}
          <div style={baseRow}>
            <span aria-hidden="true" style={{ color: 'var(--accent)', fontWeight: 500 }}>❯</span>
            <span dir="auto" style={{ color: 'var(--ink)' }}>
              <span style={{ color: 'var(--dim)' }}>sadeem </span>
              &quot;{prompt.slice(0, typed)}&quot;
              {phase === 'typing' && <span className="td-caret" aria-hidden="true" />}
            </span>
          </div>

          {/* thinking pulse */}
          {showThinking && (
            <div style={{ ...baseRow, marginTop: 14, color: 'var(--dim)', fontSize: 12 }}>
              <Loader2 size={14} className="td-spin" style={{ color: 'var(--accent)' }} />
              <span>{reading}</span>
              <span style={{ ...baseRow, gap: 4, marginInlineStart: 4 }}>
                <i className="td-dot" /><i className="td-dot" /><i className="td-dot" />
              </span>
            </div>
          )}

          {/* tool call + result */}
          {showTool && (
            <div style={{ ...baseRow, marginTop: 14, gap: 10, fontSize: 12 }}>
              <Wrench size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ color: 'var(--ink)' }}>write_file</span>
              <span style={{ color: 'var(--dim)' }}>src/api/auth.ts</span>
              <span style={{ color: 'var(--faint)' }}>· {tx('edited', 'تم التعديل')}</span>
              <Check size={14} style={{ color: 'var(--accent)' }} aria-label="ok" />
            </div>
          )}

          {showVerify && (
            <div style={{ ...baseRow, marginTop: 9, gap: 10, fontSize: 12 }}>
              <Play size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ color: 'var(--ink)' }}>pnpm test</span>
              <span style={{ color: 'var(--faint)' }}>· {passed}</span>
              <CircleCheck size={14} style={{ color: 'var(--accent)' }} aria-label="ok" />
            </div>
          )}

          {/* streamed answer */}
          {showAnswer && (
            <div style={{ ...baseRow, alignItems: 'flex-start', marginTop: 16, gap: 11, lineHeight: 1.9 }}>
              <span style={{
                fontSize: 9, letterSpacing: '0.16em', color: 'var(--accent)',
                borderBottom: '1px solid var(--accent)', paddingBottom: 1, flexShrink: 0,
              }}>SADEEM</span>
              <span dir="auto" style={{ color: 'var(--dim)', fontFamily: 'var(--sans)', fontSize: 13 }}>
                {words.slice(0, streamed).join(' ')}
                {phase === 'answer' && <span className="td-caret" aria-hidden="true" />}
              </span>
            </div>
          )}

          {/* learning event + honest final status */}
          {showLearned && (
            <>
              <div style={{
                ...baseRow, marginTop: 16, gap: 9, fontSize: 12, color: 'var(--accent)',
                borderInlineStart: '1px solid var(--accent)', paddingInlineStart: 11,
              }}>
                <Sparkles size={14} />
                <span>{learned}</span>
              </div>
              <div style={{ ...baseRow, marginTop: 12, gap: 8, fontSize: 10.5, color: 'var(--faint)', letterSpacing: '0.04em' }}>
                <CircleCheck size={13} style={{ color: 'var(--accent)' }} />
                <span>{tx('session complete', 'انتهت الجلسة')} · {passed}</span>
                <span style={{ color: 'var(--line-strong)' }}>·</span>
                <span>{note}</span>
              </div>
            </>
          )}
        </div>

        {/* footer — factual instrumentation, not a claim of a real capture */}
        <div style={{
          ...baseRow, justifyContent: 'space-between', gap: 10,
          paddingTop: 12, borderTop: '1px solid var(--line)',
          fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--faint)',
        }}>
          <span style={baseRow}>
            <span>145 tools</span><span>·</span>
            <span>16 agents</span><span>·</span>
            <span>{tx('keys on your machine', 'المفاتيح على جهازك')}</span>
          </span>
          <span style={{ ...baseRow, gap: 6, color: 'var(--dim)' }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />
            <span className="mono">{status}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
