# SADEEM — دراسة نموذج تحقيق الدخل (Monetization Study)

**الإصدار:** v11.12.0 · **التاريخ:** 2026-11-18 · **الحالة:** قرار + تصميم صفحة أسعار (بوابة الدفع غير متصلة بعد)

---

## English summary (executive summary)

**Decision: no subscription plan of any kind. SADEEM is FREE during the public season with BYOK; future monetization ideas are being designed and nothing is charged today.**

The working model — a proposal, not an active store — has exactly four non-recurring surfaces:

1. **BYOK Free — $0, forever.** The acquisition engine, not a crippled demo. Unlimited local features, all 12 providers, keys never leave the device. Nothing is metered during the public season.
2. **Founder Lifetime License — $99 one-time** (founding cohort; **$149** afterwards). A perpetual signed offline key (`expiryDays = 0` → no `expiresAt`), all v11.x updates — no renewal machinery, no cancellation flow.
3. **Hosted Credit Packs — $10 / $25 / $100, pay as you go.** Usage-based by choice, never an automatic charge. 1 credit = $0.10 of hosted model usage at the posted model rate, with a transparent 15% platform fee included. Credits never expire. Failed attempts are not charged. Packs: 100 / 275 (+10%) / 1,200 (+20%) credits.
4. **Team License — $249 one-time for 5 seats** (+$40/extra seat). Shared playbooks are a roadmap item; the seat license is one-time, so there is no recurring billing lifecycle to maintain.

**Why one-time + usage credits:** the core product runs on the user's machine, so there is no hosted service to rent. The only variable cost is hosted tokens when the user has no keys — credits align price with that cost, while a one-time license matches the value of a tool the user keeps. Optional top-ups are bought by choice, so revenue follows real usage without a recurring plan. Paddle (Merchant of Record, 5% + 50¢ per checkout, global VAT/fraud handled) is the recommended gateway; Stripe fields already exist in settings but no keys are connected.

**Honest status:** `FREE_SEASON = true` in `billingService.ts`. No live payment processor is connected. The website pricing page ships with a visible public-season banner and placeholder buttons (`data-checkout` + `/download` + `mailto`), **not** a fake purchase. Prices are proposed, not charged. Do not flip `FREE_SEASON` until checkout, webhook, and license minting are live.

**Live research notes (fetched 2026-11-18):** OpenRouter's 2026 pricing is exactly this shape — credits bought with a fee, a generous BYOK allowance on list-price inference with no fee up to a cap and 5% above it, no minimums, no lock-in, failed attempts not billed. Paddle's 2026 pricing is 5% + 50¢ per transaction with tax and fraud handled by the Merchant of Record. (The `websearch` integration returned HTTP 402 in this environment; evidence below comes from direct page fetches, cited in §10.)

---

## ١. ملخص تنفيذي

**القرار: لا توجد خطة اشتراك من أي نوع. سديم مجاني خلال الموسم العام بمفاتيح المستخدم، وأفكار تحقيق الدخل قيد التصميم ولا يُحصَّل شيء اليوم.**

النموذج المقترح — ليس متجراً مفعّلاً — أربع واجهات غير متكررة فقط:

| الواجهة | السعر | الدور التجاري |
|---|---|---|
| BYOK Free | $0 دائماً | محرك الاكتساب — لا نُقنّن الميزات المحلية |
| Founder Lifetime | **$99** مرة واحدة (ثم $149) | إيراد فوري بلا تجديد ولا إلغاء |
| Credit Packs | من $10 | إيراد استخدامي اختياري بلا التزام متكرر |
| Team | $249 / 5 مقاعد | توسّع الفرق بمقعد يُدفع مرة واحدة |

المنتج **محلي بالكامل**: يعمل على جهاز المستخدم، ومفاتيح المزوّدين تبقى على الجهاز، ولا نتحمل تكلفة خادم لكل مستخدم. لذلك الدفعة الواحدة هي الثمن الصحيح لأداة يملكها المستخدم، والتكلفة المتغيرة الحقيقية هي رموز النماذج المستضافة فقط. الرصيد يطابق السعر مع هذه التكلفة، والشراء يبقى اختيارياً عند الحاجة.

**الحالة الصادقة:** لا توجد بوابة دفع متصلة. `FREE_SEASON = true` في `billingService.ts`. صفحة الأسعار تعرض بانراً واضحاً بالعربية والإنجليزية، وأزرارها عناصر تجريبية (`/download` أو `mailto` مع `data-checkout`)، وليست عملية شراء. الأسعار مقترحة ولا يُحصَّل شيء.

---

## ٢. لماذا الدفعة الواحدة والرصيد؟

1. **المنتج لا يعيش عندنا.** لا يوجد سيرفر نستضيفه لكل مستخدم، ولا «تكلفة استمرار» تبرر فاتورة متكررة. الدفعة الواحدة تناسب أداة سطح مكتب محلية تُملك لا تُستأجر.
2. **المطوّرون يكرهون إيجار الأدوات المحلية.** القاعدة الثابتة في 2026: جرّب مجاناً بمفتاحك، ثم ادفع مرة واحدة لامتلاك القدرة. لا قلق التزام، ولا حساب كم استخدمت الأداة قبل الإلغاء.
3. **السعر الثابت لا يطابق التكلفة المتغيرة.** التكلفة الحقيقية الوحيدة هي رموز النماذج المستضافة (عندما لا يجلب المستخدم مفتاحه). المستخدم الخفيف لا ينبغي أن يدفع أكثر من تكلفته، والثقيل لا ينبغي أن يكلفنا أكثر مما يدفع. حزمة credits تحل هذه المفارقة.
4. **الفوترة المتكررة هندسة ثقيلة قبل أول دولار.** الدورة المتكررة تحتاج محاولات دفع فاشلة (dunning)، إلغاء، استرداد، proration، وفوترة ضريبية — لا شيء من هذا موجود اليوم. الدفعة الواحدة تحتاج checkout + webhook + إصدار مفتاح، وأقل.
5. **التوقيت مناسب للموسم العام.** الموسم العام يعطي كل شيء مجاناً الآن. أي عرض لاحق يُقدَّم كمكافأة مبكرة واضحة، لا كتراجع عما كان مجانياً بالأمس.
6. **الجهد يبقى في المنتج.** مع فريق صغير، كل ساعة تُصرف على دعم الفوترة هي ساعة لا تُصرف على الوكيل نفسه.

> **ما الذي يحوّل المطوّرين فعلاً (2026):** تجربة بلا بطاقة ائتمان (BYOK مجاني سخي)، سعر واضح يُدفع مرة واحدة، شفافية تامة في تسعير الرموز، غياب الرسوم المفاجئة، والدفع عند الاستهلاك لا عند الوصول. الرعاية (GitHub Sponsors) تبقى قناة دعم إضافية لا نموذجاً أساسياً.

---

## ٣. القرار: «امتلك مرة، وادفع عند الاستهلاك»

نموذج واحد، أربع واجهات، بلا خطط متكررة:

1. **BYOK مجاني سخي = محرك الاكتساب.** نُبقيه بلا عدد runs ولا سقف رموز في التسويق خلال الموسم العام. كل الميزات المحلية مفتوحة. المستخدم الذي يجلب مفتاحه يكلفنا صفراً — لماذا نمنعه؟
2. **رخصة Founder لمرة واحدة = الإيراد الفوري والولاء.** `$99` للموجة المؤسِّسة، `$149` بعدها. مفتاح توقيع غير محدد الأمد (`expiryDays = 0`)، وكل تحديثات v11.x مشمولة.
3. **حزم credits = الإيراد الاستخدامي الاختياري.** المستخدم الذي لا يريد إدخال مفتاحه يشتري حزم credits عند الحاجة فقط. لا بطاقة محفوظة، لا تجديد تلقائي، لا إلغاء. التكرار هنا يأتي من الاستهلاك طوعاً لا من دورة فوترة.
4. **رخصة Team = التوسّع.** `$249` لـ 5 مقاعد، `$40` للمقعد الإضافي، مرة واحدة. مشاركة الـ playbooks على خارطة الطريق (v11.x) — نقول ذلك صراحة على الصفحة ولا نعد بأكثر مما بنيناه.

**لماذا هذا «أسهل» تنفيذياً؟** لأننا نتجنب دورة الفوترة المتكررة بالكامل: لا `renewsAt` يُدار، لا محاولات دفع فاشلة، لا proration، لا شاشة إلغاء. المطلوب فقط: checkout لمرة واحدة + webhook يصدر مفتاحاً موقّعاً + رصيد credits يُخصم منه. البنية موجودة بالفعل في `licenseService` (مفاتيح v2 بصلاحية دائمة) و`billingService` (`openCheckout` / `applyCoupon`).

---

## ٤. الأسعار الدقيقة (USD)

| الشريحة | السعر | نوع الدفع | ما الذي تحصل عليه |
|---|---|---|---|
| **BYOK Free** | `$0` | مجاناً دائماً | كل الأدوات المحلية، 12 مزوّداً بمفاتيحك، MCP اثنان، Playbook + DNA، دعم مجتمعي |
| **Founder Lifetime** ⭐ | `$99` (مؤسِّس) / `$149` (عادي) | **مرة واحدة** | كل ما في Free + MCP غير محدود + أدوات الجهاز + استدعاءات متوازية + 12 subagent + دعم ذو أولوية + كل تحديثات v11.x + خصم 50% على الترقية للإصدار الرئيسي القادم |
| **Credit Packs** | `$10` / `$25` / `$100` | عند الاستخدام | 100 / 275 (+10%) / 1,200 (+20%) رصيد — 1 رصيد = $0.10 استخدام نموذج مستضاف؛ لا تنتهي صلاحيته |
| **Team License** | `$249` / 5 مقاعد | **مرة واحدة** | كل ما في Lifetime لخمسة مقاعد + محفظة credits مشتركة + `$40` لكل مقعد إضافي + دعم ذو أولوية (مشاركة الـ playbooks: قيد التطوير) |

### قواعد الرصيد (Credit mechanics)

- **1 credit = $0.10** من استخدام النماذج المستضافة بسعر النموذج المعلن، **مشمولة برسوم منصة 15%** معلنة داخل سعر الرصيد (لا رسوم مخفية عند الاستخدام).
- الفشل لا يُحتسب: المحاولة التي تُخطئ أو تُعيد توجهاً ولا تُنتج رداً لا تُخصم (نفس سلوك OpenRouter المعلن في 2026).
- **الرصيد لا ينتهي** — قرار واعٍ لصالح المطوّر؛ التكرار يأتي من الاستهلاك لا من ضغط الانتهاء.
- حزمة `$25` = 275 رصيد (بقيمة $27.50، زيادة 10%)، حزمة `$100` = 1,200 رصيد (بقيمة $120، زيادة 20%) — الحوافز تدفع الشراء الأكبر وتُخفض نسبة رسوم الدفع.

### نطاق «Lifetime» (مهم للثقة)

«Lifetime» تعني **ترخيصاً دائماً غير منتهٍ لإصدار v11 بالكامل**، مع كل تحديثاته الفرعية. الترقية إلى الإصدار الرئيسي التالي ليست مجانية تلقائياً، بل بخصم 50% لحاملي Founder. هذا صادق، ومستدام مالياً، ويمنع التزاماً غير محدود بدعم إصدارات لم نبنِها بعد. المفتاح v2 يدعم هذا مباشرة: `expiryDays = 0` ⇒ لا يُكتب `expiresAt` ⇒ صلاحية دائمة في `effectivePlan()`.

### الكوبونات الحالية

`KODEX20` و`WELCOME50` و`DEV10` في `billingService.ts` مصمّمة لفترة أولية متكررة — لا معنى لها في نموذج الدفعة الواحدة. تُعاد إصدارها ككوبونات خصم على SKU لمرة واحدة عند تشغيل بوابة الدفع (مثلاً: `FOUNDER20` = 20% على رخصة Founder). لا تُفعّل الآن لأن الدفع نفسه غير مفعّل.

---

## ٥. منطق الإيرادات المتوقع (توضيحي — ليس تنبؤاً)

**افتراضات توضيحية:** 10,000 مستخدم نشط.

| المسار | الحساب | الإيراد |
|---|---|---|
| Founder Lifetime | 5% تحويل × 10,000 = 500 × $99 | **$49,500** نقداً فور التحصيل |
| Team | 2% × 10,000 = 200 × $249 | **$49,800** نقداً فور التحصيل |
| Credit Packs | 30% من حاملي Lifetime (150) × حزمة $25 واحدة | **$3,750** استخدام اختياري، بلا التزام متكرر |
| **المجموع عند الإطلاق** | | **≈ $103,050 نقداً + رصيد استخدامي اختياري** |

المنطق: رخصة Founder وTeam تدفعان نقداً مقدماً يُموّل التطوير، وحزم Credits تُحوّل المستخدم النشط إلى إيراد **باختياره** عند الحاجة، من غير آلة فوترة متكررة. الرقم توضيحي لتوضيح المنطق، وليس توقعاً مالياً؛ الواقع يعتمد على التحويل الفعلي وحجم استخدام النماذج المستضافة.

---

## ٦. مسار التنفيذ — ما الموجود وما المطلوب

### موجود بالفعل (لا يحتاج إعادة بناء)

| الملف | ما يوفره |
|---|---|
| `electron/services/billingService.ts` | `PLANS` (catalog), `FREE_SEASON = true`, `COUPONS`, `checkGate()`, `overview()`, `setPaymentLink()`, `openCheckout()`, `applyCoupon()`, `promo` state |
| `electron/services/licenseService.ts` | مفاتيح v2 موقّعة HMAC، `buildKeyV2(plan, expiryDays)` مع `expiryDays = 0` = دائم، `decodeKeyV2`، `activate`، `renew`، `deactivate`، `effectivePlan`، نقطة ترخيص عن بعد اختيارية `licenseEndpoint` |
| `shared/types.ts` | `LicenseState` (plan, seats, expiresAt, source)، `PlanDefinition` مع `available`، `PromoState`، `BillingOverview`، `CouponResult` |
| `website/app/layout.tsx` + `globals.css` | نظام التصميم، الخطوط، `tx()` ثنائية اللغة، SiteHeader الذي يشير إلى `/pricing` |

### مطلوب قبل تحصيل أول دولار (خارج نطاق هذا الملف)

1. **بوابة دفع (Merchant of Record):** يُوصى بـ **Paddle** — 5% + 50¢ لكل عملية، ضريبة VAT/مبيعات عالمية ومكافحة احتيال من البائع كـ MoR، بلا رسوم منصة ثابتة (سعر 2026 المعلن). Stripe حالياً نصف موصول (`stripePaymentLink` / `stripeSecretKey` في الإعدادات) لكن بلا مفاتيح، ويتطلب منا التعامل مع الضرائب والامتثال. نبقي حقل Stripe كبديل ولا نبني عليه الآن.
2. **منتجات في البوابة:** SKU لمرة واحدة `founder-lifetime` ($99/$149)، `team-5` ($249)، ومقعد إضافي ($40)، وحزم credits الثلاث ($10/$25/$100). الكوبونات تُنشأ كخصم على الدفعة الواحدة.
3. **Webhook ← license endpoint:** عند الدفع الناجح يُرسل الطلب إلى `settings.billing.licenseEndpoint`، فيُصدر `buildKeyV2('pro', 0)` (دائم) للحاملي الفردي، و`buildKeyV2('team', 0)` مع `seats = 5` للفريق، ويُعرض المفتاح في حساب المستخدم / عبر البريد.
4. **دفتر الرصيد (credit ledger):** حقول جديدة (`creditBalance`, `creditLedger`, `hostedSpend`) في `AppSettings` + خصم عند كل استخدام مستضاف. **هذا من ملفات التطبيق (`electron/src`) ويملكه وكيل آخر — لم ألمسه هنا.** صفحة الأسعار تصف النموذج فقط.
5. **موجّه النماذج المستضافة:** بوابة inference + قياس رموز فعلي + خصم الرصيد. حتى يوجد هذا، حزمCredits «قيد التحضير» ولا يمكن بيعها فعلياً.
6. **إيقاف الموسم العام:** فقط بعد (2)–(5) واختبار الدفع الحي. حتى ذلك الحين `FREE_SEASON = true` وكل شيء مفتوح.

---

## ٧. المخاطر والتخفيف

| الخطر | التخفيف |
|---|---|
| رخصة Lifetime رخيصة جداً فتأكل الإيراد | سعر مؤسِّس $99 ثم $149؛ الإيراد الاستخدامي في Credits والفريق؛ الخصم على الترقية الكبرى |
| غموض معنى «Lifetime» | تعريف صريح: v11 بالكامل + تحديثاته، ترقية كبرى بخصم 50% — مكتوب في الصفحة |
| مفاتيح offline قابلة للمشاركة | الواقع محلي-first؛ HMAC بمفتاح جهاز لكل تثبيت يمنع التصنيع من الكود المصدري؛ نعتمد على الثقة والدعم لا على القفل |
| أسعار الرموز تتغير فتتآكل هامش Credits | رسوم منصة 15% كوسادة + مراجعة دورية للأسعار مع إشعار مسبق؛ لا نعد بسعر رموز ثابت للأبد |
| التزام رصيد غير منتهٍ (deferred revenue) | تتبّع دفتر الرصيد في المحاسبة؛ لا ينتهي الرصيد قرار تجاري واعٍ ويُسعّر قديمياً عند الشراء |
| فتح الدفع قبل جاهزية البنية | بانر الموسم العام + أزرار تجريبية في الصفحة؛ `FREE_SEASON` يبقى `true` حتى اكتمال الـ webhook |
| ضرائب/احتيال عبر الحدود | Paddle كـ Merchant of Record يتولى VAT والاحتيال وخدمة المشتري |

---

## ٨. ما تم تنفيذه فعلياً في هذه الموجة (تقرير صادق)

**تم تنفيذه حقيقياً:**
- إنشاء هذا المستند `website/docs/MONETIZATION.md`.
- تحديث صفحة `website/app/pricing/page.tsx` مع CSS مخصص في `website/app/pricing/pricing.css`.
- أربع شرائح غير متكررة، جدول مقارنة، وFAQ، كلها ثنائية اللغة عبر `tx()`.
- أيقونات Lucide، توkens `globals.css`، حركات خفيفة، بلا تدرّجات لونية.
- بانر صريح مرتبط بثابت `FREE_SEASON` (يُقرأ كنسخة طبق الأصل مع إشارة إلى مصدره في `billingService.ts`).
- الشعار الرسمي للتطبيق `public/sadeem-app-logo.png` في رأس الصفحة، مع `favicon.png` و`favicon.svg` كاحتياطي.

**عناصر تجريبية (placeholders) — ليست ميزات حقيقية:**
- أزرار الشراء: `data-checkout="..."` + `mailto:support@sadeem.app` للشرائح المدفوعة، و`/download` للمجانية. **لا توجد عملية دفع، لا يوجد checkout، لا يوجد webhook.**
- الأسعار $99 / $149 / $10 / $25 / $100 / $249 **مقترحة** وليست محصّلة.
- «مشاركة الـ playbooks» للفريق موسومة صراحة على الصفحة بأنها قيد التطوير.
- لم أعدّل أي ملف في `electron/` أو `electron/src` — `billingService.ts` و`licenseService.ts` مملوكان لوكيل آخر. هذه الدراسة تخبره بما يحتاج بناءه ولا تُنفّذه مكانه.

**شرط القبول:** `npx tsc --noEmit` بلا أخطاء + `npm run build` ناجح.

---

## ٩. ملاحظة صادقة أخيرة

> **لا توجد بوابة دفع متصلة حالياً.** `FREE_SEASON = true` في الخدمة، وكل شيء مفتوح للجميع. صفحة الأسعار تعرض النموذج المقترح بشفافية كاملة، وأزرارها لا تُجري أي عملية شراء. لا تُغيّر `FREE_SEASON` إلى `false` ولا تُفعّل أي زر/checkout قبل أن تكون البوابة والـ webhook وإصدار المفتاح وحساب الرصيد جاهزة ومختبرة. الأسعار في هذه الوثيقة قرار تجاري، وليست فاتورة.

---

## ١٠. المصادر

- **OpenRouter — Pricing (2026):** https://openrouter.ai/pricing — رصيد يُشترى برسوم منصة 5.5% (Standard) / 8% (Business)، BYOK بلا رسوم حتى سقف سعر القائمة ثم 5%، لا حد أدنى ولا التزام، المحاولات الفاشلة لا تُحصب. (تم الجلب 2026-11-18.)
- **OpenRouter — BYOK docs:** https://openrouter.ai/docs/use-cases/byok — نفس منطق «مفتاحك أولاً، رصيدك احتياطاً» الذي نقترحه محلياً. (تم الجلب 2026-11-18.)
- **Paddle — Pricing (2026):** https://www.paddle.com/pricing — 5% + 50¢ لكل عملية checkout، بائع مسجّل (MoR) يتولى الضرائب والاحتيال، بلا رسوم منصة ثابتة. (تم الجلب 2026-11-18.)
- **داخلي:** `electron/services/billingService.ts`, `electron/services/licenseService.ts`, `shared/types.ts`, `website/lib/i18n.tsx`, `website/app/globals.css`.
- ملاحظة منهجية: أداة `websearch` أعادت HTTP 402 في هذه البيئة، لذلك استند الدليل الخارجي إلى جلب الصفحات مباشرة (webfetch) من العناوين أعلاه.

---

## Appendix A — Decision in one page (English)

| SKU | Price | Type | Notes |
|---|---|---|---|
| `byok-free` | $0 | Free forever | Acquisition engine; unlimited local features; keys stay on device |
| `founder-lifetime` | $99 → $149 | One-time | Perpetual v11 key; all v11.x updates; 50% next-major upgrade |
| `credit-pack-starter` | $10 | Pay as you go | 100 credits; 1 credit = $0.10 hosted usage; no expiry |
| `credit-pack-builder` | $25 | Pay as you go | 275 credits (+10%) |
| `credit-pack-power` | $100 | Pay as you go | 1,200 credits (+20%) |
| `team-5` | $249 | One-time | 5 seats; +$40/extra seat; shared playbooks on roadmap |

**Gateway:** Paddle (MoR, 5% + 50¢) recommended. **Blockers:** no processor connected, `FREE_SEASON = true`, credit ledger + hosted router not built. **Website today:** bilingual pricing page with public-season banner and placeholder buttons only. **Do not** enable checkout until all blockers are cleared.
