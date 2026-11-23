# v11.43 — إزالة قسم «شاهده يعمل» من الموقع / Removal of the “WATCH IT WORK” section

## القرار / Decision
- **AR:** بناءً على طلب المؤسّس الصريح، أُزيل القسم بالكامل من الصفحة الرئيسية: `§ / IN USE — WATCH IT WORK — One prompt. A full trail.` مع نافذة `sadeem — agent workspace` والتسمية `FIG. 02 — A stylised illustration of SADEEM at work, not a screen recording.` لا يظهر أي أثر لهذا القسم في مكوّنات `tsx/ts` بعد الآن.
- **EN:** Per the founder's explicit request, the entire illustrative section `§ / IN USE — WATCH IT WORK — One prompt. A full trail.` was deleted from the homepage, including the `sadeem — agent workspace` mock, its tools/live preview, and the caption `FIG. 02 — A stylised illustration of SADEEM at work, not a screen recording.` No trace of that copy remains in any `tsx/ts` source file.

> **ملاحظة مسار الملف / File-path note:** بيان المهمة ذكر `website/app/download/page.tsx`، لكن النص الحرفي للقسم كان موجوداً فعلياً في `website/app/page.tsx` (الصفحة الرئيسية) عند السطور ~99–1475. صفحة التنزيل لا تحتوي على هذا القسم؛ التسمية `FIG. 02` الموجودة في `components/download/DownloadPage.tsx:98` تعود لشكل مختلف (`ARTIFACT / WINDOWS`) ولم تُلمس. / The brief named `website/app/download/page.tsx`, but the founder's exact copy lived in `website/app/page.tsx` (homepage), lines ~99–1475. The download page does not host the section; the `FIG. 02` at `components/download/DownloadPage.tsx:98` belongs to a different figure (`ARTIFACT / WINDOWS`) and was left untouched.

## ما أُزيل بالضبط / Exact removals (line numbers refer to the file BEFORE the edit)

All in `website/app/page.tsx`:

| Cause / السبب | Original lines | What was removed |
|---|---|---|
| Section copy in `DEMO` | 100–107 | `index` (`§ / IN USE`), `label` (`WATCH IT WORK`), `title1` (`One prompt.`), `title2` (`A full trail.`), `lead` |
| Section-only mock copy | 109–112, 114–117, 120–123, 126–133, 137–140 | `prompt`, `reason`, `result`, `tool2*`, `answer`, `caption` (`FIG. 02 …`) |
| Section-only rail/console data | 153, 155–170, 177–199, 200–204, 213–219, 223–224, 231, 232–250 | `more`, `railMore`, `headTools`, `gerund`, `clock`, `phases`, `toolsStat`, `tokens`, `interrupt`, `reasoningLabel`, `proof`, `msgPhase`, `placeholder`, `filesHead`, `fileMeta`, all `preview*` fields |
| Motion constants + CSS string | 253–384 | `AM_CADENCE_MS`, `AM_BEAT_UNIT`, `APP_MOCK_MOTION` (all `appmock-*` keyframes/timing) |
| Scroll replay hook | 449–478 | `useStageReplay` (used only by the removed section) |
| Pointer geometry hook | 1008–1041 | `CursorTarget`, `useAppMockGeometry` (used only by the removed section) |
| Obsolete ribbon note | 1043–1045 | silk/ribbon comment tied to the section |
| Section component | 1047–1416 | `function ProductInUse()` — the full JSX mock (titlebar, rail, console, tool rows, preview panel, cursor, figcaption) |
| Section render call | 1472–1474 | `{/* 2 — PRODUCT IN USE … */}` and `<ProductInUse />` |

Left intact on purpose: the hero mosaic and its `hpx-*` / `hm-*` copy (other agents own it), `DEMO` fields still used by the hero (`window`, `nav`, `utils`, `consoleLabel`, `session`, `thinking`, `toolName`, `toolPath`, `toolDuration`, `toolOk`, `attachPlus`, `voice`, `ctxLabel`, `ctxValue`, `effort`, `effortValue`, `model`, `send`, `quickCommands`), the three benefits, proof, SEO content, closing CTA, and `/download` (hero, buttons, hashes, FAQ).

Post-edit anchors in `page.tsx`: `const DEMO` at :103, `const BENEFITS` at :149, `function HeroMosaic` at :355, `export default function Home` at :815.

### CSS / التنسيقات
`app/home.css` (`§2 PRODUCT IN USE` :182–288, `§6 APP MOCK` :381+) and `app/app-mock.css` still contain now-unused `.demo-*` / `.appmock-*` rules. They were **not** edited: those are shared sheets owned by other agents (D2 / Z1 / app-mock precision layer) and a concurrent v11.43 hero edit is in progress there. Dead rules have no visual effect because no JSX renders those classes anymore. / القواعد الميتة لا تظهر شيئاً لأن لا عنصراً يستخدمها بعد الآن.

## ذاكرة السيف / “memory” claim — search result
- **AR:** بحث شامل في كل ملفات `tsx/ts` داخل الموقع عن `save memory` / `safe memory` / `saved memory` لم يعثر على أي تطابق حرفي. كما لم يُعثر على أي ذكر لـ `memory` في الملفين المخصصين ليّ (`HomeContent.tsx`، `TerminalDemo.tsx`) — صفر نتائج. لذلك **لم يُحذف أي ادعاء متعلق بالذاكرة**، التزاماً بالتعليمات بعدم اختراع حذف.
- **EN:** A broad search across all website `tsx/ts` files for `save memory` / `safe memory` / `saved memory` found **no exact match**. The two files assigned to this task (`components/home/HomeContent.tsx`, `components/home/TerminalDemo.tsx`) contain **zero** `memory` matches. Therefore **no memory claim was removed** — inventing a removal would be dishonest.

Related-but-not-matching copy found (reported only, **not** edited — outside the assigned files and not the requested phrase):
- `components/home/SEOContent.tsx:54` / `:59` — “the agent's memory of your codebase is yours, not a vendor's” / «ذاكرة الوكيل عن مشروعك ملكك لا ملك بائع».
- `app/page.tsx` BENEFITS item 02 — “It remembers what worked.” / «يتذكّر ما نجح.» (living playbook copy, hero/benefits area owned elsewhere).
- `app/features/page.tsx:645` — `MEMORY PLAYBOOK` plate label (features page).
- `app/docs/page.tsx:313` / `app/auth/page.tsx:85` — technical “pair code lives in memory” wording.
- `components/home/HomeContent.tsx:416` — “living playbook is a plain markdown file…” (no `memory` token).

If the founder meant one of these, an explicit follow-up is needed before touching those files.

## التحقق / Verification
- `cd website && npx tsc --noEmit` — ✅ passed (no output).
- `cd website && npm run build` — ✅ passed (Next.js 16.4.6, 14 static pages, no TypeScript errors). Only pre-existing warnings: Tailwind `content` missing, `postcss.config.js` module type — unrelated to this change.
- `grep` over `website/app/**/*.{tsx,ts}` and `website/components/**/*.{tsx,ts}` for `WATCH IT WORK|FIG. 02|One prompt\.|A full trail\.|§ / IN USE|stylised illustration|PRODUCT IN USE|ProductInUse|APP_MOCK_MOTION` — ✅ no matches (the `FIG. 02` hit in `DownloadPage.tsx` is a different artifact figure and is intentionally retained).
- No dangling TS references to deleted constants/hooks (`APP_MOCK_MOTION`, `useStageReplay`, `useAppMockGeometry`, `AM_*`, `DEMO.caption`, `DEMO.railMore`, `DEMO.preview*`) — ✅ none.
- Files actually modified: `website/app/page.tsx`. No change to `app/download/page.tsx`, `app/download/download.css`, `app/layout.tsx`, `lib/site.ts`, `HomeContent.tsx`, or `TerminalDemo.tsx`.
