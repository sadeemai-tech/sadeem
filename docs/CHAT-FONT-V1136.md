# CHAT FONT — v11.36 / خط التشات

**Founder (عربي):** «حسن الخط المستخدم للتشات. هنا اريد خط افضل، يكون اوضح، اكبر. فاهم؟»
**Founder (EN):** "Improve the chat font. I want a better, clearer, larger one. Understood?"

**English:** One more readable step above v11.34 (V7) for the whole chat surface — body, user turns, reasoning and tool rows — while keeping the calm editorial grammar, the layout, Instrument Serif for display, tabular mono numerals, RTL mirroring, both reduced-motion guards and the palette untouched.

**عربي:** خطوة قراءة واحدة إضافية فوق v11.34 (V7) لسطح التشات كامل — المتن، رسائل المستخدم، الاستنتاج وصفوف الأدوات — مع الحفاظ على الطابع الهادئ والتخطيط وخط Instrument Serif للعناوين والأرقام الأحادية المنضبطة ودعم RTL وحاجزي تقليل الحركة وعدم لمس لوحة الألوان.

---

## Before / After — قبل / بعد (px)

| Element / العنصر | V7 (v11.34) | v11.36 | Delta | Source / المصدر |
|---|---:|---:|---:|---|
| Chat message body / متن الرسائل `--chat-base` | 15.5 | **16.75** | +1.25 | `src/components/type-scale.css:79` |
| Chat UI chrome · heads / tool rows / واجهات `--chat-ui` | 15 | **16** | +1 | `src/components/type-scale.css:80` |
| Meta · stamps / clocks / تواريخ `--chat-meta` | 13.5 | **14.5** | +1 | `src/components/type-scale.css:81` |
| Reasoning stream / بث الاستنتاج `.kb-think-body` | 15.5 | **16.75** | +1.25 | `src/components/type-scale.css:173` |
| Tool verb caps / فعل الأداة `.sc18-tverb` | 10.5 | **11.5** | +1 | `src/components/type-scale.css:178` |
| Tool result mono / نتيجة الأداة `.sc18-res-pre` | 12.5 | **13.5** | +1 | `src/components/type-scale.css:187` |
| User bubble / فقاعة المستخدم `.sc-userbody` | 13.5 (active v13) | **16.5** | +3 | `src/components/console.css:375` (base `:64`) |
| Reasoning head / رأس الاستنتاج `.kb-think-head` | 13 | **14** | +1 | `src/components/console.css:567` |
| Reasoning peek / لمحة الاستنتاج `.sc18-think-peek` | 12.5 | **13.5** | +1 | `src/components/console.css:586` |
| Phase line / سطر المرحلة `.cf-phase-line` | 11 | **12** | +1 | `src/components/chat-final.css:71` |
| Run progress / شريط التشغيل `.cf-run-progress` | 11 | **12** | +1 | `src/components/chat-final.css:123` |
| Inline error link / رابط الخطأ `.sc18-res-explain` | 11 | **12** | +1 | `src/components/chat-final.css:716` |
| Image caption / وصف الصورة `.sc18-imgres-cap` | 11 | **11.5** | +0.5 | `src/components/chat-final.css:839` |
| Lightbox caption / وصف العرض الكامل `.sc18-imgres-lbcap` | 12 | **12.5** | +0.5 | `src/components/chat-final.css:866` |

### Leading /المسافة بين الأسطر

| Element | V7 | v11.36 | Source |
|---|---:|---:|---|
| Chat stream / المتن | 1.65 | **1.55** | `type-scale.css:84` (`console.css:46`) |
| Reasoning stream / الاستنتاج | 1.62 / 1.7 | **1.58** | `type-scale.css:174` (`console.css:594`) |
| User bubble / فقاعة المستخدم | 1.62 / 1.65 | **1.58** | `console.css:376` (`console.css:65`) |

Tighter leading is deliberate: larger glyphs keep the same dense rhythm, so nothing reflows into extra rows / المسافة الأضيق مقصودة حتى يحتفظ النص الأكبر بنفس الإيقاع الكثيف فلا يتغير التخطيط.

---

## What changed / ما الذي تغيّر

- **One more readable step, scoped.** All size changes live under `.chat-panel-root`. Editors (`.monaco-editor`, `.xterm`), mono tool chips and dense data tables are untouched.
- **Legibility.** A hair of ink weight (`font-weight: 450`) on chat reading text only — Cairo (variable) renders it as 450, Inter (static 400/500) stays at 400, so the voice never turns bold. `type-scale.css:76–84`, `console.css:54–61`.
- **Founder's V7 literals retained.** `tests/v1134-ui-layout.test.mjs` guards the exact v11.34 values, so those declarations stay at `type-scale.css:72–74, 172, 177, 186` and the effective v11.36 values immediately follow (CSS last-declaration-wins). Both suites stay green.
- **Display + numerals intact.** Instrument Serif still owns page/preview/goal titles; Arabic resolves to Cairo via the existing `--font-display-ar` guard. Tabular mono (`--font-mono-x`, `font-variant-numeric: tabular-nums`) is unchanged.
- **No boxes returned.** Tool cards stay frame-free: 1px rail only, no border/fill/shadow (`console.css:408+`).
- **RTL + motion + palette.** Logical insets (`inset-inline-*`, `border-inline-start`) and `:where(html[lang='ar'], html[dir='rtl'])` guards mirror the UI. Both `@media (prefers-reduced-motion: reduce)` and `html.reduce-motion` guards remain in all three sheets. No literal colors were introduced — every hue is an existing token.

---

## Files / الملفات

- `src/components/type-scale.css` — chat tokens + reasoning/tool row step, tighter leading.
- `src/components/console.css` — message body, user bubble (both base + active v13 rule), reasoning head/peek, legibility weight.
- `src/components/chat-final.css` — small chat-supporting mono rows.
- `tests/v1136-chat-font.test.mjs` — new source guard (11 tests).
- `docs/CHAT-FONT-V1136.md` — this note.

## Verification / التحقق

```
node --test --test-force-exit tests/v1136-chat-font.test.mjs   # 11/11 pass
node --test --test-force-exit tests/v1134-ui-layout.test.mjs   # 11/11 pass (green)
node --test --test-force-exit tests/v1127-ui-guard.test.mjs    # 14/14 pass (green)
npm run build                                                  # ✓ built in 1m 35s (CSS compiles)
```
