# IP PROTECTION — v11.34 (honest plan before sharing SADEEM with a company)
**Date:** 2026-11-21 • **Scope:** documentation only • **No app source, no git operations performed.**
**Trigger:** founder's question — *"بدك تعرض هذا التطبيق على شركة عشان الشركة تطوره... كيف بدك تحمي هذا التطبيق؟"*
("You want to show this app to a company so the company can develop it... how would you protect this app?")

> **Disclaimer / إخلاء مسؤولية:** This is practical, blunt guidance — **not legal advice**. I am not a lawyer. For real money or a real contract, pay an IP lawyer in your jurisdiction (Saudi Arabia / SAIP + a US IP counsel if you plan to sell in the US). Everything below is about reducing risk, not eliminating it.

---

## 0. TL;DR / الخلاصة — read this first

**EN:** You cannot "protect the idea." A competitor is free to build another AI coding agent with tools. What you *can* protect is: (1) your **expression** — the actual source code, by copyright (automatic, but prove it); (2) your **brand** — the name "sadeem" and logo, by trademark (must be registered); (3) your **trade secrets** — the non-public algorithms/configs, by keeping them secret (NDAs + access control); (4) your **design** — distinctive UI look, by trade dress / design registration. The single most effective thing before sharing with a company is a **signed mutual NDA + a development contract that says who owns what**. **Obfuscation is not protection** — it is a speed bump for honest people, reversible in minutes by a determined one. Ranking: **NDA + contract ≫ trademark registration > obfuscation > nothing.**

**AR:** ما بدك تحميه هو "الفكرة" — ما في طريقة قانونية تمنع شركة تبني وكيل ذكاء اصطناعي مشابه. اللي تقدر تحميه فعلياً: (١) **التعبير** — الكود المصدري نفسه، بحقوق النسخ (تلقائي، بس لازم تثبته)؛ (٢) **العلامة التجارية** — اسم "sadeem" والشعار، بالتسجيل (لازم تسجّله)؛ (٣) **الأسرار التجارية** — الخوارزميات والإعدادات غير المنشورة، بإنكا تحافظ على سريتها (اتفاقيات سرية + تحكم بالوصول)؛ (٤) **التصميم** — شكل الواجهة المميز، بـ trade dress / تسجيل تصميم. أهم خطوة قبل العرض على شركة هي **اتفاقية سرية متبادلة موقّعة + عقد تطوير يحدد ملكية التعديلات**. **التعتيم (obfuscation) مو حماية** — مجرد مطبّ بطيء للناس المحترمة، وقابل للفك خلال دقائق من شخص مصمم. الترتيب: **اتفاقية سرية + عقد ≫ تسجيل العلامة > التعتيم > لا شيء.**

---

## 1. What IS legally protectable / ما يمكن حمايته قانوناً

| Asset | Protected by | Automatic? | Concrete step you must actually take |
|---|---|---|---|
| Source code (`electron/...`, `src/...`) | **Copyright** | YES — the moment you write it | Keep it private; add `© 2026 SADEEM. All rights reserved.` headers; register with copyright office (USCO / Saudi IP authority); keep dated authorship evidence; signed IP-assignment from every contributor |
| Name "sadeem", logo, product identity | **Trademark** | NO — rights come from registration + use | Do a clearance search, then file "sadeem" (word + logo) with SAIP (Saudi) and/or USPTO; use ™ while pending, ® after registration; police copies |
| Distinctive UI look & feel | **Trade dress / design patent** | Partial — from distinctive use | Document a consistent visual identity (the Cairo/serif type, palette, layout); register the design where available; keep screenshots with dates |
| Non-public algorithms, prompt-engineering tricks, config, pricing logic, license scheme | **Trade secret** | Only if kept secret | Never publish; mark "CONFIDENTIAL"; NDAs; least-privilege access; confidentiality clauses with employees/contractors; no source in public repos |
| Compilations, docs, marketing copy, this repo's text | **Copyright** | YES | Same as source; keep dated copies |

### 1.1 Source code copyright — the foundation
- Copyright exists **automatically on creation** — you do not need to register to own it. **But registration is what lets you sue and claim statutory damages** in many jurisdictions (e.g., US registration before infringement or within 3 months of publication).
- Concrete proof steps **you can do without me touching git**: initialize git in this repo and commit the current state **before** sharing (see §3.5), keep dated backups, put a copyright notice in `README` / `LICENSE` (currently `"license": "UNLICENSED"` and `"private": true` in `package.json` — good, do not change that to an open license).
- **Honest limitation:** copyright protects the *expression*, not the *function*. A clean-room rewrite that does the same thing but with different code is not infringement.

### 1.2 Trademark — register "sadeem"
- A name is not protected until you use it in commerce — and **registration is what gives you enforceable exclusive rights** and the ® symbol.
- Steps: (1) clearance search (Arabic + Latin, class 9 software / class 42 SaaS); (2) file with **SAIP** (Saudi Authority for Intellectual Property) and, if you sell abroad, **USPTO** / EUIPO; (3) use it consistently as a brand, not as a generic word; (4) renew and monitor.
- **Honest limitation:** a trademark stops confusingly similar *branding*, not similar *features*.

### 1.3 Trade dress / design
- If the UI has a genuinely distinctive, non-functional look, it can be protected as trade dress (and by registered designs in many countries). Keep a dated visual record. **Honest limitation:** purely functional layout is not protected; you need recognisable, non-functional styling.

### 1.4 Trade secrets — only what you actually keep secret
- **Critical honesty check on THIS project:** a secret that ships to the client is not a secret. `docs/LICENSE-SECURITY-V1133.md` already documents that the license HMAC secret (`KODex-license-v1`) is public in the repo. **Do not treat that as a trade secret** — it is not one. Real trade secrets here are things that never leave your control (e.g., unpublished ranking/scoring logic, model-routing heuristics, internal datasets) and only exist behind access control + NDA.

---

## 2. What is NOT protectable / ما لا يمكن حمايته

**EN — be direct about this, because founders routinely get it wrong:**
- **Ideas and concepts.** "An AI assistant that calls 145 tools and builds apps" is an idea. Anyone can copy it. No law stops them.
- **General features and functionality.** File editing, chat, tool calling, live preview, plan/build/debug — none of that is ownable. Copyright does not cover function; patents on software features are hard, expensive, and time-limited.
- **Prompts alone.** Short instructions ("you are a helpful coding assistant", "write clean code, then verify") are generally too generic/trivial for copyright and are not trade secrets once they ship inside the product or appear in your public docs. A *large, non-public, original prompt library kept secret* might qualify as a trade secret — but the moment you publish it or hand it to the company under no NDA, that argument dies.
- **Algorithms as abstract ideas.** The math/logic itself is not copyrightable. Fine.
- **Facts, data, names of tools, third-party brands.**

**AR — كن صريح، لأن هذا أكثر خطأ يقع فيه المؤسسون:**
- **الأفكار والمفاهيم.** "مساعد ذكي يستدعي ١٤٥ أداة ويبني تطبيقات" فكرة، وأي أحد يقدر ي copyingها. ما في قانون يمنعهم.
- **الميزات والوظائف العامة.** تعديل الملفات، المحادثة، استدعاء الأدوات، المعاينة المباشرة... ما من واحد منها قابل للتملك. حقوق النسخ ما تغطي الوظيفة، وبراءات الاختراع صعبة ومكلفة ومحدودة زمنياً.
- **الـ prompts لوحدها.** التعليمات القصيرة عامة وتافهة أصلاً، وما تعتبر سراً تجارياً بعد ما تُشحن داخل المنتج أو تظهر في مستنداتك العامة. مكتبة prompts كبيرة وأصلية و**غير منشورة** ممكن تأخذ صفة سر تجاري — بس لحظة ما تنشرها أو تعطيها للشركة بدون اتفاقية سرية، الحجة تسقط.
- **الخوارزميات كأفكار مجردة.** الرياضيات/المنطق نفسها ما تُحمى بحقوق النسخ.
- **الحقائق والبيانات وأسماء الأدوات والعلامات التابعة لجهات خارجية (third-party).**

**Bottom line / الخلاصة:** you are not protecting "the app" as a thing. You are protecting **specific legal rights in specific assets**, and your leverage is **contract + proof**, not code tricks.

---

## 3. Practical steps BEFORE sharing with a company / خطوات عملية قبل العرض على شركة

### 3.1 Sign a mutual NDA FIRST — no exceptions
- **Mutual**, so both sides can speak freely. Define: purpose ("evaluation for a possible development engagement"), term (2–3 years, trade secrets indefinite), what is confidential (code, docs, roadmap, pricing, secrets), permitted use (evaluation ONLY — no building a competing product, no reverse engineering, no sublicensing), return/destruction on request, governing law + courts, and **injunctive relief** (money is not enough).
- **No source handover until it is signed.** Not a zip, not a repo invite, not a screen-share of the code.

### 3.2 Define scope + IP ownership of modifications IN THE CONTRACT
This is where founders lose their company. The development agreement must state, in writing:
- **Background IP stays yours** — all pre-existing SADEEM code, brand, and trade secrets remain 100% yours.
- **Ownership of modifications/derivatives:** default position — **you own the work product** (work-for-hire / assignment), or at minimum you get a perpetual, worldwide, irrevocable, royalty-free license to use anything they build on top of SADEEM. Do **not** sign "company owns all improvements" without a license back to you.
- **No competing product** from the shared code for a defined period; no reuse of your code in their other clients' projects.
- Deliverables, milestones, payment, warranty, termination, and what happens to forks on termination.
- **Escrow only if needed:** if they depend on it, source escrow with release conditions — not a handover.

### 3.3 Staged disclosure — give the minimum
1. **Demo only** (running app, UI, no code).
2. **`.eval` build** — a compiled/obfuscated evaluation binary with limited scope and an expiry date.
3. **Docs + architecture** under NDA.
4. **Source access** only after contract, in a controlled environment (their named devs, access log, no redistributing).
5. Never hand over the full private repo, signing secrets, customer data, or cloud credentials.

### 3.4 `.eval` build with obfuscation — deterrence, NOT security
- Build an expiring eval artifact; strip secrets; scope it (no production keys, no customer data).
- Apply **npm obfuscation** (`terser` mangle, or `javascript-obfuscator` on the shipped JS bundle) **only as deterrence**. It makes casual copy/paste and automated scraping annoying.
- **Be brutally honest:** obfuscation is **reversible**. Anyone can beautify, de-minify, hook, or run the app and read memory. It does **not** protect trade secrets, does **not** stop a determined company, and is **not** a substitute for the NDA. Never describe it to the company or investors as "our code is protected."

### 3.5 Watermark + licensing audit
- Embed a **unique build ID / company watermark** in every eval artifact and a per-company license key; keep a register of who got which build.
- Log usage where lawful and disclosed (install ID, build ID, first-run timestamp) to detect leakage; include **audit rights** in the contract (right to inspect that the code is not reused).
- Use **canary tokens** (unique dummy strings/secrets per recipient) so a leak can be traced to the source.
- For real enforcement you need a server (see `docs/LICENSE-SECURITY-V1133.md`) — client-side keys remain honor-system.

### 3.6 Git history = ownership proof — FLAG: this repo has NO git
- **Honest finding:** I checked — there is **no `.git` directory** in this workspace. There is therefore **no commit history, no author timestamps, and no cryptographic authorship trail** right now. That weakens your evidence if ownership is ever disputed.
- **Recommendation (I did NOT do this — no git operations were performed):** before you share anything, run `git init`, make an initial commit of the current tree, and keep committing as you work. Enable a **private remote** (GitHub/GitLab private repo) with 2FA. Dated commits + author fields + the private remote are simple, strong evidence of authorship and dates. Add copyright headers and a `LICENSE` file asserting "UNLICENSED — all rights reserved."
- **Do NOT** rely on file timestamps alone; they are trivial to forge.
- I am deliberately **not** initializing git for you — that is your call and your repository hygiene.

### 3.7 Contract checklist (one page)
`[ ] mutual NDA signed` • `[ ] purpose/scope defined` • `[ ] background IP = yours` • `[ ] modifications ownership/license-back written` • `[ ] no-compete/no-reuse clause` • `[ ] eval build, no full source` • `[ ] watermark + audit rights` • `[ ] git history + private remote` • `[ ] trademark search filed` • `[ ] lawyer reviewed`

---

## 4. Honest ranking / الترتيب الصادق

| Rank | Measure | What it actually buys you | Cost |
|---|---|---|---|
| **1** | **Signed mutual NDA + development contract** | The only thing that creates *enforceable duties* and *ownership clarity* over modifications. Your strongest leverage. | A lawyer + a signature |
| **2** | **Trademark registration ("sadeem")** | Exclusive brand rights, ®, ability to stop confusing copies; a real asset you can license/sell. | Search + filing fees + time |
| **3** | **Copyright registration + git/authorship proof** | Evidence of ownership; prerequisite to statutory damages in some jurisdictions. | Low / free to moderate |
| **4** | **Trade-secret discipline + eval build + watermarks** | Keeps non-public assets secret, traces leaks, raises the cost of casual copying. | Process discipline |
| **5** | **Code obfuscation (npm/terser)** | **Deterrence only.** Slows casual copying; fully reversible. **Not protection.** | Near zero |
| **6** | **Nothing / "they wouldn't steal it"** | Zero. You lose the app and have no recourse. | Zero |

**Direct statement / كلام مباشر:** **Obfuscation alone is not protection.** It is a locked diary, not a vault. If you show the app to a company with only obfuscation and no NDA/contract, you have handed them a working product and no legal claim when they rebuild it. Your protection is **contract + registered brand + provable authorship + kept secrets** — in that order.

**Final honest line / آخر كلمة صادقة:** the fastest path that actually protects you is: *initialize git and commit → file the "sadeem" trademark → sign a mutual NDA → sign a contract that says you own the background IP and the improvements → share only a watermarked, expiring eval build.* Everything else is theater. / *الطريق الأسرع اللي يحميك فعلاً: أنشئ git وسجّل التعديلات → قدّم علامة "sadeem" → وقّع اتفاقية سرية متبادلة → وقّع عقد ينص إنك تملك الأصل والتطويرات → شارك نسخة تقييم عليها علامة مائية وتنتهي صلاحيتها فقط.* الباقي تمثيل.
