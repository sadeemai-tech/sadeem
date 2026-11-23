# SADEEM Remote — Phone Pairing Post-Mortem / تقرير الاقتران بالهاتف (v11.36)

Date: 2026-11-21 · Scope: `electron/services/remoteService.ts`, `src/components/settings/RemoteSection.tsx`, `shared/types.ts` (remote area), `tests/v1136-remote.test.mjs`.

---

## 1. Blunt verdict (EN)

**The phone never failed to "pair" — it was never given an address it could reach.** The QR encoded a private adapter IP that has no route from a phone on Wi-Fi. Everything else (token, deep-link format, sender check, bind address) was already correct and is preserved.

Root cause, exactly:

- The old `lanAddress()` ranked interfaces by the **address prefix only** and returned the first match (`192.168.*` → rank 0). On the reported machine the interfaces are, in order: `Ethernet 2 = 192.168.56.1` (VirtualBox host-only), `Wi-Fi = 192.168.1.24` (real LAN), `vEthernet (WSL) = 172.27.176.1`, `vEthernet (Default Switch) = 172.29.64.1`. A stable sort keeps `192.168.56.1` first, so the QR was `http://192.168.56.1:48888/#p=…`. A phone on `192.168.1.x` has no route to `192.168.56.x` → the control page never opened. **This is why the founder saw "the feature doesn't work on the phone."**
- Secondary: `QRCode.toDataURL(url, { margin: 1, width: 240 })` on an ~85-character URL produced tiny modules and almost no quiet zone — unreliable camera lock even when the IP was right.
- Secondary: no manual IP override, no reachability signal, and one generic `"Pairing failed …"`, so there was no way for a user to self-diagnose.

What was **NOT** the cause (checked, not guessed):
- **Not** `sadeem://`. That scheme is only the account-auth callback (`electron/main.ts:783,846`); remote pairing has never used it. The pairing deep link is an `http://LAN-IP:PORT/#p=…` URL read by the phone's camera — which is the right design for a phone (no app install, any scanner works).
- **Not** the token. It is generated once (20 base64url chars), encrypted at rest, compared with SHA-256 + `timingSafeEqual`, and returned only in a successful `/api/pair` body.
- **Not** CORS/HTTPS. The phone page and all API calls are same-origin over plain LAN HTTP; there is no mixed content and no cross-origin write path (foreign `Origin` is refused).
- **Not** the bind. The server already binds `0.0.0.0` when enabled — a loopback bind would indeed have been fatal for phones, but that was not the defect.
- **Not** V1131 security. One-use TTL codes, local-account binding, registered devices and per-mutation sender checks are intact and still tested.

## 2. الحكم بصراحة (AR)

**الهاتف لم يفشل في الاقتران — لم يُعطَ عنواناً يستطيع الوصول إليه أصلاً.** رمز QR كان يحمل عنوان بطاقة افتراضية (VirtualBox host-only `192.168.56.1`) بينما الهاتف على شبكة `192.168.1.x`، فلا يوجد مسار للوصول → صفحة التحكم لا تفتح. هذا هو السبب الحقيقي لشكوى المؤسّس.

السبب الثانوي: هامش QR كان `1` فقط وبعرض `240` لرابط طويل، فكانت المربعات صغيرة جداً ويصعب على كاميرا الهاتف التقاطها. ولم توجد طريقة لتغيير العنوان ولا أي إشارة صادقة إلى حالة الاتصال، ولا رسائل خطأ مميّزة.

**لم يكن السبب:** بروتوكول `sadeem://` (يُستخدم فقط لتسجيل الحساب)، ولا الرمزToken، ولا CORS/HTTPS، ولا عنوان الربط (كان `0.0.0.0` فعلاً)، ولا إجراءات الأمان V1131.

---

## 3. What was changed

| # | Fix | Exact location |
|---|-----|----------------|
| 1 | Replaced prefix-only IP sort with adapter-aware classification. Wi-Fi > wired > other > virtual; known host-only/bridge ranges (`192.168.56.*`, `192.168.99.*`, `172.17–31.*`) are penalized/flagged. Node <18 numeric `family === 4` also accepted. | `electron/services/remoteService.ts:597-650` (`adapterKind`, `VIRTUAL_RANGES`, `listLanCandidates`, `candidateScore`) |
| 2 | `selectedLanAddress()` honors an explicit manual IPv4 override; **no silent `127.0.0.1` fallback** — returns `''` and raises a distinct error. | `remoteService.ts:655-667`, `:685-703` (`buildPairingUrl`) |
| 3 | QR is now scannable: ECC `M`, quiet zone `margin: 4`, `width: 320`; payload keeps `#p=CODE&e=EXPIRY&a=ACCOUNT&v=1` (code, never token). | `remoteService.ts:64-68`, `:1175-1186` |
| 4 | Honest status: `lanAddress`, `lanCandidates[]`, `reachable` (cached TCP self-probe), `errorCode`. A QR is hidden in the UI whenever the LAN path is unreachable. | `remoteService.ts:707-729`, `:1137-1198`; `RemoteSection.tsx:170,276,385` |
| 5 | Manual LAN-IP selector + all detected adapters shown as chips with ✓/⚠; override persists through settings round-trips. | `remoteService.ts:521-533` (`remoteHostAllowed` narrows to pinned IP), `:1204-1231`; `RemoteSection.tsx:316-350` |
| 6 | 16 distinct error codes with EN/AR actionable text, injected into the phone page verbatim; network failures now produce an actionable "same Wi-Fi / firewall / port" message after 3 polls. | `remoteService.ts:151-236`, `:841`, `:873-880`, `:905`; errors at `:943-1010` |
| 7 | Sender-check failures now report **which** check failed (`MISSING_DEVICE_HEADER`, `DEVICE_NOT_REGISTERED`, `ACCOUNT_MISMATCH`, `DEVICE_TOUCH_FAILED`) instead of one opaque 403. Boolean `verifyRemoteSender` gate unchanged. | `remoteService.ts:315-347`, `:1003-1011` |
| 8 | Settings schema: `remote.host?: string` added in the remote area only. | `shared/types.ts:1004-1007` |
| 9 | New focused end-to-end suite (9 tests) with a stubbed topology reproducing the exact VirtualBox-vs-Wi-Fi bug. | `tests/v1136-remote.test.mjs` |

Security posture unchanged: `0.0.0.0` bind only when enabled, Host/Origin rebinding guard, SHA-256 timing-safe token, one-use 10-minute codes bound to the local OS account, device registration + sender check on every mutation, no tunnel/cloud.

## 4. Verification (actually run)

```
node --test --test-force-exit tests/v1136-remote.test.mjs   → 9 pass / 0 fail
node --test --test-force-exit tests/v1131-services2.test.mjs → 20 pass / 0 fail (incl. all pairing tests)
npx tsc -p tsconfig.node.json --noEmit                      → clean
npx tsc --noEmit                                            → one unrelated error, see note
Targeted tsc on the 3 owned .ts/.tsx files                  → clean
```

Note: other agents were editing the tree concurrently. `tsc --noEmit` currently reports exactly one error outside this task's ownership: `src/components/panels/FlowsPanel.tsx:558` (`TS2367`, `flowsMarkRun` is typed `void | undefined` in `src/lib/api.ts`). A transient `UsagePanel.tsx` error from the same concurrent work appeared and disappeared between runs. Neither file is owned here; a targeted compile of `RemoteSection.tsx`, `remoteService.ts` and `shared/types.ts` is clean, and the parent should re-run the full typecheck once those edits settle.

The new suite asserts: issue pairing → redeem from a simulated phone → token works on `/api/state` and on a mutating route; wrong/missing device rejected with distinct codes; used/expired/malformed/wrong-account codes each rejected with the right code; QR is a valid PNG with a well-formed LAN URL (`http://192.168.1.24:PORT/#p=…`, never `127.0.0.1`, no token); manual override honored and persisted; no-LAN topology produces `NO_LAN_ADDRESS`.

## 5. Handoffs to parent / other owners

1. **`src/lib/api.ts:136`** — `RemoteStatus` is still missing `pairingExpiresAt`, `lanCandidates`, `reachable`, `errorCode`. `RemoteSection.tsx:24-33` uses a local cast until this is updated. Add the four fields (and `host?: string` to the `remoteSet` patch at `src/lib/api.ts:529`) so the cast can be removed. I did not edit `api.ts` (not in my ownership).
2. **`electron/ipc.ts:716-718`** — no change strictly required: the QR auto-rotates when its 10-minute code expires (`activePairing()` in `remoteService.ts:126-135`), so no "Regenerate" IPC handler was added. If the product wants an explicit button, add `kdx:remote:renew` → `remoteService.issuePairingChallenge()` and wire it in `RemoteSection`.
3. **i18n** — I used `t(key, fallback)` plus local `tx(en, ar)` strings so no new key is mandatory. For full localization, parent should add keys for `remote.lan`, `remote.reachable`, `remote.unreachable`, `remote.expires`, `remote.lanOverride` and the 16 `REMOTE_ERROR_*` messages. I did not edit `src/i18n.ts`.
4. **Windows Firewall** is OS-level and cannot be configured from this code. The UI now gives a concrete instruction when `LAN_UNREACHABLE` is reported. The founder must allow inbound TCP on the chosen port for the app on first run.
5. **No real phone-in-the-loop test** was possible in this environment. The suite simulates the phone over HTTP with the reported interface topology; a final on-device smoke test (scan QR → approve once → send a task) is still recommended.
6. **Residual limitation**: hostname/mDNS links are intentionally rejected by the rebinding guard — only the exact IP:port in the QR works. This is deliberate security behavior, not a bug.

## 6. Files owned / touched

- Modified: `electron/services/remoteService.ts`
- Modified: `src/components/settings/RemoteSection.tsx`
- Modified: `shared/types.ts` — **remote area only** (`remote?: { … host?: string }`)
- Created: `tests/v1136-remote.test.mjs`
- Created: this document
- Not touched: `store.ts`, `engine.ts`, `i18n.ts`, `src/lib/api.ts`, `electron/ipc.ts`
