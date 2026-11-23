# MONETIZATION TRUTH — v11.33 (M1–M4 audit)
**Date:** 2026-11-21 · **Guard:** `tests/v1133-monetization.test.mjs` · **Mode:** diagnosis + test only (no app source changed by this guard)

---

## VERDICT (English) — blunt

**There is an honest UI and real local entitlement plumbing, but there is NO live, enforceable revenue path.** No money can be collected today (checkout is deliberately disabled), and the "paid" Owner License is an **honor system**: its signing secret is PUBLIC and shipped in the repo, so anyone can mint a valid perpetual `KDX-OWNER-…` key with the bundled CLI and activate it for free. The guard proved this by actually doing it (`KDX-OWNER-00000-21VT-074` validated as `owner`). This is **not a deceptive mock** — the site openly says nothing is charged and the keys are shareable — but calling it a monetization *path* would be false. It is a **prototype of checkout + a self-issued key**, not a store.

All six requested behaviors (G1–G6) are implemented and pass. The remaining problems are **enforceability, handoff, and dormant subscription leftovers**, listed below.

## الحكم (العربية) — بصراحة

**توجد واجهة صادقة ومنطق ترخيص محلي حقيقي، لكن لا يوجد مسار دخل فعلي ولا قابل للتنفيذ اليوم.** لا يمكن تحصيل أي مبلغ الآن (الدفع معطّل عمداً)، ورخصة «المالك» المدفوعة تعتمد على شرف المستخدم فقط: سر التوقيع **علني** وموجود داخل المستودع، لذلك يستطيع أي شخص إصدار مفتاح `KDX-OWNER-…` دائم صالح عبر الأداة المرفقة وتفعيله مجاناً. أثبت الحارس ذلك فعلياً (`KDX-OWNER-00000-21VT-074` تم التحقق منه كـ owner). هذا **ليس تظاهراً خادعاً** — الموقع يقول بوضوح إنه لا يُحصَّل شيء وأن المفاتيح قابلة للمشاركة — لكن تسميته «مسار تحقيق دخل» ادعاء كاذب. إنه **نموذج أولي لصفحة دفع + مفتاح يُصدره المستخدم لنفسه**، وليس متجراً.

السلوكات الستة المطلوبة (G1–G6) منفّذة وتنجح. المشاكل المتبقية هي **قابلية التنفيذ، وتسليم المفتاح، وبقايا نموذج الاشتراك**، مفصّلة أدناه.

---

## What the guard verified with REAL behavior (passing)

| # | Claim | Evidence (file:line) | Result |
|---|-------|----------------------|--------|
| 1 | Primary Sign in opens `<site>/auth#pair=<6code>&mode=signin` via `openExternal`; no fake account in the card | `src/components/settings/AccountAuthCard.tsx:501-518` (primary buttons), `:103-116` (`api.openExternal(res.url)`); `electron/services/authService.ts:438-449` (URL built with real `/auth`); `electron/ipc.ts:743-749` (`shell.openExternal`) | PASS (G1a, G1b) |
| 2 | Deep-link `plan=pro` without a valid license → account stays `free` | `electron/services/authService.ts:197-204` (`honestPlan`), `:484-515` (only a verified `lic` promotes); tested with no key, a format-only website entitlement, and an expired license | PASS (G2) |
| 3 | Signed OWNER key → pro entitlement, perpetual, no fake expiry | `electron/services/licenseService.ts:89-104` (label/marker), `:155-196` (decode/mapping), `:378-441` (`redeemLicense` persists owner marker, no `expiresAt`); `billingService.ts:96-125` (no `renewsAt`) | PASS (G3a, G3b) |
| 4 | Pricing: no credit packs, no monthly plan, checkout gated + env URL, BYOK-free copy | `website/app/pricing/page.tsx:31-68` (exactly 2 tiers), `:110-123`, `:202`, `:301-319`; `website/lib/site.ts:34,38` | PASS (G4a, G4b) |
| 5 | Website auth: sign-up + license field + pairing, callback carries email/name/plan | `website/app/auth/page.tsx:315-334` (redemption field), `:257,305` (callback); `website/lib/auth.ts:305-313` | PASS (G5a, G5b) |
| 6 | No "lifetime forever", no credit resale, no "no proxy" contradiction | `website/app/layout.tsx:59` (proxy claim) is consistent: providers call endpoints directly; claim-audit ran with comment/negation filtering | PASS (G6) |

---

## GAPS — report to parent (all with file:line)

### GAP-1 · CRITICAL — The paid entitlement is forgeable with a PUBLIC secret
- `scripts/license-gen.cjs:14-22` — explicitly documents that the default secret is **public / not a credential**.
- `scripts/license-gen.cjs:38` — `LEGACY_SECRET = 'KODex-license-v1'`.
- `scripts/license-gen.cjs:66-69,114-115,156` — mints `--plan owner --days 0` with that secret.
- `scripts/license-gen.cjs:24-30` — admits no activation server, no device binding, no revocation ("treat keys like cash").
- `electron/services/licenseService.ts:40` — same public `LICENSE_SECRET`; `:153` accepts it as a fallback forever; `:427-441` `redeemLicense()` grants a real entitlement from it.
- **Real-behavior proof:** `tests/v1133-monetization.test.mjs` G7 ran the CLI and `validateKey()` accepted the minted OWNER key (`ok=true, owner=true`).
- **Impact:** Anyone with the repo can self-issue the "paid" license. Charging $79/$99 for this key is not enforceable. No webhook, no server-side mint, no revocation.
- **Fix:** mint on a server with a private HMAC secret (only the verifier ships), or stop presenting the key as a paid entitlement and disclose its shareable/public nature on the pricing page.

### GAP-2 · FIXED (was HIGH) — Website "license redemption" now hands the key to the app
- `website/lib/auth.ts:311-327` — `callbackUrl()` gained an optional `lic?: string` and now appends `&lic=<encoded key>` when a key is present (`:324`); with no key it sends only `plan=free` and omits `lic`.
- `website/app/auth/page.tsx:260-267,317` — both the done-recap effect and submit pass the stored entitlement key (`entitlement?.key`, loaded via `loadEntitlement()`) into `callbackUrl`; `:261,317` keep `plan = entitlement?.plan ?? 'free'`.
- `electron/services/authService.ts:492-515` — unchanged: the app already supports `payload.lic` and verifies it with `validateKey()`, so the delivered key now promotes the account and the `honestPlan` clamp is satisfied by the real signature instead of leaving `plan=pro` → `free`.
- **Was:** a customer who pasted a valid Owner License on the website got a **free** account in the app and had to paste the key a second time. **Now:** the format-checked key travels in the deep link and the app performs the real check on arrival.
- **Verification:** `website/tests-v1133-auth-lic.mjs` (8 PASS / 0 FAIL) — behaviorally executes the real `callbackUrl`/`loadEntitlement` to assert `lic=` is present when a key is stored and absent otherwise (plus URL-encoding and the `free` fallback); `npx tsc --noEmit` and `npm run build` both green.

### GAP-3 · HIGH — No live revenue path (honest, but still $0)
- `website/lib/site.ts:34,38` — `FREE_SEASON` defaults true; `checkoutUrl` defaults `''` (env-configurable).
- `website/app/pricing/page.tsx:202,301-304` — owner button is `disabled` ("Coming soon — free season").
- `electron/services/billingService.ts:35` — `FREE_SEASON = true` in the app.
- `scripts/license-gen.cjs:114-115` — key issuance is a **manual CLI**, not a webhook.
- `website/docs/MONETIZATION.md:20` — admits no payment processor is connected.
- **Impact:** No gateway, no webhook, no automated key delivery. Nothing can be bought; "checkout URL env-configurable" is plumbing only.

### GAP-4 · MEDIUM — Hard-coded fake account still ships in the auth gate
- `src/components/AuthScreen.tsx:202-206` — `continueLocal()` synthesizes `{ id: 'local', email: '', name: 'Local user' / 'مستخدم محلي', plan: 'free' }`.
- The **account card** is clean (`src/components/settings/AccountAuthCard.tsx:501-518`), so requirement 1 passes, but the full-screen gate still mints a fake `AccountInfo`.
- **Fix:** represent a local-only session without fabricating an account identity, or label it explicitly as a non-account session.

### GAP-5 · MEDIUM — Dormant monthly-subscription model contradicts the website
- `electron/services/billingService.ts:50` — `PRO_PRICE_USD = 20` (monthly-style catalog price).
- `electron/services/billingService.ts:77,102` — `priceUsd` and coupon `WELCOME50` "50% off the **first month**".
- `electron/services/billingService.ts:132` — `renewsAt` in `SubscriptionState`.
- `electron/services/billingService.ts:224,242` — `stripePaymentLink` + `openCheckout()`.
- **Impact:** The website says "no monthly subscription", but the app still ships the monthly/renewal/payment-link model (dormant while `FREE_SEASON`). A future flip could silently reintroduce a subscription the site disclaims.

### GAP-6 · LOW — `FREE_SEASON` has two sources of truth
- `website/lib/site.ts:34` — env-driven (`NEXT_PUBLIC_FREE_SEASON`), default true.
- `electron/services/billingService.ts:35` — hard-coded `true`; consumed by `licenseService.ts:211` (`effectivePlan`).
- `website/app/pricing/page.tsx:13` reads the site gate, not the app gate.
- **Impact:** Flipping only the website env makes the pricing page say "checkout is live" while the app still reports free season and marks Pro `available: false` (`billingService.ts:208`). Document the two-step flip or share one flag.

### GAP-7 · ADVISORY — Unqualified "Unlimited" claims (file:line)
- `website/app/pricing/page.tsx:41` — "Unlimited runs on your own API keys".
- `website/app/pricing/page.tsx:58` — "Unlimited MCP · device tools · parallel calls".
- `website/app/pricing/page.tsx:91` — comparison cell "Unlimited".
- `electron/services/billingService.ts:59,81` — plan feature strings "Unlimited agent runs…" / "Unlimited MCP servers".
- `electron/services/billingService.ts:197` — comment "UNLIMITED" (internal, not customer-facing).
- **Recommendation:** scope the wording to "no artificial cap on local work with your own keys", or substantiate. They are not currently false, but they are absolute claims.

### Verified NOT a gap
- `website/app/layout.tsx:59` claims BYOK "does not resell inference or sit behind a proxy". No inference-proxy endpoint exists; `electron/agent/providers.ts` issues direct `fetch()` calls. "no proxy" is consistent (proxy mentions there are only network-error hints).

---

## Commands run (all green)

```
node --test --test-force-exit tests/v1133-monetization.test.mjs
  → tests 11 / pass 11 / fail 0   (G1a,G1b,G2,G3a,G3b,G4a,G4b,G5a,G5b,G7,G6)
  → advisory diagnostics: forgeable OWNER key; website lic handoff gap; "unlimited" hits
npm run build          (website)  → next build OK, 8 static routes, 0 errors
npm run typecheck      (app)      → tsc --noEmit + tsconfig.node.json OK
npm run typecheck      (website)  → tsc --noEmit OK
```

## Bottom line for the parent
The **UX honesty requirements are met** and the guard is green. Do **not** describe this as "real monetization" externally until GAP-1 (public minting secret / no enforcement), GAP-2 (key never reaches the app from the website), and GAP-3 (no gateway/webhook) are closed. Until then the accurate sentence is: *"BYOK is free; a one-time Owner License is designed and shown, but checkout and enforceable licensing are not live."*
