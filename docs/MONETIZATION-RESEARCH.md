# SADEEM — Monetization Research: Real 2026 Patterns & Options
# دراسة تحقيق الدخل في سديم: أنماط 2026 الحقيقية والخيارات

**Date / التاريخ:** 2026-11-21 · **Version / الإصدار:** v11.12.0 context
**Scope / النطاق:** RESEARCH ONLY. No billing UI, no code changes, no prices enabled.
**بحث فقط:** لا واجهة دفع، لا تعديل كود، لا أسعار مفعّلة.

> Related but different: `website/docs/MONETIZATION.md` (2026-11-18) is the **existing decision + pricing-page design**. This file is an independent **evidence-gathering and option-analysis** report for the founder. Where they disagree, this report flags the disagreement rather than overriding it.
>
> ذو صلة لكنه مختلف: `website/docs/MONETIZATION.md` (١٨ نوفمبر ٢٠٢٦) هو **القرار الحالي + تصميم صفحة الأسعار**. هذا الملف تقرير **بحث وتحليل خيارات** مستقل للأستاذ المؤسِّس. حيث يختلفان، نُشير إلى الاختلاف ولا نُلغي أحدهما.

---

## 0. Methodology & honesty / المنهجية والصراحة

- `websearch` returned **HTTP 402** (quota/billing) in this environment on every attempt. All external evidence below therefore comes from **direct `webfetch` of live pricing pages** and the **Hacker News Algolia public API** (comment search), fetched **2026-11-21**. The earlier study hit the same 402 and used the same workaround.
- Prices are a **snapshot**, not a contract. Vendors change plans frequently — Cursor itself rewrote its "unlimited" wording in June 2025 and was forced to apologise. Treat every number here as "observed on 2026-11-21", not "true forever".
- Hacker News comments are **anecdotes from a self-selected technical audience**, not survey data. They are used here to identify *recurring complaints*, not to measure prevalence.
- No internal conversion, retention, or cost data was available. Revenue logic in this report is therefore **directional, not a forecast**.
- I did **not** open, edit, or create any billing code or checkout UI. The only file written is this report.

> أداة `websearch` أعادت **HTTP 402** في كل محاولة، لذا كل الدليل الخارجي هنا من **جلب صفحات الأسعار مباشرة** و**واجهة Hacker News Algolia العامة** بتاريخ ٢١ نوفمبر ٢٠٢٦. الأسعار **لقطة لحظية** ليست عقداً. تعليقات HN **شهادات فردية** لا إحصاء؛ نستخدمها لرصد **الشكاوى المتكررة** فقط. لا توجد بيانات تحويل أو تكلفة داخلية، فالمنطق المالي هنا **اتجاهي وليس توقعاً**. لم ألمس أي كود فوترة.

---

## 1. Executive summary / الملخص التنفيذي

**EN.** Five patterns dominate AI coding monetization in late 2026. None is a clean fit for SADEEM because SADEEM's cost structure is unusual: the product runs locally, keys stay on the device, and there is no per-user hosted service to rent. That makes "subscribe to access the tool" the wrong frame and "pay for tokens" the only real variable cost.

The 2026 lesson is less about *which* model wins and more about **which promises break trust**:
1. **Never call something "unlimited" if it is metered.** That single wording choice caused the Cursor backlash and CEO apology.
2. **Never make the user pay twice** (provider API bill + tool markup without visible value). This is the single strongest driver of BYOK-first churn.
3. **Never remove an already-free local capability.** It will be read as a rug-pull, especially given SADEEM's explicit public-season promise.
4. **Never auto-renew for a local tool** unless there is a continuously delivered hosted cost to justify it.

**Recommendation (detail in §5):** keep BYOK free and unmetered **forever** as the unbreakable core; make revenue come from **one opt-in one-time Owner License** (not four SKUs at launch); keep hosted credits **optional, at-cost, transparent, and never automatic**; and **defer the team SKU** until shared playbooks actually ship. Prefer radical price transparency over clever packaging.

**AR.** خمسة أنماط تسيطر على تسعير أدوات البرمجة بالذكاء الاصطناعي في أواخر ٢٠٢٦، ولا واحد منها يناسب سديم تماماً، لأن تكلفة سديم مختلفة: المنتج يعمل محلياً، والمفاتيح تبقى على الجهاز، ولا يوجد سيرفر نستأجره لكل مستخدم. لذلك «اشترك لتستخدم الأداة» إطار خاطئ، و«ادفع مقابل الرموز» هو التكلفة المتغيرة الحقيقية الوحيدة.

الدرس الأهم في ٢٠٢٦ ليس *أي نموذج يربح* بل **أي وعد يكسر الثقة**:
١. لا تقل «غير محدود» وأنت تُقنّن — هذا وحده سبب أزمة Cursor واعتذار مديرها.
٢. لا تجعل المستخدم يدفع مرتين (فاتورة المزوّد + رسوم الأداة بلا قيمة مرئية).
٣. لا تسحب قدرة محلية كانت مجانية — سيُقرأ كـ«سحب البساط»، خاصة مع وعد الموسم العام الصريح.
٤. لا تُفعّل تجديداً تلقائياً لأداة محلية بلا تكلفة مستمرة تبرره.

**التوصية (التفاصيل في §٥):** إبقاء BYOK مجانياً بلا قياس **للأبد** كأساس غير قابل للكسر؛ وجعل الإيراد من **رخصة مالك واحدة اختيارية تُدفع مرة واحدة** (لا أربعة منتجات عند الإطلاق)؛ وإبقاء الرصيد المستضاف **اختيارياً وبالتكلفة وشفافاً وغير تلقائي**؛ و**تأجيل رخصة الفريق** حتى تشحن مشاركة الـ playbooks فعلاً. الشفافية السعرية الكاملة أفضل من التغليف الذكي.

---

## 2. The five patterns / الأنماط الخمسة

### 2.1 Pattern A — BYOK + subscription hybrid
### النمط أ — المفاتيح الخاصة + اشتراك هجين

**What it is / ما هو:** free or cheap entry tier with your own keys; a monthly seat for hosted models, convenience, and team controls.

**Live anchors (fetched 2026-11-21) / مراجع سعرية حية:**

| Product | BYOK/free surface | Paid surface | Notable mechanic |
|---|---|---|---|
| **Zed** | Personal **$0 forever**, "unlimited use with your API keys or external agents" | Pro **$10/mo** ($5 tokens included, then API list **+10%**, spend cap); Business **$30/seat/mo**, no minimum, order forms at 25+ | 14-day Pro trial, no card; GitHub Sponsors with **no benefits attached** |
| **Cursor** | Free $0, limited agent/chat requests | Plus **$8**, Premium **$30** (4×), Super **$100** (15×), Ultra **$200**/mo; Teams **$30+/user/mo**; Enterprise custom | Allowance **refreshes weekly**; 3rd-party models at API list price, billed separately; cancel ≥24h before renewal |
| **Devin / Windsurf (Cognition)** | Free $0: light quota, **unlimited inline edits + Tab** | Pro **$20/mo**, Max **$200/mo**, Teams **$80/mo** up to 100 users | "**Use your ChatGPT plan**"; extra usage bought at API pricing; quotas refresh **daily and weekly** |
| **GitHub Copilot** | Free $0: 2,000 completions/mo, limited chat/agent, **no credit card** | Pro **$10**, Pro+ **$39**, Max **$100**/user/mo | AI Credits e.g. Pro = $15 total ($10 base + $5 flex); pooled org-wide on business |

**What works / ما ينجح:** a genuinely usable no-card tier acquires users; a predictable seat price covers convenience and hosted inference; weekly/daily refreshing allowances stop one heavy day from wiping out a month (Cursor explicitly markets this).

**What users hate / ما يكرهه المستخدمون:**
- "Unlimited" labels with hidden metering → the June 2025 Cursor pricing change triggered public outrage and an apology after the page still said "unlimited" while switching to compute limits ([Medium, 2025-07-05](https://generativeai.pub/cursors-pricing-change-sparks-outrage-ceo-apologizes-b9d046295a3c)).
- **Paying twice.** A Show HN founder (2026-01-21): *"frustrated paying for Claude API access, then paying again for tools like Cursor that use my API credits. It felt like paying twice."*
- Subscription OAuth blocked in third-party clients: Anthropic blocked spoofing Claude Code subscriptions (Jan 2026); an HN commenter noted BYOK API tokens mean *"paying a substantial premium to use anything but Anthropic's official clients"* and advised expecting frontier coding to become *"much more pay-to-play"*.
- Unpredictable spend: HN 2026-02-11 — *"I spent 1500 this month… requests vary between 5 cents and 45.74 per call… cost confusion with Cursor pricing and well known upcharge… $1500 could have given me Claude code for the year."*
- Flat-rate distrust: HN 2025-07-19 — *"Any flat rate pricing plan is effectively a bet against the future… wild promises of unlimited usage and consumers feeling tricked."*

**Applies to SADEEM / التطبيق على سديم:** the *hybrid* shape is already close to what the website proposes, but the subscription half is not justified here — there is no hosted service being rented. Copy the **good mechanics** (weekly refresh if any allowance ever exists, no-card free tier, separate metered third-party usage, visible remaining balance) and **not** the monthly seat. Zed's "Personal $0 forever with your keys" is the closest 2026 analogue to SADEEM's BYOK promise, and its sponsor-with-no-benefits channel is a useful optional support path.

> AR (مختصر): النمط الهجين يقدّم طبقة دخول مجانية واشتراكاً شهرياً مقابل الراحة والنماذج المستضافة. ينجح عندما تكون الطبقة المجانية فعلاً صالحة للاستخدام. يكره المستخدمون كلمة «غير محدود» مع قياس خفي، والدفع مرتين، وحظر رموز الاشتراك في العملاء الثلاثيين، وفواتير غير متوقعة. سديم لا يستأجر سيرفراً لكل مستخدم، فيأخذ **الآليات الجيدة** فقط (تجدد أسبوعي، طبقة بلا بطاقة، فصل الاستخدام المستضاف، رصيد مرئي) ولا يأخذ الاشتراك الشهري. أقرب نظير لـ«مفاتيحك مجانية دائماً» هو Zed Personal.

---

### 2.2 Pattern B — Pure pay-as-you-go / credits
### النمط ب — الدفع عند الاستخدام / الرصيد

**What it is / ما هو:** buy a balance once; every request deducts its real cost; no subscription, no auto-renew.

**Live anchors / المراجع:**

| Product | Mechanics observed |
|---|---|
| **OpenRouter** | Standard pay-as-you-go: **5.5%** platform fee **on credit purchase**; Business **8%**; inference at provider **list price**, no per-request markup. **No minimums, no lock-in.** BYOK: **$25,000/mo** of list-price inference with **no fee**, then **5%** above. **Failed/fallback attempts not billed** ("Zero Completion Insurance"); a response that returns nothing is not charged for model tokens. No plan-based rate limits on paid models. |
| **Zed Pro** | $10/mo includes **$5 of tokens**; beyond that billed at **API list +10%**, charged at month end or every additional $10, whichever first; user-set spending cap. |
| **Cursor** | Third-party models at **API list price**, billed separately; on-demand usage after plan allowance; spending caps available. |
| **Devin Pro** | Purchase extra usage **at API pricing**. |

**What works / ما ينجح:** price follows cost, so light users pay little and heavy users cover their load; "failed attempts are not charged" is a concrete, highly trust-building promise; explicit spending caps give control; no minimum and no lock-in lower the psychological barrier.

**What users hate / ما يكرهه المستخدمون:**
- **Opacity.** HN 2025-11-27: *"don't get me started on the blackbox that is Cursor pricing"* plus a call for more observability into cost and context.
- Loss of predictability — a $20 plan becoming a $1,500 month.
- Fees that feel like a "middleman tax" when the user already has a provider relationship.

**Applies to SADEEM / التطبيق على سديم:** this is the closest match to the *variable cost* SADEEM actually incurs, **if** it ever operates a hosted fallback router. The existing `website/docs/MONETIZATION.md` proposal (1 credit = $0.10, 15% fee included, failed attempts not charged, no expiry, no auto top-up) is **well aligned with OpenRouter's observed 2026 shape** — particularly "fee at purchase, not per request" and "failed attempts not billed". Two cautions: (1) the proposed 15% fee is **higher** than OpenRouter Standard's 5.5% and Zed's 10%, so the value story must be explicit; (2) "credits never expire" creates deferred-revenue and tracking obligations that do not exist today.

> AR: النمط الأقرب لتكلفة سديم المتغيرة. OpenRouter يفرض رسومه عند شراء الرصيد (٥٫٥٪ قياسي، ٨٪ أعمال) لا على كل طلب، ولا حد أدنى ولا التزام، والمحاولات الفاشلة لا تُحصب، وBYOK حتى ٢٥ ألف دولار شهرياً بلا رسوم. مقترح سديم (١ رصيد = ٠٫١٠$، رسوم ١٥٪ مشمولة، فشل غير محسوب) متوافق مع هذا الشكل، لكن ١٥٪ أعلى من ٥٫٥٪ و١٠٪ لدى المنافسين، و«الرصيد لا ينتهي» التزام محاسبي جديد.

---

### 2.3 Pattern C — Usage-based with daily/weekly free tiers
### النمط ج — استخدام مع طبقة مجانية يومية/أسبوعية

**What it is / ما هو:** a free allotment that **refreshes on a short cycle**, then metered or paid overage.

**Live anchors / المراجع:**

| Product | Free/refill mechanic |
|---|---|
| **OpenRouter Free** | 25+ free models; **20 requests/min, 50/day**; rises to **1,000/day** after $10 of credit purchases; failed attempts count toward the cap; negative balance blocks free models |
| **GitHub Copilot Free** | **2,000 completions/mo** + limited chat/agent; no card; students get a dedicated plan |
| **Claude Free** | Limited usage **every 5 hours and every week** |
| **Cursor** | Allowance **refreshes weekly** — "so one heavy day never wipes out your whole month" |
| **Devin** | Paid-plan quotas refresh **daily and weekly**; most users reportedly never hit them |
| **Zed Pro trial** | 14 days **or** $5 of usage, **whichever comes first**, no card |

**What works / ما ينجح:** a short refresh cycle feels fair and reduces anxiety; "no card required" is the highest-conversion acquisition phrase in this set; a visible remaining-usage indicator (Cursor, OpenRouter) closes the trust loop.

**What users hate / ما يكرهه المستخدمون:** daily caps that punish burst work; caps that reset at an opaque time; "free" models that silently degrade; and — from HN 2026-09-15 — blunt wording criticism: *"You're not AT&T, you can't get away with calling a limited plan unlimited… credits don't roll over… cannot cancel a subscription."*

**Applies to SADEEM / التطبيق على سديم:** a **daily free tier makes little sense for a local-first tool with BYOK** — the user's own key is already the unlimited tier, and adding a daily allowance would create an artificial scarcity that contradicts the existing promise (§4). If a daily free allowance is ever introduced, it should apply **only** to SADEEM-operated hosted inference, never to local features or BYOK. The genuinely useful takeaway is **short-cycle refresh and visible remaining balance for hosted credits**, not a daily free tier for the app.

> AR: طبقة مجانية تتجدد يومياً/أسبوعياً تنجح عندما تكون مرئية وبلا بطاقة. لكنها لا تناسب أداة محلية بـBYOK: مفتاح المستخدم هو أصلاً الطبقة «غير المحدودة»، وإضافة سقف يومي تخلق ندرة مصطنعة تناقض الوعد القائم. تُستفاد فقط من «التجدد القصير + الرصيد المرئي» للنماذج المستضافة، لا من طبقة مجانية يومية للتطبيق.

---

### 2.4 Pattern D — One-time license + BYOK
### النمط د — ترخيص مرة واحدة + مفاتيح المستخدم

**What it is / ما هو:** pay once to own the tool; supply your own keys; no recurring relationship.

**Live anchors / المراجع:**
- **Aider** — open-source, BYOK, **no account, no pricing surface at all**; 44K GitHub stars, 6.8M installs. Works with local models and copy/paste to web chat.
- **Zed Personal** — **"$0 forever"** with own keys or external agents; the company is additionally funded by optional GitHub Sponsors that explicitly grant **no paid features or support**.
- **Cline** — open-source BYOK agent with a separate "ClinePass" surface; its public `/cline-pass` page did not render pricing in this fetch, so **treat its terms as unverified**.
- **True one-time paid licenses are RARE among 2026 AI coding agents.** This is an important honest finding: the dominant industry shape is subscription or credits. The closest real-world proof that "own it once" works is the open-source/BYOK tier (Aider, Zed Personal), monetized by sponsorship or a separate hosted business — not by a checkout for the editor itself.

**What works / ما ينجح:** zero billing lifecycle — no dunning, proration, cancellation screens, or tax recurrence; matches a tool the user keeps on disk; strong "I own it" framing; no anxiety about cumulative spend on the tool itself.

**What users hate / ما يكرهه المستخدمون:** very little direct hatred of one-time pricing; the real complaints are about **ambiguous "lifetime" definitions** and vendor abandonment. HN 2026-09-15: *"How am I to know that you won't just abandon this one and move on to something new?"* — relevant to any small vendor. Also: a cheap one-time price can be read as "no ongoing support", so scope must be explicit.

**Applies to SADEEM / التطبيق على سديم:** this is the **most structurally honest fit** for a local-first desktop agent — and also the least industry-validated. The existing proposal's Founder License ($99 → $149, perpetual v11 key, all v11.x updates, 50% next-major upgrade) is a *sensible invention*, not an industry norm. Its definition of "Lifetime" is already careful and should be kept verbatim. Biggest risk: **offline keys can be shared**, and a one-time price must fund indefinite maintenance — so the license should be framed as "v11 series + updates", never "all future versions".

> AR: الترخيص لمرة واحدة + BYOK هو **الأنسب بنيوياً** لسديم لكنه **الأقل تحقّقاً صناعياً** في ٢٠٢٦ — أغلب المنافسين اشتراك أو رصيد. أقرب دليل حقيقي هو طبقة المصادر المفتوحة (Aider، Zed Personal) الممولة بالرعاية. مقترح سديم ($99 ثم $149، مفتاح دائم لسلسلة v11، خصم ٥٠٪ للإصدار الرئيسي القادم) اختراع ذكي لكنه ليس معيار الصناعة. تعريف «الدائمة» موجود ومحكم ويجب إبقاؤه حرفياً. الخطر: مشاركة المفاتيح، وتمويل صيانة غير محدودة بدفعة واحدة.

---

### 2.5 Pattern E — Team / enterprise seats
### النمط هـ — مقاعد الفرق والمؤسسات

**What it is / ما هو:** per-seat billing plus centralized admin, pooled spend, SSO/SCIM, audit logs, and policy controls.

**Live anchors / المراجع:**

| Product | Team price | What the seat buys |
|---|---|---|
| **Cursor** | Teams **$30+/user/mo**; Enterprise custom | 4–50× pooled usage, centralized billing, team marketplace for rules/skills/plugins, analytics, privacy settings, SAML/OIDC, SSO, SCIM, audit logs, spend controls, MCP/repo controls |
| **Zed Business** | **$30/seat/mo**, **no minimum**, self-serve; order forms at 25+ | Org-wide model policy, data governance, unified spend, RBAC; SSO/SAML/SCIM **planned, not available**; seats do **not** bundle LLM credits |
| **Devin Teams** | **$80/mo**, up to **100 users** | 2 concurrent free-mode sessions/user, SAML/OIDC, 3 usage tiers, centralized billing, Slack support |
| **GitHub Copilot business** | pooled credits org-wide with admin controls | Enterprise security, IP indemnity, user management, usage metrics, SAML SSO |

**What works / ما ينجح:** pooled usage avoids per-seat waste; admins can cap spend and lock data policy; volume contracts and order forms suit procurement.

**What users hate / ما يكرهه المستخدمون:** seats multiplying cost; admin features sold before they exist (Zed openly labels SSO/SCIM as planned); team-tier pressure on individuals; and long procurement cycles.

**Applies to SADEEM / التطبيق على سديم:** the proposed **$249 / 5 seats one-time** is cheap and simple versus $30–80/user/**month** elsewhere — a real differentiator — **but** the differentiator being sold ("shared playbooks") is explicitly on the roadmap, not shipped. The website already labels it as such, which is honest. Recommendation: **do not launch a team SKU until shared playbooks exist**; selling a seat for a feature that does not exist is the fastest way to repeat the "unlimited" credibility mistake in a new form.

> AR: مقاعد الفرق تُباع مقابل الإدارة والإنفاق المجمّع وSSO/SCIM. مقترح سديم ($249 لخمسة مقاعد، مرة واحدة) رخيص جداً مقارنة بـ$30–80 لكل مستخدم/شهر، لكنه يبيع «مشاركة الـplaybooks» وهي على خارطة الطريق. الموقع يذكر ذلك بصراحة، لكن الأفضل **تأجيل منتج الفريق** حتى شحن الميزة.

---

## 3. Cross-cutting: what users actually hate (evidence table)
## ٣. ما يكرهه المستخدمون فعلاً (جدول الأدلة)

| Complaint / الشكوى | Evidence / الدليل | Design rule for SADEEM / القاعدة لسديم |
|---|---|---|
| "Unlimited" that isn't | Cursor 2025 pricing change + CEO apology; HN 2026-09-15 "you can't get away with calling a limited plan unlimited" | Use exact words: "unlimited **local features with your own keys**", never "unlimited AI" |
| Opaque per-call cost | HN 2026-02-11: $0.05–$45.74 per call, $1,500/month; HN 2025-11-27 "blackbox pricing" | Show real provider token rates and a running balance before spend |
| Paying twice | HN 2026-01-21 (Threadyx founder) | BYOK stays free; if credits exist, they are a convenience fallback only |
| Forced recurring billing | HN 2026-09-15: "cannot cancel a subscription, credits don't roll over" | No auto-renew, no card storage, no expiry pressure |
| Flat-rate subsidy bust | HN 2025-07-19 "flat rate is a bet against the future" | Don't sell hosted inference at a fixed unlimited price |
| Subscription-token lockout | Anthropic blocked third-party Claude Code subscription OAuth, Jan 2026 | Never depend on reselling someone else's subscription; BYOK via official APIs only |
| Vendor abandonment | HN 2026-09-15 "how do I know you won't abandon this?" | Define "Lifetime" narrowly and publish an update policy |

---

## 4. Promise audit — what a future model MUST NOT break
## ٤. تدقيق الوعود — ما لا يجوز للنموذج القادم كسره

These are **public, already-published statements** (not guesses), with source locations:

| # | Promise / الوعد | Source / المصدر | Constraint / القيد |
|---|---|---|---|
| P1 | "Free during the public season, no subscription" / «مجاني خلال الموسم العام، بلا اشتراك» | `website/app/layout.tsx:15`, `website/app/page.tsx:29,279` | Any paid tier must be **additive**, never a paywall on existing local features. |
| P2 | "no subscription, no monthly fee" in the pricing FAQ; "with BYOK every feature is open" | `website/app/pricing/page.tsx:166` | Do not introduce a monthly fee as a **requirement** for anything that is currently open. |
| P3 | "Any real offer will be published on this page **before** it becomes available" / «أي عرض حقيقي سيُنشر في هذه الصفحة قبل توفره» | `website/app/pricing/page.tsx:173` | **Process promise:** page copy must change in the *same release* as checkout, not after. |
| P4 | "BYOK is free and unlimited by design — your keys stay on this device and your provider bills you directly" | `website/app/pricing/page.tsx:187` | **Never meter, cap, or tax BYOK.** Even a 1% fee would break this. |
| P5 | "SADEEM does **not resell inference or sit behind a proxy**" | `website/app/layout.tsx:59` | ⚠️ **Highest-risk contradiction.** Selling hosted credits means SADEEM *does* proxy/resell inference. Either keep hosted inference as an explicit, clearly-labelled separate opt-in service and **rewrite this sentence first**, or don't sell credits at all. |
| P6 | "Keys are stored locally and sent directly to that provider" | `website/app/layout.tsx:59` | A hosted-router design must never touch BYOK keys. |
| P7 | "No telemetry" / «لا قياس عن بُعد» | `website/app/page.tsx:29` | Usage metering for credits must be local/transparent and must not become telemetry. |
| P8 | "Nothing is charged today"; prices are "proposed, not charged"; buttons are placeholders | `website/app/pricing/page.tsx:201`, `website/docs/MONETIZATION.md:20,170` | Keep truthful until checkout + webhook + license minting + ledger are live and tested. |
| P9 | "1 credit = $0.10 … 15% fee included … failed attempts not charged … credits never expire" | `website/app/pricing/page.tsx:194` | If credits are ever sold, these exact mechanics must hold or the copy must change first. |
| P10 | "Lifetime = perpetual non-expiring key for the whole v11 series including every v11.x update; next major at 50% off, not free" | `website/app/pricing/page.tsx:180` | Do not quietly redefine Lifetime to cover less, or promise more (e.g. all future majors free). |
| P11 | `FREE_SEASON = true`; `checkGate()` returns `{ allowed: true }` while true | `electron/services/billingService.ts:35,139` | Do not flip until (gateway → webhook → key minting → ledger → hosted router) is complete. |

**Net rule / القاعدة النهائية:** *a future model may add a way to pay; it may not take away a way that was free.* The free local tool + BYOK is the acquisition engine and the trust anchor.
**القاعدة:** يمكن للنموذج القادم أن يضيف طريقة للدفع، لكن لا يمكنه سحب ما كان مجانياً. الأداة المحلية المجانية + BYOK هي محرك الاكتساب ومرساة الثقة.

---

## 5. Three concrete options / ثلاثة خيارات ملموسة

All options are **proposals only** — no implementation, no UI, no code. Prices are anchors for discussion.

### Option 1 — Ratify the existing four-surface design
### الخيار ١ — اعتماد التصميم الحالي ذي الواجهات الأربع

| | |
|---|---|
| **Shape** | BYOK Free $0 forever · Founder Lifetime $99 → $149 one-time · Credit Packs $10/$25/$100 optional · Team $249/5 seats one-time |
| **Pros / الإيجابيات** | Clear separation of acquisition / immediate cash / usage revenue / expansion; no recurring billing lifecycle; already drafted on the website; credit mechanics mirror OpenRouter's trusted 2026 shape; one-time price is dramatically cheaper than $30–80/user/month seats |
| **Cons / السلبيات** | Four SKUs is a lot of billing surface before a single payment works; **conflicts with promise P5** ("does not resell inference"); team SKU sells a roadmap feature; 15% credit fee is above market (5.5–10%); "credits never expire" creates deferred revenue; requires credit ledger + hosted router before first dollar — significant engineering |
| **Effort / الجهد** | Highest of the three: gateway, products, webhook, key minting, ledger, router |
| **Risk / الخطر** | Medium — trust risk if P5 is not rewritten before credits launch |

### Option 2 — "One license, nothing else" (novel simpler model)
### الخيار ٢ — «رخصة واحدة ولا شيء غيرها» (نموذج أبسط)

| | |
|---|---|
| **Shape** | BYOK Free $0 forever (unchanged) · **one** optional Owner License, $79 founding / $99 after (perpetual v11, all v11.x, 50% next-major) · **no credits at all**, no team SKU; optional GitHub Sponsors / Ko-fi with **no benefits** (Zed's model); if the founder later wants hosted inference, link users to OpenRouter directly with an affiliate-free, transparent note |
| **Pros / الإيجابيات** | Simplest possible billing: one checkout, one webhook, one key; **zero conflict with P5/P7/P8**; no ledger, no router, no token accounting, no expiry liability; matches "local tool you own"; easiest to explain in Arabic and English; minimal support burden for a small team |
| **Cons / السلبيات** | No revenue from heavy non-BYOK users; one-time cash is finite and must fund v11.x indefinitely; no expansion path to teams; sponsorship revenue is usually small; leaves the hosted-inference convenience gap to competitors |
| **Effort / الجهد** | Lowest — only checkout + webhook + signed key |
| **Risk / الخطر** | Low trust risk, higher long-run funding risk |

### Option 3 — Owner License + transparent at-cost fallback wallet
### الخيار ٣ — رخصة المالك + محفظة احتياطية بالتكلفة وشفافة

| | |
|---|---|
| **Shape** | BYOK Free $0 forever · Owner License $79 → $99 one-time · optional **At-Cost Wallet**: top-ups of $10/$25 passed through to a hosted router at **exact provider list price, 0% markup** (or a publicly stated flat ≤10% fee covering payment processing only), no auto top-up, no expiry, failed attempts not charged, live running balance · no team SKU until playbooks ship |
| **Pros / الإيجابيات** | Keeps Option 2's simplicity as the default while capturing usage revenue; **0% markup is a genuine differentiator** against Cursor's well-known upcharge complaints and Zed's +10%; directly answers "don't make me pay twice" — the wallet is only for people who choose not to manage keys; big transparency story in both languages |
| **Cons / السلبيات** | Still needs a ledger + hosted router before selling the wallet (can be launched **after** the license); 0% markup means payment-processor fees (Paddle 5% + 50¢) eat the margin unless a small fee is stated; "at cost" requires publishing and maintaining provider rates; operational burden of refunds/disputes |
| **Effort / الجهد** | Medium, and **sequencable**: ship license first, wallet later |
| **Risk / الخطر** | Low–medium; depends on honest rate publication |

---

## 6. Recommendation / التوصية

**Adopt Option 3, sequenced, with Option 2 as the fallback if the wallet cannot be built honestly.**

1. **Now (no code):** leave `FREE_SEASON = true`, leave the website as-is, do not touch billing code. Treat this report as input to the founder's later decision.
2. **When the founder decides to charge:** ship **one** one-time Owner License first. One SKU, one webhook, one signed perpetual key. Keep the current "Lifetime" definition verbatim (P10). Publish the offer on the pricing page **before** enabling checkout (P3).
3. **Keep BYOK permanently free and unmetered** (P4). This is non-negotiable and is the product's identity.
4. **Resolve P5 before any hosted credits exist.** Either rewrite "does not resell inference or sit behind a proxy" to describe a clearly separate, opt-in hosted convenience service — or omit credits entirely. Do not sell first and edit the copy later.
5. **If a wallet ships:** prefer exact list-price pass-through with a *published* fee, no auto top-up, no expiry, and failed attempts not charged. Publish a live per-request cost view. Avoid "unlimited" language entirely.
6. **Defer the team SKU** until shared playbooks are real. A team license for a feature on the roadmap repeats the credibility mistake of "unlimited" in a different form.
7. **Never introduce a monthly fee** for anything currently open (P1/P2). If a subscription is ever considered, it must be for a genuinely ongoing hosted service with new copy and a public announcement — not a rebranding of the local tool.

**Why not Option 1 as-is:** it is a reasonable design and largely compatible with 2026 patterns, but it tries to launch four monetization surfaces before the first one can take a payment, contains a direct contradiction with an already-published promise (P5), and sells a team feature that is still on the roadmap. Simpler is not just cheaper to build — it is safer for trust.

**التوصية بالعربية:** نعتمد **الخيار ٣** على مراحل، مع **الخيار ٢** كبديل إذا تعذّر بناء المحفظة بشفافية كاملة:
١. الآن: لا كود، لا فوترة، إبقاء `FREE_SEASON = true`.
٢. عند قرار التحصيل: **رخصة مالك واحدة** تُدفع مرة واحدة أولاً، بنفس تعريف «الدائمة» الحالي، مع نشر العرض في صفحة الأسعار **قبل** تفعيل الدفع.
٣. BYOK مجاني بلا قياس **للأبد** — غير قابل للتفاوض.
٤. **حلّ التناقض P5 قبل أي رصيد مستضاف**: إما إعادة صياغة «لا نبيع الاستدلال ولا نمرّر عبر وكيل» لتصف خدمة مستضافة اختيارية منفصلة، أو الاستغناء عن الرصيد تماماً.
٥. إن شُحنت المحفظة: سعر المزوّد بالضبط أو رسوم معلنة، بلا شحن تلقائي ولا انتهاء، والمحاولات الفاشلة غير محسوبة، مع عرض تكلفة حي لكل طلب.
٦. **تأجيل رخصة الفريق** حتى شحن مشاركة الـplaybooks.
٧. **لا اشتراك شهري** على أي شيء مفتوح اليوم.
٨. لماذا لا الخيار ١ كما هو؟ لأنه يفتح أربع واجهات قبل أول دفعة، وفيه تناقض مباشر مع وعد منشور (P5)، ويبيع ميزة على خارطة الطريق.

---

## 7. Uncertainties / أوجه عدم اليقين

- Cline's ClinePass pricing page did not render in this fetch — its terms are **unverified**.
- `websearch` was unavailable, so discovery was limited to pages whose URLs were already known from internal docs and HN links. There may be 2026 models not represented here.
- HN commenters skew technical and vocal; their complaints indicate *what to avoid*, not *how many users feel it*.
- No internal data on install count, active users, BYOK adoption, or hosted-token cost exists in this repo. The $79/$99 anchors are judgment, not a price-optimization result.
- Payment-gateway terms (Paddle 5% + 50¢) are from the existing internal study and were **not re-fetched today** — verify before committing.
- Tax, refund, chargeback, and consumer-law obligations for an offline key sold globally were not researched here.
- Regulatory changes (e.g. providers blocking third-party use of subscription tokens, as Anthropic did in Jan 2026) show that BYOK itself depends on provider terms staying permissive.

> عدم اليقين: صفحة ClinePass لم تُعرض، و`websearch` غير متاح، وتعليقات HN غير ممثلة إحصائياً، ولا توجد بيانات داخلية، وشروط بوابة الدفع لم تُتحقّق اليوم، والالتزامات الضريبية/القانونية لمفتاح offline خارج هذا البحث. BYOK نفسه يعتمد على بقاء شروط المزوّدين مسمحة.

---

## 8. Sources / المصادر

All fetched **2026-11-21** unless noted.

1. Cursor pricing — https://www.cursor.com/pricing
2. Anthropic Claude pricing — https://www.anthropic.com/pricing
3. GitHub Copilot plans — https://github.com/features/copilot/plans
4. OpenRouter pricing + FAQ — https://openrouter.ai/pricing
5. Zed pricing + FAQ — https://zed.dev/pricing
6. Aider (BYOK, open source) — https://aider.chat/
7. Cline / ClinePass (pricing not rendered) — https://cline.bot/cline-pass
8. Devin/Windsurf pricing (Cognition) — https://windsurf.com/pricing
9. HN search API, "cursor pricing" comments — https://hn.algolia.com/api/v1/search?query=cursor%20pricing&tags=comment
10. HN search API, "bring your own key API coding" comments — https://hn.algolia.com/api/v1/search?query=bring%20your%20own%20key%20API%20coding&tags=comment
11. HN search API, "usage limits unlimited AI subscription" comments — https://hn.algolia.com/api/v1/search?query=usage%20limits%20unlimited%20AI%20subscription&tags=comment
12. Cursor pricing backlash write-up (2025-07-05) — https://generativeai.pub/cursors-pricing-change-sparks-outrage-ceo-apologizes-b9d046295a3c
13. Internal: `website/docs/MONETIZATION.md`, `website/app/pricing/page.tsx`, `website/app/layout.tsx`, `website/app/page.tsx`, `electron/services/billingService.ts`

---

**End of report. No code was changed. / نهاية التقرير. لم يُغيّر أي كود.**
