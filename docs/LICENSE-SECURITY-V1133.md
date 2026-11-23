# LICENSE SECURITY — v11.33 (diagnosis + decision doc)
**Date:** 2026-11-21 · **Scope:** diagnosis + documentation only · **Trigger:** M5 finding that `scripts/license-gen.cjs` mints "paid" Owner Licenses with the public secret `KODex-license-v1`.

> This document changes no app source. It records a reality gap, lays out the honest options, and gives the founder a blunt recommendation. No new security claims are made here.

---

## 0. TL;DR / ملخص

**EN:** The "paid" Owner License is an honor system. Its signing secret is public and shipped in the repo, so anyone can mint a valid perpetual `KDX-OWNER-…` key for free. This is not a bug to patch with a better constant — it is a fundamental property of offline, client-side verification. You cannot make it secure without a server.

**AR:** رخصة «المالك» المدفوعة تعتمد على شرف المستخدم فقط. سر التوقيع علني وموجود داخل المستودع، لذلك يستطيع أي شخص إصدار مفتاح `KDX-OWNER-…` دائم مجاناً. ليس هذا خطأً يُصلح بثابت أفضل — إنها خاصية أساسية للتحقق المحلي غير المتصل. لا يمكن تأمينها دون خادم.

---

## 1. The blunt truth / الحقيقة بصراحة

### EN — read this before reading anything else

**With a client-side HMAC secret, offline license verification CANNOT be secure. There is no way around this without a server.**

The app ships the secret it uses to verify keys (`electron/services/licenseService.ts:40`, `LICENSE_SECRET = 'KODex-license-v1'`). The key generator ships the same secret (`scripts/license-gen.cjs:38`, `LEGACY_SECRET = 'KODex-license-v1'`). Anything that ships inside a downloaded app is public: anyone can read it out of the binary, the JS bundle, or the open-source repo. An HMAC signature only proves "this key was made by someone who knows the secret." If everyone knows the secret, the signature proves nothing about payment.

This is notFixable by:
- ❌ obfuscating the secret (it is literally in the public repo);
- ❌ rotating the secret (the new one ships in the next build and is public again);
- ❌ a longer key / more HMAC rounds (the attacker holds the secret, not a ciphertext);
- ❌ "hardcoding it in native code" (strings are extractable from any binary) ;
- ❌ per-device secrets (a key handed to a customer must verify on any device).

The only thing that makes a secret secret is **never shipping it to the client**. That means verification happens on a server you control. Full stop.

What the current signature *does* buy you: it stops random guessing and casual tampering. It does **not** stop redistribution. A valid key is self-contained and shareable — like cash, not like a password. The generator already says so honestly (`scripts/license-gen.cjs:24-30, 180-183`).

### AR

**مع سر HMAC موجود في التطبيق، لا يمكن أن يكون التحقق من الترخيص دون اتصال آمناً أبداً. لا يوجد حل بديل عن خادم.**

التطبيق يُرسل معه السر الذي يستخدمه للتحقق (`electron/services/licenseService.ts:40`)، وأداة إصدار المفاتيح تُرسل معها السر نفسه (`scripts/license-gen.cjs:38`). أي شيء يُشحن داخل تطبيق مُنزَّل هو علني: يستطيع أي شخص قراءته من الملف التنفيذي أو حزمة JavaScript أو المستودع المفتوح. توقيع HMAC يُثبت فقط أن «المفتاح صُنع بواسطة من يعرف السر». إذا كان الجميع يعرف السر، فالتوقيع لا يُثبت شيئاً عن الدفع.

لا يُصلح هذا بـ:
- ❌ إخفاء السر (موجود حرفياً في المستودع العام)؛
- ❌ تغيير السر (الجديد يُشحن في البناء التالي ويصبح علنياً مجدداً)؛
- ❌ مفتاح أطول أو دورات HMAC أكثر (المهاجم يملك السر، لا النص المُشفّر)؛
- ❌ «تضمينه في كود أصلي» (السلاسل قابلة للاستخراج من أي ملف تنفيذي)؛
- ❌ أسرار لكل جهاز (المفتاح المُسلَّم للعميل يجب أن يعمل على أي جهاز).

الشيء الوحيد الذي يجعل السر سرياً هو **ألا يُشحن إلى العميل أبداً**، أي أن يحدث التحقق على خادم تتحكم أنت به. هذه هي النهاية.

ما يشتريه لك التوقيع الحالي فعلاً: يمنع التخمين العشوائي والتلاعب العابر، لكنه **لا** يمنع إعادة التوزيع. المفتاح الصالح مكتفٍ بذاته وقابل للمشاركة — كالنقد، لا ككلمة المرور. أداة الإصدار تقول ذلك بصراحة (`scripts/license-gen.cjs:24-30, 180-183`).

---

## 2. Honest options, ranked / الخيارات الصادقة، مرتّبة

### Option (a) — Accept honor-system licensing (what most indie tools do)
### الخيار (أ) — قبول ترخيص الشرف (ما تفعله معظم أدوات المستقلين)

**EN:** Ship the key exactly as it is, stop calling it "enforcement," and disclose on the pricing page that keys are shareable and self-issued is trivial. Sublime Text, TablePlus, and many respected indie tools use nag screens / honor licenses that users can bypass; they still earn revenue because most people pay. For a small tool, this is normal, and it is the only option compatible with shipping *now* and staying fully offline.

**Cost:** Revenue rests on goodwill. You will lose some sales to people who would have self-minted anyway, and you cannot honestly claim "secure licensing."

**AR:** احتفظ بالمفتاح كما هو، وتوقف عن تسميته «إلزامياً»، وافصح في صفحة الأسعار بأن المفاتيح قابلة للمشاركة وأن إصدارها لنفسك سهل. Sublime Text وTablePlus والعديد من الأدوات المحترمة تستخدم تراخيص شرف يمكن تجاوزها، ومع ذلك تحقق إيرادات لأن أغلب الناس يدفعون. لأداة صغيرة هذا أمر طبيعي، وهو الخيار الوحيد المتوافق مع الإطلاق **الآن** والبقاء دون اتصال تماماً.

**الثمن:** الإيراد يعتمد على النية الحسنة. ستخسر بعض المبيعات أمام من كان سيصدر المفتاح لنفسه على أي حال، ولا يمكنك الادعاء بصدق بـ«ترخيص آمن».

### Option (b) — Server-side activation (the only real enforcement)
### الخيار (ب) — التفعيل عبر الخادم (الإلزام الحقيقي الوحيد)

**EN:** Move signing to a server. A private key never ships. The app calls the server on activation; the server verifies the payment and the key, tracks activations, and can revoke. This is the only option that makes "paid" mean something. It costs a Vercel Edge function, a small license store, a webhook, and ongoing ops — and it means the app must remain usable offline for existing users (see §3).

**Cost:** Time and infra. It delays launch. Even then, a one-time key can still be shared unless you cap activations, and capping activations frustrates legitimate users who reinstall.

**AR:** انقل التوقيع إلى خادم. المفتاح الخاص لا يُشحن أبداً. التطبيق يتصل بالخادم عند التفعيل، والخادم يتحقق من الدفع والمفتاح ويتتبع التفعيلات ويمكنه الإلغاء. هذا هو الخيار الوحيد الذي يجعل كلمة «مدفوع» ذات معنى. ثمنه دالة Vercel Edge ومخزن تراخيص صغير وwebhook وصيانة مستمرة — ويتطلب أن يبقى التطبيق صالحاً دون اتصال للمستخدمين الحاليين (انظر §3).

**الثمن:** الوقت والبنية التحتية، وتأخير الإطلاق. وحتى حينها يمكن مشاركة المفتاح لمرة واحدة إلا إذا حددت سقف التفعيلات، والسقف يُزعج المستخدمين الشرعيين عند إعادة التثبيت.

### Option (c) — Skip licensing; use sponsorship (Zed Personal model)
### الخيار (ج) — الاستغناء عن الترخيص والاعتماد على الرعاية (نموذج Zed Personal)

**EN:** Make the product free and open, ask for support through GitHub Sponsors / Buy Me a Coffee, or a "Personal free / Commercial paid" split where only companies pay. No keys, no enforcement, no honor-system awkwardness. Works well when you have an audience and goodwill; unpredictable otherwise.

**Cost:** Revenue is least predictable, and it needs an existing community. It removes the licenseUX entirely rather than fixing it.

**AR:** اجعل المنتج مجانياً ومفتوحاً، واطلب الدعم عبر GitHub Sponsors أو Buy Me a Coffee، أو قسّم إلى «شخصي مجاني / تجاري مدفوع» تدفع فيه الشركات فقط. لا مفاتيح، لا إلزام، لا حرج ترخيص الشرف. ينجح عندما يكون لديك جمهور ونية حسنة، وغير متوقع غير ذلك.

**الثمن:** الإيراد أقلها قابلية للتنبؤ ويحتاج مجتمعاً قائماً. هو يُزيل واجهة الترخيص بالكامل بدل إصلاحها.

---

## 3. Minimal architecture for Option (b) / البنية الدنيا للخيار (ب)

> Sketch only — NOT implemented now. intent: one-time purchase, private signing, offline grace.

> مخطط فقط — **غير مُنفّذ الآن**. الهدف: دفع لمرة واحدة، توقيع خاص، فترة سماح دون اتصال.

```
Customer pays (Stripe / Lemon Squeezy)
        │  signed webhook
        ▼
/api/license/issue  ── verifies webhook signature (HMAC, webhook secret)
        │              ── mints key with LICENSE_SIGNING_SECRET (server-only)
        │              ── stores record in license store (LICENSE_STORE_TOKEN)
        └──────────────► emails the key to the customer

App (on activation) ── POST /api/license/verify { key, deviceId }
        │                    ── re-verifies signature, checks store (revoked? activation count?), rate-limited
        │                    ── returns { valid, plan, expiresAt }
        └──────────────► caches last-good result locally
```

### `/api/license/issue` (Edge function)
- Receives the payment provider's webhook. **Verify the webhook signature first** (provider HMAC secret); reject anything else.
- On a completed one-time payment, mint a signed key using `LICENSE_SIGNING_SECRET` that never leaves the server.
- Write a record `{ keyId, email, plan, createdAt, active, activationCount }` to the license store.
- Send the key to the customer via a private channel (email). Never log full keys.

### `/api/license/verify` (Edge function)
- Called by the app **on activation**, not on every launch. Body: `{ key, deviceId, nonce }`.
- Re-verify the signature server-side; look up the key in the store; check revocation and activation cap. **Rate-limit per IP and per key.**
- Return a short-lived entitlement decision. The app caches the last good result with a 7-day offline grace: if the server is unreachable, a previously verified key keeps working for up to 7 days. After grace expires, fall back to the existing local verification so **the app never bricks for existing offline users**.
- Key point: **the app must keep working offline.** Existing users and the offline-first value proposition take priority over enforcement. A network failure must degrade gracefully to local verification, never to a locked app.

### Environment variables / متغيرات البيئة
| Var | Purpose |
|---|---|
| `LICENSE_SIGNING_SECRET` | Private HMAC signing key — server-only, never shipped, never committed. |
| `LICENSE_STORE_TOKEN` | Token for the license store (Vercel KV / Blob / Upstash). |
| `WEBHOOK_SECRET` | Payment provider's signing secret, to verify inbound webhooks. |

### AR — مخطط الخيار (ب)
- `/api/license/issue`: يستقبل webhook الدفع، **يتحقق من توقيعه أولاً**، ثم يُصدر مفتاحاً موقّعاً بـ `LICENSE_SIGNING_SECRET` (خاص بالخادم فقط)، ويحفظ سجلاً في المخزن، ويرسل المفتاح للعميل.
- `/api/license/verify`: يستدعيه التطبيق **عند التفعيل**، يتحقق من التوقيع والمخزن (ملغي؟ عدد التفعيلات؟)، ويحدّد المعدل لكل IP ولكل مفتاح، ويعيد قرار الصلاحية. يُخزّن التطبيق آخر نتيجة صالحة مع **فترة سماح 7 أيام دون اتصال**.
- **أهم نقطة:** يجب أن يبقى التطبيق صالحاً دون اتصال. المستخدمون الحاليون ومنصة العمل المحلية أهم من الإلزام؛ أي فشل في الشبكة يجب أن يتراجع بأمان إلى التحقق المحلي، لا إلى تطبيق مقفل.

---

## 4. What we are NOT doing now / ما لا نفعله الآن

**EN — state this plainly, internally and externally:**
- ❌ No fake security claim. We do not say the license is "secure," "unbreakable," "encrypted," "device-bound," or "tamper-proof."
- ❌ No "unbreakable license" promise. Anyone can already mint a valid Owner key — we know, and we are not hiding it.
- ❌ No server, no webhook, no revocation, no device binding, no activation server in this build.
- ✅ The current build ships **honor-system keys with full transparency**: the secret is public, the generator documents it, the pricing copy will say keys are shareable, and the app's offline-first behavior stays intact.
- ✅ Accurate sentence to use: *"BYOK is free; a one-time Owner License is designed and shown, but enforcement is honor-system — keys are shareable and checkout is not live."*

**AR:**
- ❌ لا ادعاء أمني كاذب. لا نقول إن الترخيص «آمن» أو «لا يُكسر» أو «مُشفّر» أو «مرتبط بالجهاز».
- ❌ لا وعد بـ«ترخيص لا يُكسر». يستطيع أي شخص بالفعل إصدار مفتاح مالك صالح — نحن نعلم، ولا نخفي ذلك.
- ❌ لا خادم، ولا webhook، ولا إلغاء، ولا ربط بالجهاز، ولا خادم تفعيل في هذا البناء.
- ✅ البناء الحالي يُشحن **بمفاتيح تعتمد على الشرف وبشفافية كاملة**: السر علني، والأداة توثّق ذلك، ونسخة الأسعار ستقول إن المفاتيح قابلة للمشاركة، وسلوك العمل دون اتصال يبقى سليماً.
- ✅ الجملة الدقيقة للاستخدام: *«BYOK مجاني؛ رخصة المالك لمرة واحدة مصمّمة ومعرضة، لكن الإلزام يعتمد على الشرف — المفاتيح قابلة للمشاركة والدفع غير مُفعّل.»*

---

## 5. Recommendation (one) / التوصية (خيار واحد)

### EN — Recommendation: **Option (a), launch now with honest honor-system licensing.**

Brutally honest reasoning:

1. **"Launch now" and "enforced revenue" are mutually exclusive here.** The only option you can ship this week without new infra is (a). (b) is real, but it is a project — Edge functions, a store, a webhook, ops, and careful offline-fallback work — and it will push the launch out. Do not pretend you can skip that work and still have enforcement.
2. **The product is offline-first by design.** A server that must be contacted to unlock features fights the product's core value. Keeping the app fully functional offline is non-negotiable for existing users; that constraint is precisely why client-side keys exist. Shipping (b) half-finished would risk bricking offline users, which is worse than forgone revenue.
3. **For a small indie tool, honor-system licensing is what most successful tools actually do.** Revenue comes from goodwill, and it is usually enough to validate a launch. Sublime and TablePlus are not poor because their licenses are shareable.
4. **Honesty is cheap and valuable.** Disclose the shareable nature openly. It costs you the ~few sales that would have self-minted anyway and earns trust with everyone else. That is a good trade at launch.
5. **(b) is the scheduled fast-follow, not the launch.** The moment you have real paying customers and evidence that leakage hurts, invest in (b) using the §3 sketch. Treat it as an upgrade, measured against actual numbers, not as a launch blocker.

So: **ship (a), say what it is, and defer (b).** If revenue — not launch date — turns out to be the hard constraint, then reverse this and build (b) first. You cannot have both; pick the one that matches the actual deadline.

### AR — التوصية: **الخيار (أ)، أطلق الآن بترخيص شرف صادق.**

سبب صريح:

1. **«الإطلاق الآن» و«الإيراد المُلزم» لا يجتمعان هنا.** الخيار الوحيد الذي يمكنك شحنه هذا الأسبوع دون بنية تحتية جديدة هو (أ). الخيار (ب) حقيقي لكنه مشروع: دوال Edge ومخزن وwebhook وصيانة وعمل دقيق للتوافق مع دون اتصال — وسيؤخر الإطلاق. لا تتظاهر بأنك تتجاوز هذه الأعمال وما زلت تحصل على إلزام.
2. **المنتج مصمّم ليعمل دون اتصال أولاً.** خادم يُشترط للاتصال لفتح الميزات يتعارض مع جوهر المنتج. إبقاء التطبيق صالحاً تماماً دون اتصال للمستخدمين الحاليين أمر غير قابل للتفاوض، وهذا بالضبط سبب وجود المفاتيح المحلية. شحن (ب) ناقصاً قد يُقفل المستخدمين دون اتصال، وهذا أسوأ من خسارة إيراد.
3. **لأداة مستقلة صغيرة، ترخيص الشرف هو ما تفعله معظم الأدوات الناجحة فعلاً.** الإيراد يأتي من النية الحسنة، وعادةً يكفي للتحقق من الإطلاق. Sublime وTablePlus ليسا فقيرين لأن تراخيصهما قابلة للمشاركة.
4. **الصدق رخيص وقيّم.** افصح علناً عن قابلية المشاركة. يكلّفك هذا بيعة قليلة كان أصحابها سيصدرون المفتاح لأنفسهم على أي حال، ويكسب ثقة الباقين. صفقة جيدة عند الإطلاق.
5. **(ب) هو التحديث السريع المجدوَل، لا الإطلاق.** بمجرد وجود عملاء حقيقيين يدفعون وأدلة على أن التسريب يؤذي الإيراد، استثمر في (ب) باستخدام مخطط §3. عاملها كترقية تُقاس بالأرقام الفعلية، لا كعائق أمام الإطلاق.

**الخلاصة: اشحن (أ)، وقل ما هو فعلاً، وأجّل (ب).** إذا تبيّن أن القيد الحقيقي هو الإيراد لا موعد الإطلاق، فاقلب القرار وابنِ (ب) أولاً. لا يمكن الحصول على الاثنين معاً؛ اختر ما يطابق الموعد الحقيقي.

---

## 6. Evidence / الأدلة

| Fact | Source |
|---|---|
| Signing secret is public and hardcoded in the verifier | `electron/services/licenseService.ts:40` |
| Same public secret hardcoded in the key generator | `scripts/license-gen.cjs:38` |
| Generator admits secret is "PUBLIC / not a real private credential" | `scripts/license-gen.cjs:14-22, 37` |
| Generator admits no activation server / no device binding / no revocation | `scripts/license-gen.cjs:24-30, 180-183` |
| "Paid" OWNER key validated as a real entitlement (M1 proof) | `docs/MONETIZATION-TRUTH-V1133.md` (GAP-1, G7) |
| Checkout deliberately disabled; no processor/webhook | `docs/MONETIZATION-TRUTH-V1133.md` (GAP-3) |
