# REVENUE MODEL v11.42 — Research & Recommendation
# نموذج الربح v11.42 — بحث وتوصية

**Date / التاريخ:** 2026-11-22 · **Scope / النطاق:** RESEARCH + RECOMMENDATION ONLY. No source edits, no payment gateway, no pricing enabled.
**النطاق:** بحث وتوصية فقط. لا تعديل كود، لا بوابة دفع، لا أسعار مُفعّلة.

> **Founder's ask / طلب المؤسِّس:** «نظام ربح واضح بميزات حقيقية، مش تبرع… بدي زي أوبن كود وأعلى.» This document answers that directly and honestly. It is written to *disagree* with parts of the premise where the evidence requires it.
> **`webfetch` snapshot:** all external prices below were fetched **2026-11-22** from the live official pages listed in §7. Prices are a snapshot, not a contract. No public revenue/financial figures were found for any competitor — **no revenue number in this doc is invented or estimated as a forecast.**

---

## 0. Direct answer to the founder / إجابة مباشرة للمؤسِّس

**EN — read this first.**

1. **OpenCode does not make money by charging for the agent.** The agent is free and open source. OpenCode makes money from (a) an **inference gateway** (Console: pay-as-you-go at cost + a processing fee), (b) **low-cost monthly subscriptions** that include model usage (Go **$10/mo**, Go Plus **$40/mo**), and (c) **teams/enterprise** controls. Source: `https://opencode.ai/`, `https://opencode.ai/docs/zen/`, `https://opencode.ai/console/go`.
2. **That is exactly the model SADEEM publicly promised NOT to use.** `website/app/layout.tsx:59` says SADEEM "does **not resell inference or sit behind a proxy." OpenCode's Console *is* a proxy/gateway. So "be like OpenCode" and "keep our published promise" cannot both be true. You must choose. This doc recommends **keeping the promise** and earning from a *real one-time Pro License + real team features*, not from reselling tokens.
3. **A monthly subscription for a local tool with no recurring hosted cost is not a revenue model — it is a monthly donation with a login.** Zed's own FAQ is the proof: its **Personal plan is "$0 forever" with your own keys**, and its paid tier exists only because Zed hosts models. If SADEEM hosts nothing, there is nothing to subscribe to. This is why "donation-only" and "subscription" are the same thing for a pure local tool — the honest differentiator is a **real feature set**, not a billing interval.
4. **The ceiling is real.** No purely-local BYOK tool in this research reaches OpenCode/Cursor-scale revenue, because that revenue comes from hosted inference. A local tool can earn honestly from: one-time licenses, team seats for real collaboration features, and (optionally) an opt-in encrypted sync service with real hosting cost. **Anyone promising you "OpenCode-level revenue without hosting" is selling a fantasy.** No public revenue numbers were found, so this doc will not put a number on that ceiling.

**AR — اقرأ هذا أولاً.**

١. **أوبن كود لا يربح من بيع الأداة.** الأداة مجانية ومفتوحة المصدر. الربح يأتي من (أ) **بوابة استدلال** (Console: دفع عند الاستخدام بالتكلفة + رسوم معالجة)، (ب) **اشتراكات شهرية رخيصة** تتضمن استخدام نماذج (Go **١٠$/شهر**، Go Plus **٤٠$/شهر**)، (ج) **فرق ومؤسسات**. المصدر: الروابط في §٧.
٢. **هذا بالضبط ما وعد سديم علناً ألا يفعله.** `website/app/layout.tsx:59` يقول إن سديم «لا يبيع الاستدلال ولا يمرّر عبر وكيل». Console عند أوبن كود هي وكيل/بوابة. «كن مثل أوبن كود» و«احفظ الوعد المنشور» لا يجتمعان. عليك الاختيار. هذه الوثيقة تنصح **بإبقاء الوعد** والربح من **رخصة Pro حقيقية تُدفع مرة واحدة + ميزات فريق حقيقية**، لا من بيع الرموز.
٣. **الاشتراك الشهري لأداة محلية بلا تكلفة مستضافة ليس نموذج ربح — إنه تبرع شهري بتسجيل دخول.** سؤال Zed في صفحة الأسعار: خطة **Personal مجانية "$0 forever"** بمفاتيحك، والخطة المدفوعة موجودة لأن Zed يستضيف نماذج. إذا كان سديم لا يستضيف شيئاً، فلا يوجد ما يُشترك فيه. لذلك «التبرع فقط» و«الاشتراك» شيئان متطابقان لأداة محلية صرفة — الفارق الصادق هو **مجموعة ميزات حقيقية**، لا دورة الفوترة.
٤. **السقف حقيقي.** لا توجد أداة BYOK محلية في هذا البحث تصل لإيرادات أوبن كود/كيرسور، لأن تلك الإيرادات تأتي من الاستدلال المستضاف. الأداة المحلية تربح بصدق من: رخصة مرة واحدة، مقاعد فرق مقابل ميزات تعاون حقيقية، و(اختيارياً) مزامنة مشفّرة باختيار المستخدم مع تكلفة استضافة حقيقية. **من يعدك بإيرادات بمستوى أوبن كود «بدون استضافة» يبيع لك وهماً.** لم تُوجد أرقام إيرادات منشورة، لذلك لن أضع رقماً متوقعاً هنا.

---

## 1. Competitor revenue table / جدول إيرادات المنافسين

All prices **fetched 2026-11-22**, full URLs in §7. All prices exclude tax unless stated.
جميع الأسعار **مجلة بتاريخ ٢٠٢٦-١١-٢٢**، الروابط الكاملة في §٧. الأسعار دون الضرائب ما لم يُذكر غير ذلك.

| Competitor | Revenue mechanism (exact) | What is actually paid for | Price (observed) | Why users pay | Applies to SADEEM? (honest) |
|---|---|---|---|---|---|
| **OpenCode** | Free open-source agent + **inference gateway (Console)** pay-as-you-go **at cost**, fee only **4.6% + $0.31 per credit purchase**; **Go / Go Plus subscriptions**; workspaces & **Enterprise** | Hosted model access, curated/tested models, convenience, team spend controls — **not the agent** | Console: per-1M-token rates (e.g. Claude Haiku 5.5 $0.10 in / $0.50 out); Go **$10/mo**, Go Plus **$40/mo**; Enterprise custom | Cheap predictable access to tested coding models; works in OpenCode *and other agents* | ❌ **Console = the proxy SADEEM promised not to be** (P5). ❌ Go = monthly fee for hosted inference. ⚠️ Only the *team/console-controls* shape is transferable, and only if built locally. |
| **Kilo Code** | Free open-source platform; **Teams $15/user/mo**; **Enterprise custom**; **Kilo Pass** credit subscriptions; **Gateway** pay-as-you-go at exact provider rates (**5% processing fee**); **cloud compute** hourly | Platform/collaboration seat, hosted credits, cloud agent runtime | Teams **$15/user/mo**; Kilo Pass **$19 / $49 / $199 per mo** (up to 50% bonus credits); Gateway $0/mo + usage; cloud **$0.33–$1.20/hour** | Team analytics, shared BYOK, governance; credits only for people who don't want to manage keys | ⚠️ Team **seat** pattern is transferable *if* real shared features exist. ❌ Gateway/credits = reselling inference. |
| **Cursor** | **Tiered subscription** with included usage pool + separately billed third-party models + Teams/Enterprise | Included AI usage, cloud agents, code review, priority access, social/X features | Free **$0**; Plus **$8**; Premium **$30**; Super **$100**; Ultra **$200 /mo**; Teams **$30+/user/mo**; Enterprise custom | Bigger usage pool (weekly refresh), cloud agents & automations, priority access | ❌ No — this is "subscribe to rent hosted inference". SADEEM has no usage pool to sell and the history of "unlimited" wording backfires. |
| **Claude Code** | **Bundled into Anthropic's own subscriptions** + **API pay-as-you-go** + Team/Enterprise | Access to Anthropic's own frontier models and usage limits | Free **$0**; Pro **$20/mo** (**$17/mo** annual); Max **$100/mo**; Ultra **$200/mo**; API per-token; Team/Enterprise custom | Claude Code is included from Pro up; higher tiers = more usage, API credits | ❌ Impossible — SADEEM does not own models. Copying this would mean reselling someone else's access (which providers have actively blocked). |
| **Windsurf** | ⚠️ `windsurf.com/pricing` **now serves Devin (Cognition)** pricing — note the acquisition/redirect honestly. Subscription + extra usage at API price + Teams | Agent quotas, cloud agents, bots, SSO for teams | Free **$0**; Pro **$20/mo**; Max **$200/mo**; Teams **$80/mo** (up to 100 users); Enterprise custom; "use your ChatGPT plan" | Quotas, cloud agents, team collaboration | ⚠️ Only the **team price anchor** ($80/mo for up to 100 users) is useful — and it shows teams can be a real line of business. ❌ Quotas = hosted inference. |
| **Zed** | **Personal $0 forever** with own keys/external agents; **Pro $10/mo** only because Zed hosts models; **Business $30/seat/mo** org controls; **GitHub Sponsors with NO benefits** | Hosted tokens + edit predictions + org admin layer. Sponsorship explicitly buys nothing | Personal **$0 forever**; Pro **$10/mo** ($5 tokens included, then **API list +10%**); Business **$30/seat/mo**, no minimum, order forms at 25+; Sponsors optional | Speed of editor, convenience, org-wide policy/governance | ✅ **Closest honest analogue.** "Personal free forever with your keys" = SADEEM's BYOK promise. ⚠️ Sponsors = the donation model the founder rejects; ⚠️ Business seats only if real org features are built. |
| **Continue.dev** | ⚠️ `continue.dev/pricing` → **404**; `continue.dev` now says **"Continue has joined Cursor"**; open-source codebase remains freely available | Nothing currently sold as a separate Continue plan | **No current pricing page** — do not invent one | Historically: free OSS agent | ⚠️ Historical proof that free OSS builds adoption, but **no monetization left to copy**. Do not cite old "$20/mo Pro" numbers as current. |
| **Aider** | **Free open source, BYOK, no account, no pricing surface at all** | Nothing | **$0** (44K GitHub stars, 6.8M installs) | Terminal-native pair programming with your own keys | ⚠️ The honest warning: massive adoption with **zero direct revenue**. This is the endpoint of "free + BYOK only" — exactly what the founder does not want. |

### 1.1 The one pattern that actually fits / النمط الوحيد المناسب

**EN.** Every viable payer in this table pays for one of three things: (1) **hosted inference** (forbidden by SADEEM's promise), (2) **a team/org control layer** (buildable locally), or (3) **a tool they own outright** (one-time license — rare in 2026 but structurally the best fit for local-first). There is a fourth, **sponsorship**, which is donation by another name and which the founder has rejected. That leaves exactly two honest revenue lines for SADEEM: **one-time Pro license** and **team/org seats** — both of which must buy *real, offline, verifiable features*.

**AR.** كل دافع في الجدول يدفع مقابل واحدة من ثلاث: (١) **استدلال مستضاف** (ممنوع بوعد سديم)، (٢) **طبقة تحكم للفرق/المؤسسات** (قابلة للبناء محلياً)، (٣) **أداة يملكها** (رخصة مرة واحدة — نادرة في ٢٠٢٦ لكنها الأنسب بنيوياً للأداة المحلية). وهناك رابع هو **الرعاية**، وهو تبرع باسم آخر وقد رفضه المؤسِّس. يبقى لسديم خطّان صادقان: **رخصة Pro لمرة واحدة** و**مقاعد فرق** — وكلاهما يجب أن يشتري *ميزات حقيقية تعمل دون اتصال ويمكن التحقق منها*.

---

## 2. The founder's hard constraints / قيود المؤسِّس الصارمة

**EN — non-negotiable, sourced from published promises:**

| # | Constraint | Source |
|---|---|---|
| C1 | **Free BYOK core stays free, forever, unmetered.** Never tax, cap, or meter the user's own keys. | `website/app/pricing/page.tsx:187` (P4 in `MONETIZATION-RESEARCH.md`) |
| C2 | **No hosted inference, no proxy, no resale of tokens.** | `website/app/layout.tsx:59` |
| C3 | **Free during public season; no monthly fee required for anything currently open.** | `website/app/layout.tsx:15`, `website/app/pricing/page.tsx:166` |
| C4 | **Any real offer must be published on the pricing page BEFORE checkout goes live.** | `website/app/pricing/page.tsx:173` |
| C5 | **No telemetry.** Keys stay local and go straight to the provider. | `website/app/page.tsx:29`, `website/app/layout.tsx:59` |
| C6 | **Honor-system keys, public secret, no server** in the current build — do not claim "secure"/"unbreakable". | `docs/LICENSE-SECURITY-V1133.md` §1, §4 |
| C7 | **Paid features must be REAL** — shipped, offline, demonstrable. No fake credits, no fake subscriptions, no roadmap features sold as present. | Founder's brief + `docs/MONETIZATION-RESEARCH.md` §3–4 |

**Consequence / النتيجة:** paid tier = **additive local capability**, never a paywall, never a token resale. Everything paid must work with the app fully offline.

**AR:** الطبقة المدفوعة = **قدرة محلية مُضافة**، لا بوابة دفع على شيء مجاني، ولا بيع رموز. كل ما يُباع يجب أن يعمل والتطبيق دون اتصال تماماً.

---

## 3. Ranked realistic models for SADEEM / النماذج الواقعية مرتّبة

> **Pricing is discussion anchors only.** They are either observed competitor prices or clearly labelled as "no competitor anchor — derive from cost". **No demand forecast, no conversion assumption, no revenue projection is included** because there is no internal data to support one (`MONETIZATION-RESEARCH.md` §7).

### 🥇 Model A — One-time "Pro License" with REAL offline features (recommended first)
### النموذج أ — رخصة Pro لمرة واحدة بميزات محلية حقيقية (موصى به أولاً)

**What must be built / ما يجب بناؤه:**
1. A **shipped, enumerated** Pro feature set — not a label. Candidates already *referenced by internal docs* (verify they actually exist and work offline before selling any of them):
   - parallel/unlimited **subagents** (`docs/AGENT-DRILL-V1135.md`, `docs/SUBAGENT-CAPABILITIES-V1136.md`)
   - **signature / attestation features** (`docs/SIGNATURE-FEATURES-V1138.md`, `docs/SIGNATURE-DECISION-V1140.md`)
   - **schedule / automation engine** (`docs/SCHEDULE-PRO-V1138.md`, `docs/SCHEDULE-GUARD-V1138.md`)
   - **plugin & skill system** (`docs/PLUGINS-PRO-V1138.md`, `docs/PROMPTS-SKILLS-V1138.md`)
   - **preview / flows / library** (`docs/PREVIEW-PRO-V1138.md`, `docs/FLOWS-PRO-V1138.md`, `docs/LIBRARY-REAL-V1138.md`)
   - **theme packs** (`docs/SADEEM-STYLE-GUIDE.md` style system) — cheap to produce, genuinely local.
2. A local entitlement gate that **keeps all free features working** and only unlocks the listed Pro features. No server call. Graceful offline behaviour.
3. One checkout (gateway chosen by founder — **not configured today**), one webhook, one emailed key, one release note. Publish on pricing page first (C4).

**Honest to claim / يُسمح بالقول:** *"A one-time license unlocks these specific offline features in v11.x; BYOK stays free; the key is shareable and enforcement is honor-system."*
**Not honest to claim:** "secure license", "unbreakable", "all future versions included", "supports development forever".

**Rough price anchors:** there is **no true one-time-license competitor** in this research (that is an honest finding — 2026 is subscription/credit dominated). Internal earlier anchors were **$79 founding / $99** and **$99 → $149** (`docs/MONETIZATION-RESEARCH.md` §5); these are **judgement, not market data**. Comparable monthly seats are Zed Pro **$10/mo**, Kilo Teams **$15/user/mo**, Zed Business **$30/seat/mo** — so a $79–$99 lifetime price is roughly 3–10 months of a competitor seat. Keep that framing honest.

**Pros:** only model with zero infra and zero conflict with C1–C7; deliverable locally; easy to explain in Arabic; immediate cash.
**Cons:** honor-system leakage (keys self-mintable — `LICENSE-SECURITY-V1133.md`); one-time cash is finite; **realistic revenue potential is modest and cannot be forecast** without install/conversion data. It validates willingness to pay; it does not fund a large team by itself.

---

### 🥈 Model B — Team / Enterprise self-hosted console (per-seat, local)
### النموذج ب — كونسول فرق/مؤسسات مُستضاف ذاتياً (لكل مقعد، محلي)

**What must be built:** real shared playbooks/skills, shared agents, local admin: usage visibility that is **local/aggregated, not telemetry**, policy controls (which local models/tools are allowed), billing per seat. Optional: exported/on-prem config, SSO only if a self-hosted server is actually deployed (do not claim SSO otherwise).

**Honest to claim:** only features that exist. `docs/MONETIZATION-RESEARCH.md` §2.5 already warned that "shared playbooks" was **on the roadmap, not shipped** — selling it today repeats the "unlimited" credibility mistake in a new form.
**Price anchors (observed):** Kilo Teams **$15/user/mo**; Zed Business **$30/seat/mo** (no minimum, order forms at 25+); Cursor Teams **$30+/user/mo**; Devin Teams **$80/mo up to 100 users**; all Enterprise = custom. A local one-time team license (earlier internal anchor **$249 / 5 seats**) is dramatically cheaper than any of these — a genuine differentiator **once the shared feature is real**.

**Pros:** highest per-customer revenue potential; companies pay for governance, not for tokens; no proxy needed if the control plane is local.
**Cons:** requires real collaboration features + a sales/support motion; SSO/audit/SLA are expensive to do honestly; **revenue potential is real but slow** and depends on B2B trust and a self-hosted deployment story.

---

### 🥉 Model C — Opt-in encrypted cloud sync / backup subscription
### النموذج ج — اشتراك مزامنة/نسخ احتياطي مشفّر باختيار المستخدم

**What must be built:** E2E-encrypted sync of local projects/sessions/config to a server you operate; opt-in only; **must never touch BYOK keys**; local-first app remains fully functional with no account; published encryption and retention details.

**Honest to claim:** "optional, encrypted, you hold the key, we cannot read your data" — only if technically true.
**Conflict check:** this is the **only** model with a genuine recurring cost, so it is the **only** honest monthly subscription — but it adds a server and directly touches the "local-first / no telemetry / keys on device" identity (C5). It is compatible only if strictly opt-in and keys are never uploaded.
**Price anchors:** **none in this competitor set** — none of the eight sells sync as a separate SKU. Therefore **do not invent a price**; derive it from measured storage/egress cost and state that derivation publicly. Treat any "market rate" number you see elsewhere as unverified.

**Pros:** honest recurring revenue; a service people actually pay monthly for; reinforces "your work is safe".
**Cons:** ops burden, abuse handling, data-breach liability; conflicts with brand if done carelessly; **realistic revenue potential unknown** and likely small at launch.

---

### 4️⃣ Model D — Sponsorship + paid marketplace plugins/skills
### النموذج د — الرعاية + سوق مكوّنات/مهارات مدفوعة

**What must be built:** GitHub Sponsors / Ko-fi with **no benefits** (Zed's explicit model) and/or a local plugin/skill marketplace where third parties sell and SADEEM takes a platform cut.

**Honest to claim:** sponsorship buys **nothing**; marketplace items are third-party and support is theirs.
**Price anchors:** Zed Sponsors — arbitrary, no benefits; **no competitor data on plugin marketplace take-rates was fetched**, so **no fee percentage is claimed here**.
**Pros:** zero engineering for sponsorship; aligns with open-source community.
**Cons:** **this is the donation model the founder rejected** — it cannot be the primary answer. Marketplace needs a gateway, critical mass, and trust; near-term revenue is unpredictable and probably negligible. Keep as a **supplement**, not a business model.

---

### 3.1 Ranking summary / ملخص الترتيب

| Rank | Model | Deliverable locally now? | Conflicts with promises? | Honest revenue potential |
|---|---|---|---|---|
| 1 | A — one-time Pro License | ✅ Yes | ❌ None (honor-system caveat only) | Modest, one-time, unforecastable |
| 2 | B — team seats | ⚠️ Only after shared features ship | ❌ None if local | Best per-customer; slow |
| 3 | C — encrypted sync | ❌ Needs server | ⚠️ Brand/privacy tension | Recurring but small/unknown |
| 4 | D — sponsorship + marketplace | ⚠️ Sponsors yes, marketplace no | ❌ None | Donation-like; reject as primary |

---

## 4. TOP recommendation + 90-day plan / التوصية النهائية وخطة ٩٠ يوماً

### 4.1 The recommendation / التوصية

**EN:** Ship **Model A first — ONE one-time Pro License whose value is a specific, shipped, offline feature set** — then use the cash and the evidence to earn **Model B (team seats)**. Explicitly **reject** fake credits, fake subscriptions, and "unbreakable" claims. Do **not** chase OpenCode's revenue mechanism, because it is the business SADEEM promised not to become. This is not "settling for less"; it is the only model where every claim you make in Arabic or English is true on day one.

**AR:** ابدأ بـ**النموذج أ — رخصة Pro واحدة تُدفع مرة واحدة، وقيمتها مجموعة ميزات محددة شُحنت وتعمل دون اتصال** — ثم استخدم المال والدليل للانتقال إلى **النموذج ب (مقاعد الفرق)**. ارفض صراحةً الرصيد الوهمي والاشتراك الوهمي وادعاء «لا يُكسر». **لا تتبع آلية ربح أوبن كود**، لأنها هي التجارة التي وعد سديم ألا يصيرها. هذا ليس «رضاً بالأقل»؛ بل النموذج الوحيد الذي كل ما تقوله فيه بالعربية أو الإنجليزية صحيح من اليوم الأول.

### 4.2 90-day plan / خطة ٩٠ يوماً

| Days | Action | Exit criterion (verifiable) | Gate / blocker owned by founder |
|---|---|---|---|
| **1–15** | **Feature audit.** Open `docs/SIGNATURE-FEATURES-V1138.md`, `SCHEDULE-PRO-V1138.md`, `PLUGINS-PRO-V1138.md`, `SUBAGENT-CAPABILITIES-V1136.md`, `FLOWS-PRO-V1138.md`, `PREVIEW-PRO-V1138.md`. For each candidate Pro feature: run it offline, confirm it is real, record evidence. Delete any stub from the Pro list. | A one-page written list: "Pro adds exactly these N features; all others stay free." No roadmap items. | — |
| **16–35** | **Harden the real features + gate.** If a candidate is weak, *build it* (e.g. unlimited parallel subagents, signature export/attestation, schedule engine, theme packs). Implement local entitlement gate that never touches free features, never calls a server, and degrades gracefully. Keep `FREE_SEASON` / BYOK untouched. | A build where a free install and a Pro install differ **only** in the documented features; both work fully offline. | — |
| **36–50** | **Publish the offer before enabling checkout (C4).** Update pricing page with exact price, exact feature list, "keys are shareable / honor system", "v11.x only", no "unlimited AI", no "secure". | Pricing page live and truthful while checkout is still disabled. | **Founder must choose a payment gateway** (Lemon Squeezy / Paddle / Gumroad-style). **None is configured today** — no gateway = no real checkout. |
| **51–70** | **One checkout, one webhook, one key.** Wire the chosen gateway → webhook (verify signature) → email a signed key. No license server (per C6). Test end-to-end with a real card and refund path. Activate Abandoned-cart-free, simple flow. | A real payment produces a real key that unlocks the documented features offline; a refund path exists. | Founder: gateway account, tax/refund policy, store listing copy. |
| **71–80** | **Soft launch to existing community.** Founding price only if honestly time-boxed and stated as such. Ask buyers one question: "which feature made you pay?" Publish a transparency note: honor system, shareable keys, no server. | First real paying customers + recorded answers; zero claims of "unbreakable". | — |
| **81–90** | **Decide the next line from evidence, not guesses.** If multiple teams ask for shared playbooks → **build Model B** (do not sell it until it ships). If individuals dominate → add a second Pro feature pack / theme packs. Only if leakage is *measured* as material → revisit server-side activation using `LICENSE-SECURITY-V1133.md` §3 — a fast-follow project, never a launch blocker. | A written decision with the evidence that drove it. | Founder: accept that server-side verification is a separate project with a real delay. |

### 4.3 What NOT to do / ما لا يجب فعله

**EN — hard no's:**

- ❌ **Fake credits / token wallet.** Selling credits means SADEEM proxies/resells inference — a direct contradiction of the published promise (C2 / P5). Zed and Kilo charge +10% / 5% fee because they actually host. We do not. Do not build a wallet to look like a competitor.
- ❌ **Fake subscription.** A monthly fee for a local tool with no recurring cost is a donation with extra steps, and it breaks "no monthly fee for anything currently open" (C3). The founder already rejects donation models — a subscription with no recurring service is one.
- ❌ **"Unbreakable / secure / device-bound license."** The secret is public; keys are self-mintable (`docs/LICENSE-SECURITY-V1133.md` §1). Say "honor system, keys are shareable". Full stop.
- ❌ **Paywall an existing free local capability.** Additive only (C1/C3). "Free during public season" must remain literally true.
- ❌ **Sell a roadmap feature.** No team seat until shared playbooks exist; no "unlimited subagents" if there is a cap. This is how the "unlimited" credibility mistake gets repeated.
- ❌ **"Unlimited AI" wording** — Cursor's 2025 change and CEO apology are the cautionary tale. Say "unlimited **local** features with **your own keys**".
- ❌ **Four SKUs before the first payment works.** Pick one. Billing surface is engineering and trust cost.
- ❌ **Invented numbers.** No projected MRR, no fake conversion rate, no "X% of users will pay". None of that data exists in this repo.
- ❌ **Meter or tax BYOK** — even 1% breaks the identity (C1). No telemetry (C5).

**AR — ممنوعات قاطعة:** رصيد/محفظة رموز وهمية (تناقض وعد «لا وكيل»؛ المنافسون يفرضون ١٠٪ / ٥٪ لأنهم يستضيفون فعلاً ونحن لا)؛ اشتراك وهمي بلا خدمة متكررة (تبرع بخطوات إضافية ويكسر وعد «لا رسوم شهرية»)؛ ادعاء «ترخيص لا يُكسر/آمن/مرتبط بالجهاز» (السر علني والمفاتيح تُصدر ذاتياً)؛ فرض رسوم على قدرة محلية كانت مجانية؛ بيع ميزة على خارطة الطريق؛ كلمة «غير محدود» بلا تحديد «محلياً وبمفاتيحك»؛ فتح أربع واجهات دفع قبل أول دفعة؛ أرقام مالية متخيّلة؛ قياس أو ضريبة على BYOK أو قياس عن بُعد.

---

## 5. Honest caveat / التحذير الصادق

**EN.** Two hard facts, stated plainly:

1. **No payment gateway is configured.** Until the founder picks one and wires webhook → key delivery, every "price" in this document is a **proposal**, and any checkout button is a **placeholder**. `FREE_SEASON = true` must stay true until the full chain is live and tested (`docs/MONETIZATION-RESEARCH.md` P8/P11).
2. **No server-side license verification exists.** License keys use the **public secret** documented in `docs/LICENSE-SECURITY-V1133.md`. Anyone can mint a valid perpetual Owner/Pro key for free. Therefore **any paid tier is honor-system**: keys are shareable and self-issued is trivial. This cannot be fixed by a better constant, obfuscation, longer keys, or native code — only by a server that never ships the secret (`LICENSE-SECURITY-V1133.md` §1). Even with a server, a one-time key must be activation-capped, which annoys reinstalling legitimate users. **Do not call any current or near-term paid tier "enforced", "secure", or "unbreakable".**

We accept this trade knowingly: honor-system licensing is what many respected indie tools use; most users pay anyway. We disclose it instead of hiding it. If measured revenue loss from leakage becomes the binding constraint, build server-side activation as a **deliberate fast-follow** — not as a fake promise at launch.

**AR.** حقيقتان صريحتان: (١) **لا توجد بوابة دفع مُعدّة** — حتى يختار المؤسِّس بوابة ويوصل الـwebhook بتسليم المفتاح، كل «سعر» هنا **مقترح** وأي زر دفع **عنصر توضيحي**، ويجب أن يبقى `FREE_SEASON = true`. (٢) **لا يوجد تحقق ترخيص عبر خادم** — المفاتيح تستخدم السر العلني الموثّق في `docs/LICENSE-SECURITY-V1133.md`، ويمكن لأي شخص إصدار مفتاح مالك/Pro صالح مجاناً. لذلك **أي طبقة مدفوعة تعتمد على الشرف**: المفاتيح قابلة للمشاركة والإصدار الذاتي تافه. لا يُصلح هذا بثابت أفضل أو إخفاء أو مفتاح أطول أو كود أصلي — فقط بخادم لا يُشحن سره. نقبل هذه المقايضة عن علم ونفصح عنها بدل إخفائها، ولا نقول أبداً «ترخيص مُلزم/آمن/لا يُكسر».

---

## 6. Honesty checklist for any future pricing copy / قائمة صدق لأي نسخة أسعار قادمة

- [ ] Every paid feature links to a build where it demonstrably works offline.
- [ ] Price and feature list are on the page **before** checkout is enabled (C4).
- [ ] Sentence present: "BYOK is free and unmetered; keys stay on your device."
- [ ] Sentence present: "This is honor-system; keys can be shared."
- [ ] Sentence present: "SADEEM does not resell inference or sit behind a proxy" — and **no credit wallet exists that would make it false** (C2).
- [ ] No word "unlimited" except "unlimited **local** features with your own keys".
- [ ] "Lifetime" (if used) = v11.x only; next major at a discount, not free (P10 in `MONETIZATION-RESEARCH.md`).
- [ ] No MRR/conversion number appears unless it came from a real measurement.

---

## 7. Sources / المصادر

All `webfetch`ed **2026-11-22** (snapshot — re-verify before publishing prices):

| Source | URL |
|---|---|
| OpenCode home (free agent, Go $10 / Go Plus $40, Console) | https://opencode.ai/ |
| OpenCode Console models & pricing (per-1M-token, 4.6% + $0.31 fee, "sell at cost") | https://opencode.ai/docs/zen/ |
| OpenCode Go subscription ($10 / $40 per month) | https://opencode.ai/console/go |
| Kilo Code pricing (Teams $15/user/mo, Pass $19/$49/$199, 5% fee, cloud $0.33–$1.20/hr) | https://kilo.ai/pricing |
| Cursor pricing ($0/$8/$30/$100/$200, Teams $30+/user/mo) | https://cursor.com/pricing |
| Claude pricing — Claude Code bundled (Free/$20/$100/$200, Pro $17 annual) | https://claude.com/pricing |
| Windsurf pricing → now serves Devin/Cognition pricing (Free/$20/$200/$80) | https://windsurf.com/pricing |
| Zed pricing (Personal $0 forever, Pro $10, Business $30/seat, Sponsors no benefits) | https://zed.dev/pricing |
| Continue — `/pricing` 404; "Continue has joined Cursor"; OSS still free | https://continue.dev/ |
| Aider — free BYOK OSS, no pricing surface (44K stars, 6.8M installs) | https://aider.chat/ |

Internal sources (no external claims):
- `docs/LICENSE-SECURITY-V1133.md` — honor-system key reality, options, minimal server architecture.
- `docs/MONETIZATION-RESEARCH.md` — 2026 patterns, promise audit P1–P11, earlier price anchors, uncertainties.
- `website/app/pricing/page.tsx`, `website/app/layout.tsx`, `website/app/page.tsx`, `electron/services/billingService.ts` — published promises and current `FREE_SEASON` gate.
- Internal docs listing candidate Pro features (verify shipped status before selling): `docs/SIGNATURE-FEATURES-V1138.md`, `docs/SCHEDULE-PRO-V1138.md`, `docs/PLUGINS-PRO-V1138.md`, `docs/SUBAGENT-CAPABILITIES-V1136.md`, `docs/FLOWS-PRO-V1138.md`, `docs/PREVIEW-PRO-V1138.md`.

**Uncertainties / أوجه عدم اليقين:** no public competitor revenue figures; no internal install/conversion/retention data; Windsurf and Continue pages reflect acquisitions, not standalone current pricing; no gateway terms re-verified today; plugin-marketplace take-rates not researched; tax/refund/consumer-law obligations for an offline key sold globally not researched here. **No revenue number should be added to this doc without real measurement.**

---

**End of research/recommendation. No source code, billing UI, or payment integration was changed. / نهاية البحث والتوصية. لم يُغيّر أي كود أو واجهة دفع أو تكامل دفع.**
