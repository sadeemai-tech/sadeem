# Windows Code Signing & SmartScreen — honest status and exact plan
# التوقيع الرقمي لويندوز و SmartScreen — الوضع بصدق والخطة التفصيلية

> **CURRENT STATUS (EN):** SADEEM 11.12.0 is **UNSIGNED**. We have **not** purchased a
> code-signing certificate, so we **cannot** sign the installer or the portable ZIP.
> The Windows SmartScreen warning therefore stays. Nothing in this repository claims
> otherwise. A signed build is **planned**, not shipped.

> **الوضع الحالي (العربية):** نسخة سديم 11.12.0 **غير موقّعة**. لم نشترِ شهادة توقيع
> برمجيات، لذلك **لا نستطيع** توقيع المثبّت أو الملف المضغوط المحمول. تحذير SmartScreen
> سيبقى ظاهراً. لا يدّعي أي ملف في هذا المستودع غير ذلك. الإصدار الموقّع **مخطط له**
> ولم يُطلق بعد.

---

## 1. What the warning actually is / ما هو هذا التحذير بالضبط

**EN.** Windows Defender SmartScreen checks the reputation of a file that has never been
seen before. An unsigned `.exe` has no publisher identity to verify, so first run shows
**"Windows protected your PC"**. On the download page we tell users the honest flow:
**More info → Run anyway**, after checking the published SHA-256 checksum — and only for
files they trust.

**AR.** يفحص Windows Defender SmartScreen سمعة الملف الذي يظهر لأول مرة. الملف غير
الموقّع لا يحمل هوية ناشر يمكن التحقق منها، لذلك تظهر عند التشغيل الأول رسالة
**«حماية Windows لجهازك»**. نقول للمستخدم بصدق في صفحة التحميل: **مزيد من المعلومات ←
تشغيل على أي حال**، بعد التحقق من بصمة SHA-256 المنشورة، وفقط للملفات التي يثق بها.

---

## 2. What certificate is needed / ما الشهادة المطلوبة

| Route | Works for SmartScreen today? | Where the key lives | Notes |
|---|---|---|---|
| **OV / "authenticode" software cert** | **No.** Since **June 2023** Microsoft treats newly-signed OV files like unsigned ones for SmartScreen reputation. | File / HSM | Cheap, but does **not** remove the warning for new downloads. Do not buy it for this purpose. |
| **EV code-signing cert** | **Yes.** Required by Microsoft for immediate publisher reputation. | FIPS 140-2 L2 / EAL4+ hardware token (USB) or vendor cloud HSM | Sold by DigiCert, Sectigo, GlobalSign, SSL.com, etc. |
| **Azure Artifact Signing** (formerly Trusted Signing) | **Yes.** Microsoft's managed service; Electron calls it "the cheapest option" and says it gets rid of SmartScreen warnings. | In Azure — no local token | Region + identity restrictions apply. Individual validation currently only for US/Canada; organizations in US, CA, EU, UK, AU, NZ, JP, KR, SG, CH, NO, IL. |

**AR.** الشهادة الرخيصة (OV) لم تعد تفيد في سمعة SmartScreen للملفات الجديدة منذ
يونيو 2023 — ويندوز يعاملها كأنها غير موقّعة. المطلوب هو **شهادة EV** مخزّنة في جهاز
أجهزة معتمد (FIPS 140-2 L2) أو في خدمة سحابية، أو **Azure Artifact Signing** الذي
تديره مايكروسوفت. توجد قيود جغرافية على التحقق من الهوية.

> Signing removes the *unknown publisher* block. Microsoft does not publish a fixed
> download threshold for a "known/good" reputation score: reputation accrues with real
> signed installs over time. Anyone promising "one signature = instant green forever"
> is overselling it.
>
> العربية: التوقيع يزيل حاجر «الناشر غير المعروف»، لكن درجة السمعة الكاملة تُبنى مع
> التنزيلات الحقيقية بمرور الوقت، ولا تنشر مايكروسوفت رقماً ثابتاً لذلك.

---

## 3. Cost and timeline / التكلفة والمدة

Prices change; **verify them on the vendor's live pricing page before buying**.
الأسعار تتغير — **تحقق من صفحة التسعير الحية لدى البائع قبل الشراء**.

| Option | Rough cost (verify) | Timeline |
|---|---|---|
| OV certificate | ~US$70–250/year | 1–5 business days — **not useful for this warning** |
| EV certificate (token or cloud HSM) | ~US$200–600+/year | Identity validation ~1–15 business days + token shipping; cloud/HSM may be monthly |
| Azure Artifact Signing (Basic / Premium) | Low monthly subscription — see <https://azure.microsoft.com/en-us/pricing/details/trusted-signing/> | Account setup minutes; **identity validation 1–30 business days** (Microsoft's published range) |

Sources for the figures and restrictions:
<https://www.electronjs.org/docs/latest/tutorial/code-signing> ·
<https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart> ·
<https://azure.microsoft.com/en-us/pricing/details/trusted-signing/>

---

## 4. Exact steps / الخطوات العملية

### Step 0 — Decide the route / اختر المسار

- Need fastest and cheapest, have an eligible Azure identity → **Azure Artifact Signing**.
- Need a traditional cert accepted everywhere → **EV** from a CA (hardware token or cloud).

### Step 1 — Set the secrets (never commit them) / اضبط الأسرار

```powershell
# PowerShell
$env:WIN_CSC_LINK         = "C:\secrets\sadeem.pfx"   # path, https:// URL, or base64 .pfx
$env:WIN_CSC_KEY_PASSWORD = "the-pfx-password"
```

```bash
# bash
export WIN_CSC_LINK=/secrets/sadeem.pfx
export WIN_CSC_KEY_PASSWORD='the-pfx-password'
```

`electron-builder` reads these two variables automatically when `win.sign` is left unset.
The project's `electron-builder.yml` already documents them in a **commented** block.

### Step 2 — Enable the config / فعّل الإعداد

Open `electron-builder.yml`, find the block titled
`WINDOWS CODE SIGNING — PRESENT BUT DISABLED`, and uncomment the option that matches
your route (see the file for three commented variants: PFX env vars, EV token store,
and Azure). Then:

```bash
npm run dist:win
```

For the EV-token route on Windows, use `certificateSubjectName` or `certificateSha1`
instead of a `.pfx` — the private key stays on the token. For Linux/macOS CI with an
EV/HSM token, either use a custom `sign` hook or sign the produced artifacts with
[`jsign`](https://github.com/ebourg/jsign) (Electron's docs show the `TRUSTEDSIGNING`
storetype with `http://timestamp.acs.microsoft.com/` and `--tsmode RFC3161`).

### Step 3 — Verify / تحقق من التوقيع

```powershell
# Windows
signtool verify /pa /v release\SADEEM-Setup-11.12.0.exe
Get-AuthenticodeSignature release\SADEEM-Setup-11.12.0.exe | Format-List
```

Also upload the installer to VirusTotal once: a matching, trusted signature should be
visible. Then flip the download page wording from "unsigned / signed build is planned"
to the real signed status — **only after a signed artifact exists**.

### Step 4 — Keep the reputation / حافظ على السمعة

Sign **every** release with the same publisher identity, timestamp every signature with
an RFC 3161 server, and publish stable SHA-256 checksums. Do not switch certificate
subjects casually: the publisher name is what users and SmartScreen learn to trust.

---

## 5. What we prepared — and what we did NOT do / ما جهّznاه وما لم نفعله

**Prepared / جهّزنا:**
- `electron-builder.yml` — a complete, commented, ready-to-enable signing block using
  `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`, `signingHashAlgorithms: [sha256]`, an RFC 3161
  timestamp server, EV store selection, and the Azure option. Unsigned builds are unaffected.
- `website/components/download/DownloadPage.tsx` — the SmartScreen note now states the
  build is **unsigned**, explains **More info → Run anyway**, tells users to check the
  SHA-256, and says a signed build is **planned**. It does not claim we are signed.
- `tests/v1116-signing.test.mjs` — asserts the config is present-but-disabled and the
  page still says "unsigned".

**NOT done / لم نفعله:**
- We did **not** buy a certificate. We did **not** sign any binary. We did **not** make
  the SmartScreen warning disappear. **`npm run dist:win` still produces unsigned
  artifacts.** Anyone who says otherwise is lying. The only honest fix is a real
  OV/EV/Azure signing credential; everything else here is preparation.

**Why / السبب:** code signing is identity-bound and must be paid for and verified with a
government ID / business records. It cannot be synthesized in code, and bypassing it
would be either illegal or malware-like. We chose honesty.

---

## 6. Sources / المصادر

- Electron — Code Signing: <https://www.electronjs.org/docs/latest/tutorial/code-signing>
  (states the June 2023 EV requirement and that OV certs no longer help; links the Azure route)
- electron-builder — Code Signing / Windows configuration: <https://www.electron.build/>
  (docs → Configuration → win: `certificateFile`, `certificatePassword`,
  `certificateSubjectName`, `certificateSha1`, `signingHashAlgorithms`,
  `rfc3161TimeStampServer`, `signAndEditExecutable`)
- Microsoft Learn — Quickstart: Set up Artifact Signing:
  <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
  (regions, identity validation, 1–30 business day processing time)
- Azure — Artifact Signing pricing:
  <https://azure.microsoft.com/en-us/pricing/details/trusted-signing/>
- Electron Forge — Windows code signing guide:
  <https://www.electronforge.io/guides/code-signing/code-signing-windows>
- jsign (cloud/HSM signing on Linux & macOS): <https://github.com/ebourg/jsign>
