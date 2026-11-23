# SADEEM — FINAL MONETIZATION DECISION
# القرار النهائي لتحقيق الدخل — سديم

**Date / التاريخ:** 2026-11-21 · **Version / الإصدار:** v11.12.0 context
**Status / الحالة:** **DECISION + IMPLEMENTATION BRIEF — DIAGNOSIS ONLY. No source file was edited.**
**قرار + موجز تنفيذي — تشخيص فقط. لم يُعدّل أي ملف مصدر.**

**Supersedes / يُلغي ما يلي:** the R1 recommendation in `docs/MONETIZATION-RESEARCH.md` (Option 3: license + at-cost wallet) and the price anchors in `website/docs/MONETIZATION.md` ($99 → $149, credits, team SKU). This document is the single source of truth for the founder's chosen release. Wherever those two docs describe credit packs or a team SKU, **this document wins**.

> **Brutal honesty up front / صراحة مرّة من البداية:** This repo has **no payment gateway key, no webhook, no backend, no entitlement store, and no credit ledger**. The website currently keeps "accounts" in `localStorage`, and the deep-link carries a self-asserted `plan` string that the app deliberately ignores unless a real signed license exists locally. Everything below is a *design that can be built*, not a description of something that works today. No button in this release may pretend to take money.
>
> **بصراحة:** لا توجد بوابة دفع، ولا webhook، ولا خادم، ولا مخزن صلاحيات، ولا دفتر رصيد في هذا المستودع. الموقع يحفظ «الحسابات» حالياً في `localStorage`، والرابط العميق يحمل `plan` يُصرّح به المتصفح ويتجاهله التطبيق عمداً ما لم يوجد مفتاح موقّع حقيقي على الجهاز. كل ما يلي **تصميم قابل للبناء**، وليس وصفاً لشيء يعمل اليوم. لا يجوز لأي زر في هذه النسخة أن يتظاهر بأخذ المال.

---

## 0. One-page decision / القرار في صفحة واحدة

| Item / العنصر | Decision / القرار |
|---|---|
| **Model / النموذج** | **Option 2 — "One license, nothing else."** ONE optional one-time **Owner License**. BYOK stays free forever. **No credits, no team SKU, no subscription.** الخيار ٢ — رخصة واحدة فقط. |
| **Price / السعر** | **$79 founding cohort / $99 after**, one-time, USD. This supersedes the $99 → $149 anchors in the older docs. $79 مؤسِّس / $99 بعدها، مرة واحدة. |
| **Scope / النطاق** | Perpetual key for the **whole v11 series including every v11.x update**; next major at **50% off**, not free. See §1.3 for the honest "Lifetime" definition. |
| **Account / الحساب** | **Website is the source of truth** for email + name + license entitlement. The app keeps a local mirror and a device session. الموقع هو المرجع للحساب والصلاحية. |
| **Sign-in / الدخول** | **Existing pairing deep-link, unchanged**: app opens `<site>/auth#pair=<code>&mode=signin`; website returns `sadeem://auth/callback?pair=…&email=…&name=…&plan=…`. See §2.3. |
| **Payment / الدفع** | **No key exists.** Checkout is a configured **Stripe Payment Link / Lemon Squeezy URL env var**; if unconfigured the button is visibly disabled. A clearly-labelled **offline signed license-key redemption** path always works. See §3. |
| **Promise conflict / التعارض** | **No hosted credits in this release → promise P5 ("does not resell inference or sit behind a proxy") has no conflict.** Explicitly confirmed in §4. لا رصيد مستضاف في هذه النسخة → لا تعارض. |
| **Gate / البوابة** | `FREE_SEASON` stays `true` until checkout + webhook + key minting + entitlement store are live **and tested**. See §5 (M5). |

---

## 1. The chosen model & the price / النموذج المختار والسعر

### 1.1 What we sell / ما نبيعه

**EN.** A single SKU: the **Owner License**. Pay once, get a signed offline key that unlocks every capability of the local agent for the whole v11 series. The user keeps their own provider keys (BYOK) and their provider bills them directly — SADEEM never touches inference. There is exactly **one checkout, one webhook, one key type.** This is structurally the most honest fit for a local-first desktop tool and the simplest to explain in Arabic and English.

**AR.** منتج واحد: **رخصة المالك**. يدفع المستخدم مرة واحدة ويحصل على مفتاح موقّع يعمل دون اتصال، يفتح كل قدرات الوكيل المحلي لسلسلة v11 كاملة. المستخدم يحتفظ بمفاتيح مزوّديه (BYOK) والمزوّد يفاتره مباشرة — سديم لا يمرّر استدلالاً ولا يبيعه. **checkout واحد، webhook واحد، نوع مفتاح واحد.** هذا هو الأنسب بنيوياً لأداة سطح مكتب محلية والأسهل شرحاً بالعربية والإنجليزية.

### 1.2 Concrete price / السعر المحدد

| Tier / الشريحة | Price / السعر | Type / النوع | Notes / ملاحظات |
|---|---|---|---|
| BYOK Free | **$0** | Free forever / مجاناً دائماً | Acquisition engine. Unlimited local features, all 12 providers, keys stay on device. Never metered, never capped, never taxed (promise P4). محرك الاكتساب — لا قياس ولا سقف. |
| **Owner License (Founding)** ⭐ | **$79** | One-time / مرة واحدة | First cohort / banner window. Perpetual v11 key + all v11.x + 50% next-major. الموجة المؤسِّسة. |
| **Owner License (Standard)** | **$99** | One-time / مرة واحدة | Price after the founding window. السعر بعد الموجة المؤسِّسة. |

- No recurring charge. No card stored. No expiry. No auto-renew. No cancellation screen. **لا تجديد، لا بطاقة محفوظة، لا انتهاء، لا شاشة إلغاء.**
- The founding price is a **time-boxed launch discount**, not a permanent "forever cheaper" tier. State the end date on the pricing page when the window opens. سعر المؤسِّس خصم إطلاق محدود زمنياً، وليس شريحة دائمة أرخص.

### 1.3 Honest "Lifetime" definition — keep verbatim / تعريف «الدائمة» — يُبقى حرفياً

> **EN.** "Lifetime" means a **perpetual, non-expiring signed key for the whole v11 series, including every v11.x update**. The next major version is offered to Owner License holders at **50% off**, not promised for free. This is an honest, sustainable definition — it does not promise support for versions we have not built.
>
> **AR.** «الدائمة» تعني **مفتاحاً موقّعاً دائماً بلا تاريخ انتهاء لسلسلة v11 كاملة، مع كل تحديثات v11.x**. الإصدار الرئيسي القادم يُعرض لحاملي رخصة المالك **بخصم 50%** لا مجاناً. هذا تعريف صادق ومستدام، ولا يعد بدعم إصدارات لم نبنِها بعد.

Mechanically this already works in `electron/services/licenseService.ts`: `buildKeyV2('pro', 0)` encodes `expiryDays = 0` → no `expiresAt` written → `effectivePlan()` treats it as perpetual (`licenseService.ts:167-184`). The 50% next-major discount is a **business promise recorded on the website**, not something encoded in the key — do not let marketing imply otherwise. آلياً هذا يعمل اليوم في `licenseService.ts`؛ أمّا خصم 50% فهو **وعد تجاري يُدوَّن في الموقع** وليس مشفّراً في المفتاح.

### 1.4 What we explicitly do NOT sell in this release / ما لا نبيعه في هذه النسخة

- **No hosted credits / no credit packs.** There is no router, no ledger, no token accounting, no deferred-revenue liability.
- **No proxy, no inference resale.** We do not sit between the user and the provider.
- **No team SKU.** "Shared playbooks" is on the roadmap, not shipped; selling a seat for it would repeat the credibility mistake of "unlimited" in a new form. Defer until the feature exists.
- **No monthly fee** for anything currently open (promises P1/P2).
- **No GitHub Sponsors / Ko-fi paywalled benefits** in v1. If added later, they must grant **no** paid features (Zed's model).

### 1.5 Price validation — live 2026 comparables / التحقق من السعر — مراجع 2026 حية

Fetched with `webfetch` on **2026-11-21** (the `websearch` integration returned HTTP 402 in this environment, as in R1; direct page fetches were used):

| Product (one-time option) | Observed 2026 price / السعر المرصود | Update terms / شروط التحديث | Source / المصدر |
|---|---|---|---|
| **Sublime Text** (personal, coding tool) | **$99 USD** one-time | 3 years of updates, then upgrade required; one key for all devices | https://www.sublimetext.com/buy |
| **TablePlus** (Basic, 1 seat) | **$99/license** one-time, no auto-renew | 1 year of updates, then "keep using without restrictions"; 7-day refund | https://tableplus.com/pricing |
| **Sketch** (Mac-only, offline license) | **$120/seat** one-time | Includes 1 year of updates; subscriptions $12–44/mo alongside | https://www.sketch.com/pricing/ |

**Verdict / الحكم:** $99 regular sits exactly at the Sublime Text / TablePlus market anchor and below Sketch's $120. A $79 founding price is a credible launch discount, not a desperate underprice. This is a **price-sanity check, not a conversion forecast** — we have no internal install/activation data. $99 عند مستوى السوق تماماً، و$79 خصم إطلاق معقول. هذه فحص سلامة للسعر لا توقع مبيعات.

> **Note on the old $149 anchor:** it is above every one-time comparable observed today. Dropping to $99 is also a *trust* correction — a one-time local license priced like a subscription-year invites "why so much for a tool I host myself?" complaints.
>
> **ملاحظة على رقم $149 القديم:** أعلى من كل مرجع مرة واحدة رصدناه اليوم. النزول إلى $99 هو أيضاً تصحيح ثقة.

---

## 2. Account architecture / معمارية الحساب

### 2.1 Reality today (honest baseline) / الواقع اليوم (أساس صادق)

| Component / المكوّن | What exists today / الموجود اليوم | Why it is not enough / لماذا لا يكفي |
|---|---|---|
| Website account store | `website/app/auth/page.tsx` → `localStorage['sadeem-web-accounts']`, fields `{email, name, createdAt, plan:'free'}`; no password, no server (`auth/page.tsx:26-69`). | `localStorage` is per-browser and erasable. It **cannot** be a source of truth for a license entitlement. It currently hardcodes `plan: 'free'` in the callback (`auth/page.tsx:81-89`). |
| App account store | `electron/services/authService.ts` → `<userData>/accounts.json` + `session.json` (0600, scrypt for local accounts, 30-day sessions). | A local mirror only. Website-origin accounts are created from the deep link with `via:'website'` and no password (`authService.ts:458-521`). |
| Deep-link | `beginWebAuth()` / `completeWebAuth()` in `authService.ts:430-521`; OS delivery in `electron/main.ts:788-842`. | Works as a pairing handshake, but `plan` is a **self-asserted string** and `honestPlan()` downgrades it to `free` unless a valid local license exists (`authService.ts:188-204, 470-476`). Correct security, but it means **entitlement must travel as a real signed key, not as `plan=pro`.** |
| License state | `licenseService.ts` — HMAC-SHA256 v2 keys, offline validation, optional remote `licenseEndpoint`. | Offline validation is ready (`validateKey`, `activate`). No server mints keys yet, and `scripts/license-gen.cjs` referenced in the header comment **does not exist in this repo**. |

### 2.2 Target / الهدف

**EN.** The **website becomes the source of truth** for three fields: `email`, `name`, and `license entitlement` (does this account own an Owner License? which key? purchased when?). The app keeps a **local mirror** for offline use and a 30-day device session. The pairing deep-link remains the transport — we do **not** build a new login protocol. The entitlement crosses the boundary as a **signed license key** (see §2.4), because a plain `plan` string is forgeable and the app correctly refuses to trust it.

**AR.** يصبح **الموقع هو المرجع** لثلاثة حقول: `email` و`name` وصلاحية الرخصة. التطبيق يحتفظ **بنسخة محلية** للعمل دون اتصال وبجلسة جهاز 30 يوماً. يبقى رابط الاقتران هو وسيلة النقل — **لا نبني بروتوكول دخول جديد**. الصلاحية تعبر كـ**مفتاح رخصة موقّع** (§2.4)، لأن سلسلة `plan` وحدها قابلة للتزوير والتطبيق يرفض تصديقها بحق.

```
                 SOURCE OF TRUTH                         LOCAL MIRROR
   ┌──────────────────────────────────┐        ┌──────────────────────────────┐
   │ WEBSITE (server)                 │        │ DESKTOP APP                  │
   │  accounts: email, name,          │  pair  │  accounts.json (via:website)  │
   │            entitlement, key      │ ─────► │  session.json (30 days)      │
   │  /auth#pair=<code>&mode=signin   │ deep   │  license (signed, offline)   │
   │  sadeem://auth/callback?…&lic=…  │ link   │  effectivePlan() / checkGate │
   └──────────────────────────────────┘        └──────────────────────────────┘
```

### 2.3 Exact "Sign in" flow — app opens the website and returns / مسار تسجيل الدخول بالضبط

This documents the **existing** mechanism (no new protocol). Step numbers map to code locations.

1. **User clicks "Sign in" in the app.** The renderer calls IPC `kdx:auth:web-begin` with `mode: 'signin'`.
2. **`beginWebAuth('signin')`** — `electron/services/authService.ts:436-447` — mints a 6-character code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, stores it in `pendingPairs` with a **15-minute TTL**, one-use only, and returns:
   ```
   url = `${websiteBaseUrl()}/auth.html#pair=<PAIR>&mode=signin`
   ```
   Base is `SADEEM_SITE_URL` env if set, else `https://sadeem.app` (`authService.ts:413-419`).
   > ⚠️ **Bug to fix in M3:** the website's real Next.js route is **`/auth`** (`website/lib/site.ts:15`, `website/app/auth/page.tsx`), **not `/auth.html`**. Either change the app to use `SITE.authPath`/`/auth`, or add a `/auth.html` rewrite. Do not ship sign-in pointing at a 404.
   > **خطأ يُصلح في M3:** مسار الموقع الحقيقي هو `/auth` لا `/auth.html`.
3. **App opens that URL in the OS browser** (`shell.openExternal`). The website's `readPairHash()` parses the hash: `pair` (6 chars A–Z0–9) and `mode` (`signin` else `signup`) (`auth/page.tsx:31-36`).
4. **Website shows the form.** In `signin` mode it prefills the last saved email/name (`auth/page.tsx:272-278`). Target design (M2): it looks up the account **on the server** by email and shows the real entitlement ("Owner License active" / "No license") instead of the hardcoded `'free'`.
5. **User submits name + email.** Website persists/updates the account in the server store (no password — the pair code binds the browser tab to this device).
6. **Website builds the return callback** via `callbackUrl()` (`auth/page.tsx:80-89`) using `SITE.deepLinkCallback` = **`sadeem://auth/callback`** (`website/lib/site.ts:11-12`):
   ```
   sadeem://auth/callback?pair=<PAIR>&email=<urlencoded>&name=<urlencoded>&plan=<free|pro>[&lic=<SIGNED_KEY>]
   ```
   The browser only opens external apps after a user click, so the page renders an **"Open SADEEM"** link plus a copy-link fallback (`auth/page.tsx:513-534`).
7. **OS delivers the URL to the app.** Windows/Linux: `app.on('second-instance', argv)` → `scanArgvForAuthLink()`. macOS: `app.on('open-url')` → `handleAuthDeepLink()` (`electron/main.ts:830-842`). Regex `^sadeem:\/\/auth\/callback\?(.+)$` parses `pair, email, name, plan` (`main.ts:788-799`).
8. **`completeWebAuth(payload)`** — `authService.ts:458-521` — validates the pair against `pendingPairs` (one-use, 15 min), validates the email, computes `honestPlan(requestedPlan)`, finds or creates the website-origin account, writes a fresh session, consumes the guest pass, and emits `kdx:auth:changed` → the renderer shows the signed-in state. If `lic` is present and valid, step 9 runs.
9. **Entitlement lands:** the signed key is activated through `licenseService.activate()` so the paid plan is backed by a real local license (see §2.4).

**Failure behaviour is already honest:** missing `pair` or `email` is rejected and reported (`main.ts:804-811`); an unknown/expired pair yields `error:'no_account'`; a paid `plan` without a valid key resolves to `free`. Preserve all three.

### 2.4 Entitlement must be a signed key, not `plan=pro` / الصلاحية يجب أن تكون مفتاحاً موقّعاً

**EN.** `honestPlan()` (`authService.ts:196-204`) is deliberate: a paid `plan` in the callback is downgraded to `free` unless `getLicense()` returns a valid paid license. Therefore the website must convey entitlement in one of two ways, both offline-verifiable:

- **(A) Automatic (preferred):** add an optional `lic` parameter to the callback. After `completeWebAuth` consumes the pair, if `lic` is present, call `licenseService.validateKey(lic)`; on `ok` call `licenseService.activate(lic)` before/after creating the session. The key format already supported is `KDX-PRO-00000-SIG1-SIG2` (perpetual) — `decodeKeyV2` verifies the HMAC (§3.3).
- **(B) Manual (always available):** the website's account page displays the purchased key clearly labelled "Your SADEEM license key — offline redemption"; the user pastes it in the app's **Settings → License / Billing** activation field, which already calls `activate()` → `validateKey()`. This path requires zero network at redemption time.

The website's `plan` value should then reflect **actual entitlement** (server-side), not a marketing guess — but the app still treats it as advisory and trusts only the key. This preserves promise P8/P11 honesty: no fake "Pro" claim without a real license.

**AR.** `honestPlan()` يتعمّد تخفيض `plan` المدفوع إلى `free` إن لم يوجد مفتاح صالح محلياً. لذلك يجب أن تنقل الموقع الصلاحية بإحدى طريقتين قابلتين للتحقق دون اتصال: (أ) تلقائياً عبر معامل `lic` جديد يُفعّل عبر `licenseService`، أو (ب) يدوياً بعرض المفتاح في صفحة الحساب ولصقه في حقل التفعيل بالتطبيق. قيمة `plan` في الموقع تعكس الصلاحية الحقيقية، لكن التطبيق لا يثق إلا بالمفتاح الموقّع.

---

## 3. Payment reality & checkout design / واقع الدفع وتصميم الشراء

### 3.1 The hard constraint / القيد الصلب

**EN.** There is **no payment gateway key, no Stripe secret, no Paddle account, no Lemon Squeezy store, and no webhook** anywhere in this repo. `billingService.ts` has `setPaymentLink()` / `openCheckout()` and `shared/types.ts:924-926` has `billing.stripePaymentLink` / `billing.licenseEndpoint` — but they are **empty configuration fields, not a payment system**. The website pricing page currently ships placeholder buttons (`data-checkout` + `/download` + `mailto`) and says so explicitly (`pricing/page.tsx:201, 285`).

**Do not fake a working payment.** No checkout button may open a fake success screen, no webhook may be simulated, no key may be minted without a verified purchase. During the free season the honest state is: *"Payments are not enabled yet — the app is free."*

**AR.** لا توجد بوابة دفع ولا مفتاح Stripe ولا حساب Paddle ولا متجر Lemon Squeezy ولا webhook في هذا المستودع. الحقول الموجودة في `billingService.ts` و`shared/types.ts` **حقول إعداد فارغة ليست نظام دفع**. لا نُزيّف دفعة: لا شاشة نجاح وهمية، ولا webhook محاكى، ولا مفتاح يُصدر دون شراء موثّق. الحالة الصادقة أثناء الموسم العام: «الدفع غير مفعّل — التطبيق مجاني».

### 3.2 Configured hosted checkout (no secret in repo) / شراء مستضاف بالإعداد

A hosted **Payment Link** (Stripe) or **Lemon Squeezy checkout URL** is a public URL — it does **not** require a secret in this repo. Design so that one env var turns the button on:

| Where / المكان | Variable / المتغير | Purpose / الغرض |
|---|---|---|
| Website (`website/lib/site.ts`, `.env.example`) | `NEXT_PUBLIC_CHECKOUT_URL` | The hosted Stripe Payment Link / Lemon Squeezy URL for the single Owner License product. |
| Website | `NEXT_PUBLIC_CHECKOUT_PROVIDER` | Display label only: `stripe` / `lemonsqueezy`. |
| App settings (existing) | `billing.stripePaymentLink` (`shared/types.ts:925`) | Optional in-app "Buy" hand-off — `billingService.openCheckout()` already calls `shell.openExternal`. |
| Website (server-only, later) | `LICENSE_ISSUER_SECRET` | Secret used by the future webhook to mint keys. **Never expose to the client.** |

**Button states (all three must be implemented): / حالات الزر (كلها مطلوبة):**

1. **Unconfigured** (default today): button **disabled**, label "Checkout not enabled yet — the app is free during the public season" / «الدفع غير مفعّل — التطبيق مجاني خلال الموسم العام». No link, no `mailto` pretending to sell.
2. **Configured, free season on**: button enabled with label "Buy Owner License — $79 founding" and opens `NEXT_PUBLIC_CHECKOUT_URL` in a new tab. Pricing page copy still says nothing is charged until the season flips — keep that in sync (promise P3).
3. **Configured, season off**: full checkout + webhook + minting live; pricing page copy updated in the **same release**.

**The env var alone is not a store.** A real product must be created in Stripe/Lemon Squeezy with a one-time $79/$99 price, and the webhook must be connected, before step 3. Until then step 2 is a hand-off to a hosted page and the key is delivered by the **manual offline path in §3.3**.

### 3.3 Offline license-key redemption (works with no gateway) / استبدال مفتاح الترخيص دون اتصال

This is the path that works **today** and must keep working even if no gateway is ever configured. `licenseService.ts` already implements verification and activation:

- **Key format v2:** `KDX-PLAN-EXPIP-SIG1-SIG2` — `PLAN ∈ {PRO, TEAM}`, `EXPIP` = 5 Crockford-base32 chars of expiry epoch-**days** (`00000` = perpetual), `SIG` = 7 chars = first 35 bits of `HMAC-SHA256(secret, \`${PLAN}|${days}|\`)` (`licenseService.ts:7-14, 109-134`).
- **Mint (server side, new script `scripts/license-gen.cjs` — it does not exist yet):** use `buildKeyV2('pro', 0)` logic. To verify on **any** device, sign with the legacy constant `LICENSE_SECRET = 'KODex-license-v1'` (`licenseService.ts:31`), because `decodeKeyV2()` checks the runtime per-device secret first and the legacy constant second (`licenseService.ts:149-155`). **Do not** try to mint with the per-device runtime secret — it lives only at `<userData>/license.secret` (0600) and is unknown to the server.
- **Verify:** `validateKey(key)` returns a `KeyVerdict` (`ok`, `plan`, `expiryDays`, `source`) without throwing (`licenseService.ts:229-272`).
- **Redeem:** `activate(key)` → validates (optionally via `settings.billing.licenseEndpoint` over HTTPS, best-effort) → saves a `LicenseState` with `licensedTo:'local'`, `mode:'local'`, `source:'local'|'legacy'`; a perpetual key writes **no** `expiresAt` (`licenseService.ts:274-332`).
- **Gate:** `effectivePlan()` + `refreshPlan()` + `checkGate()` pick it up immediately; during `FREE_SEASON` every gate stays open anyway (`billingService.ts:35, 159-199`).

**Delivery:** after a verified hosted purchase, the webhook (when built) emails the key and records it against the website account. Until then, the founder can mint a key with the script and send it manually — clearly labelled as a **license key redemption**, never as an automated purchase. This is honest and fully functional offline.

### 3.4 Webhook — only after a real gateway exists / Webhook — فقط بعد وجود بوابة حقيقية

Sequence for a future M4/M5 follow-up (not this release's working feature):
`Payment Link checkout → provider webhook (verify signature) → create/update website account entitlement by email → mint `KDX-PRO-00000-…` → store key + email on the website (source of truth) → email key to buyer → app receives it via `lic` or manual redeem → activate()`.

Never trust a client-supplied "I paid" flag. Never call `activate()` from an unverified request. Keep the key and the email together in the server store so a lost local key can be reissued after identity confirmation.

---

## 4. Promise conflict resolved — P5 and friends / حل تعارض الوعود

### 4.1 Explicit confirmation: NO credits in this release / تأكيد صريح: لا رصيد في هذه النسخة

The website states (P5, `website/app/layout.tsx:59`): *"SADEEM does **not resell inference or sit behind a proxy**. Keys are stored locally and sent directly to that provider."*

**With no hosted credits, there is no conflict. We are NOT selling credits in this release.** There is no router, no proxy, no token resale, no balance, no ledger, and no per-request metering. BYOK remains the only inference path, and the provider bills the user directly. Therefore P5 and P6 stay literally true and **no copy rewrite is required**. The earlier Option 3 "at-cost wallet" is **deferred indefinitely**, not quietly reintroduced.

> **الموقع يقول (P5): «سديم لا يبيع الاستدلال ولا يمرّر عبر وكيل». بما أننا لا نبيع رصيداً مستضافاً في هذه النسخة، فلا يوجد أي تعارض. لا نبيع رصيداً، ولا يوجد موجهّ، ولا وكيل، ولا قياس رموز. BYOK هو مسار الاستدلال الوحيد. لا حاجة لتعديل النص.**

### 4.2 Promise audit — status under this decision / تدقيق الوعود — الحالة بموجب هذا القرار

| # | Promise / الوعد | Status / الحالة |
|---|---|---|
| P1 | Free during public season, no subscription / مجاني خلال الموسم العام | ✅ Kept. One-time license is additive. |
| P2 | No monthly fee; BYOK opens every feature | ✅ Kept. No recurring plan. |
| P3 | Publish any real offer on the pricing page **before** it is available | ✅ Kept. Copy changes ship in the **same release** as checkout (M5). |
| P4 | BYOK free + unlimited by design; keys stay on device; provider bills directly | ✅ Kept verbatim. Never metered, capped, or taxed. |
| P5 | Does not resell inference or sit behind a proxy | ✅ **No conflict — no credits this release** (§4.1). |
| P6 | Keys stored locally, sent directly to provider | ✅ Kept. No hosted router touches keys. |
| P7 | No telemetry | ✅ Kept. No usage metering introduced. |
| P8 | Nothing charged today; prices proposed; placeholder buttons | ✅ Kept until checkout+webhook+mint+store are live and tested. |
| P9 | Credit mechanics (1 credit = $0.10 etc.) | ⚠️ **Retired in this release.** Remove/disable credit-pack copy from `pricing/page.tsx` so we never describe a product we don't sell. |
| P10 | Lifetime = perpetual v11 + all v11.x + 50% next major | ✅ Kept verbatim; extend "Founder" → "Owner License" wording without changing the definition. |
| P11 | `FREE_SEASON = true` until full chain complete | ✅ Kept. Flip conditions in §5 M5. |

**Net rule unchanged / القاعدة ثابتة:** *a model may add a way to pay; it may not take away a way that was free.* The free local tool + BYOK is the acquisition engine and the trust anchor. يجوز إضافة طريقة دفع، ولا يجوز سحب ما كان مجانياً.

---

## 5. Sequenced implementation checklist for M2–M5 / قائمة التنفيذ المرحلية

Each milestone lists **exact files**. No source file is edited by this diagnosis doc. Agents must preserve the bilingual `tx()` copy style, `npx tsc --noEmit`, and `npm run build`.

### M2 — Website becomes the source of truth for accounts + entitlement
**Goal:** replace browser-only `localStorage` with a server-held record of `email`, `name`, and license entitlement.

| File / الملف | Change / التغيير |
|---|---|
| `website/app/auth/page.tsx` | Replace `loadAccounts()/saveAccount()/forgetAccount()` (localStorage, lines 50-78) with `fetch` to the new API. Show real entitlement in `signin` mode instead of hardcoded `plan:'free'` (line 86). Keep `readPairHash`, `callbackUrl`, the wax-seal UI, and the "no password" honesty note (lines 310-321) — but update its copy: the website now has an account store; it still never stores a password. |
| `website/app/api/auth/account/route.ts` *(new)* | `GET / POST`: look up / upsert account by email; return `{ email, name, plan, entitlement: { owned, key?, purchasedAt? } }`. Validate input; never return another account's key without an auth check. |
| `website/lib/accounts.ts` *(new)* | Durable server store (Vercel Postgres/KV, or a JSON file on persistent storage). Schema: `{ email (PK), name, createdAt, entitlement: { owned, licenseKey, purchasedAt } }`. |
| `website/lib/site.ts` | Add `checkoutUrl` / `checkoutProvider` config keys (from env, see §3.2); keep `deepLinkCallback` and `authPath` unchanged. |
| `website/.env.example` *(new)* | Document `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_CHECKOUT_PROVIDER`, `LICENSE_ISSUER_SECRET` (server-only, no real values committed). |
| `website/lib/i18n.tsx` / `website/app/auth/auth.css` | New bilingual strings + minimal styling for the entitlement badge. |

**Acceptance:** sign-in on the website reads/writes the server store; a second browser sees the same account; no password is collected; `tsc` + `build` pass.

### M3 — App sign-in flow + entitlement handoff
**Goal:** "Sign in" in the app opens the website and returns, with entitlement actually landing.

| File / الملف | Change / التغيير |
|---|---|
| `electron/services/authService.ts` | Fix `beginWebAuth()` URL to use `/auth` (not `/auth.html`) — lines 413-446. Extend `WebAuthPayload` with optional `lic`; after `completeWebAuth()` consumes the pair, validate + activate `lic` via `licenseService` before returning. Keep `honestPlan()` and all one-use/TTL/email-taken protections intact. |
| `electron/main.ts` | In `AUTH_URL_RE` parser (lines 788-799), also read `lic` from the query and include it in the payload; do **not** relax the `pair`/`email` rejection (lines 804-811). |
| `electron/services/licenseService.ts` | Export a small helper if needed for the `lic` path; do **not** change key format or `decodeKeyV2` security. Add a `licenseService.activate()` call path reachable from auth. |
| `src/lib/plan.ts` | Keep the renderer mirror of `effectivePlan()` in sync if plan resolution changes. |
| `shared/types.ts` | Optional: add `lic?: string` to any IPC payload type used for `kdx:auth:web-begin`/`kdx:auth:changed`. |

**Acceptance:** clicking "Sign in" opens `<site>/auth#pair=<code>&mode=signin`; submitting returns `sadeem://auth/callback?…`; the app pairs, shows the account, and a valid `lic` becomes an active paid license offline. Missing/expired pair still fails honestly.

### M4 — Checkout configuration + key minting
**Goal:** make the "Buy" hand-off configurable and provide a real offline key-minting tool — without faking payment.

| File / الملف | Change / التغيير |
|---|---|
| `website/app/pricing/page.tsx` + `pricing/pricing.css` | Replace the four-surface proposal with a **single Owner License** card ($79 → $99). Wire the CTA to `NEXT_PUBLIC_CHECKOUT_URL` with the three button states from §3.2. Remove credit-pack and team SKU copy. Keep the public-season banner truthful. |
| `scripts/license-gen.cjs` *(new)* | Mint `KDX-PRO-00000-…` using the `buildKeyV2`/`LICENSE_SECRET` scheme from `licenseService.ts`; sign with the legacy constant so keys verify on any device. Prints key + signed email for manual delivery. **Never commit the secret or a real key.** |
| `website/app/account/page.tsx` *(new)* | Signed-in account view: shows name, email, and "Owner License active / key: …" (clear offline-redemption label). Issuing a key here requires the M2 entitlement store + a verified purchase. |
| `electron/services/billingService.ts` | Keep `PRO_PRICE_USD` as the single price constant (set to 79 during founding, 99 after); keep `setPaymentLink`/`openCheckout` as the optional in-app hand-off. Leave `FREE_SEASON = true`. |
| `website/lib/site.ts` | Wire `checkoutUrl` into `SITE` so pricing and account pages share one source. |

**Acceptance:** with no env var, the buy button is disabled and says checkout is not enabled; with a configured URL it opens the hosted payment page; the mint script produces a key that `validateKey()` accepts and `activate()` installs. **No fake success screen.**

### M5 — Promise alignment, season gate, and QA
**Goal:** make the public pages and the gate agree, then (only when fully ready) flip the season.

| File / الملف | Change / التغيير |
|---|---|
| `website/app/pricing/page.tsx` | Update FAQ: Owner License $79/$99, honest Lifetime definition verbatim (P10), "no credits / no subscription / no proxy" statements. Ship this copy in the **same release** as any checkout enablement (P3). Retire P9 credit mechanics copy. |
| `website/app/layout.tsx` / `website/app/page.tsx` | Keep P1/P4/P5/P7 wording; update only the "nothing charged today" sentence when checkout is genuinely live. Do **not** touch the proxy/BYOK sentence (no credits). |
| `docs/MONETIZATION-FINAL.md` | Record the actual launch date, founding-window end date, and the chosen gateway/provider here when decided. |
| `electron/services/billingService.ts` | Flip `FREE_SEASON` to `false` **only after**: payment link configured → webhook verifying signatures → entitlement store live → key minting tested → app `lic`/manual redeem tested → copy updated. Then verify `checkGate()` and `effectivePlan()` still behave (no accidental paywall on previously-free local features). |
| QA scripts (`scripts/qa-tour-v11.sh`, `scripts/shot-page.cjs`) | Re-run bilingual UI tour on `/`, `/pricing`, `/auth`, `/account`; verify disabled/enabled button states and the deep-link round trip on Windows. |

**Acceptance:** `npx tsc --noEmit` clean, `npm run build` clean, deep-link round trip works end to end, and every price/promise string matches this decision doc.

---

## 6. Brutal honesty — open risks / المخاطر المفتوحة بصراحة

1. **Nothing is monetized today.** `FREE_SEASON = true`, no gateway, no backend. This doc is a design; step 1 of implementation is M2. كل شيء مجاني اليوم؛ هذا المستند تصميم لا تنفيذ.
2. **The website today cannot be a source of truth** — `localStorage` is per-browser and the callback hardcodes `plan:'free'`. M2 is a real backend build, not a config toggle.
3. **Self-asserted `plan` is intentionally untrusted** (`honestPlan()`). If agents only change `plan` to `pro` without shipping a signed `lic`, paid users see **no entitlement**. This is the single most likely bug.
4. **`/auth.html` vs `/auth`** — the current generated URL points to a route that does not exist in the Next.js app. Fix in M3 or sign-in is broken on day one.
5. **Offline keys are shareable.** An HMAC key with no device binding cannot prevent copying. We rely on trust, support, and the device-local runtime secret raised the bar for *minting*, not *sharing*. Accept this or add online activation later (which would break "works offline").
6. **A one-time price must fund indefinite v11.x maintenance.** That is why "Lifetime" is scoped to v11 + v11.x with a 50% next-major upgrade — never "all future versions free."
7. **No conversion/cost data exists here.** $79/$99 are sanity-checked against live comparables, not optimized from data. Revisit after real activation numbers.
8. **Tax, refunds, chargebacks, consumer law** for a globally sold offline key were not researched here. A Merchant of Record (Paddle) would handle them; Stripe Payment Links do not by default. Decide before launch.
9. **`scripts/license-gen.cjs` does not exist** despite being referenced in `licenseService.ts:14`. It must be written, with the secret kept out of source control.
10. **Payment Links are not a store.** A URL + env var enables a hand-off; only a connected webhook + entitlement store makes a purchase real. Do not let a configured URL trick anyone into thinking billing is live.

---

## 7. Sources / المصادر

Fetched 2026-11-21 unless noted. `websearch` returned HTTP 402 in this environment; live evidence came from direct `webfetch` of pricing pages (as in R1).

1. Sublime Text — one-time personal license **$99**, 3 years updates — https://www.sublimetext.com/buy
2. TablePlus — **$99/license** one-time, no auto-renew, 1 year updates — https://tableplus.com/pricing
3. Sketch — **$120** Mac-only one-time license, 1 year updates; $12–44/mo subscriptions — https://www.sketch.com/pricing/
4. Prior research (same-date snapshot): `docs/MONETIZATION-RESEARCH.md` (R1); internal decision draft `website/docs/MONETIZATION.md`.
5. Internal code (read, not edited): `electron/services/licenseService.ts`, `electron/services/authService.ts`, `electron/services/billingService.ts`, `electron/main.ts:778-852`, `shared/types.ts:924-926`, `website/app/auth/page.tsx`, `website/app/pricing/page.tsx`, `website/app/layout.tsx:15,55,59`, `website/lib/site.ts`.

---

**End of decision. No source code was changed. / نهاية القرار. لم يُغيّر أي كود مصدر.**
