// SADEEM — PROOF BUTTON (v7.2 signature feature, v11.27/v11.31 final form).
// One small control. That is the whole feature.
//
// State is driven ONLY by real proof events in the event stream (store.proof,
// fed by ingestProofEvent): verify_run · red_green · fake_tests · mutation_gate
// · critic_verdict · run_receipt · proof_package. A plain chat answer leaves
// proofVisible FALSE and this component renders NOTHING.
//
// v11.17/v11.26 — the founder: "خليه زر PROOF فقط... أي شيء ثاني بروف شيله
// تماماً." The evidence strip, tally chips, gate ledger, explainer and popover
// panel were DELETED, not hidden. v11.31 removes their last remains from source
// too: no panel state, no focus state, no overlay refs, no gate/evidence glyph
// components, no legacy icon imports. What you see (~22px, 1px hairline, mono
// PROOF + a single pip) is all there is.
//
// v11.27 — THE BUTTON WORKS. One honest click copies a short, plain-text
// evidence summary (counts of REAL store gates) through navigator.clipboard
// and toasts the ACTUAL outcome. No fake "copied" state, no raw JSON, no panel.
// The tiny accent pip keeps ONE shot pulse keyed to the rising edge of new
// evidence (iteration count 1 in proof.css — never a heartbeat).
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT, useDigits } from '../i18n';
import './proof.css';

export function ProofRibbon() {
  const t = useT();
  const digits = useDigits();
  const proof = useStore((s) => s.proof);
  // The store only flips this TRUE when the CURRENT turn produced real
  // tool-backed evidence AND at least one gate verdict.
  const proofVisible = useStore((s) => s.proofVisible);
  // Real store action used for the outcome toast (never a painted fake state).
  const notify = useStore((s) => s.notify);
  // v11.43 — the chip is ALSO the one-click doorway to the real Proof Center
  // rail page. 'proof' is widened in registry.tsx only (store/Rail.tsx are
  // owned by other waves); the runtime setRail is a plain string setter, so
  // this cast is a compile-time bridge, not a fabricated state.
  const setRail = useStore((s) => s.setRail);
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';

  // ONE pulse per NEW evidence episode — rising edge of proofVisible only.
  // `pulseGen` keys the <span> so its one-shot CSS animation replays exactly
  // once; gates arriving later in the SAME turn never re-pulse.
  const [pulseGen, setPulseGen] = useState(0);
  const prevVisible = useRef(proofVisible);
  useEffect(() => {
    if (proofVisible && !prevVisible.current) setPulseGen((g) => g + 1);
    prevVisible.current = proofVisible;
  }, [proofVisible]);

  // The ONE honest action this tiny control performs: read REAL gate counts,
  // build a short monolingual summary, write it through the REAL clipboard API
  // and toast the ACTUAL result. A missing clipboard is reported, never a
  // silent no-op.
  const handleProofCopy = async () => {
    const gates = proof.gates;
    const total = gates.length;
    const passed = gates.filter((g) => g.tone === 'ok').length;
    const failed = gates.filter((g) => g.tone === 'bad').length;
    const warned = gates.filter((g) => g.tone === 'warn').length;
    const statusEn =
      proof.status === 'proven' ? 'proven' : proof.status === 'failed' ? 'failed' : 'not proven';
    const statusAr =
      proof.status === 'proven' ? 'مُثبت' : proof.status === 'failed' ? 'فاشل' : 'غير مُثبت';
    const summary = ar
      ? `إثبات سادم: ${digits(total)} بوابات مسجّلة — ${digits(passed)} نجحت، ${digits(failed)} فشلت، ${digits(warned)} غير محسومة. الحالة: ${statusAr}.`
      : `SADEEM proof: ${digits(total)} gates recorded — ${digits(passed)} passed, ${digits(failed)} failed, ${digits(warned)} inconclusive. Status: ${statusEn}.`;

    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    const openCenter = () => (setRail as (v: string) => void)('proof');
    if (!clip || typeof clip.writeText !== 'function') {
      notify(ar ? 'الحافظة غير متاحة' : 'Clipboard unavailable');
      openCenter();
      return;
    }
    try {
      await clip.writeText(summary);
      notify(ar ? 'تم نسخ ملخص الإثبات' : 'Evidence summary copied');
    } catch {
      notify(ar ? 'تعذّر نسخ الإثبات' : 'Could not copy evidence');
    }
    // Copying the short summary is useful; opening the FULL honest ledger is
    // the real function. Both happen from this single, real button.
    openCenter();
  };

  // No evidence this turn → render NOTHING (founder: no proof rows in chat).
  if (!proofVisible) return null;

  return (
    <div className="px-2 pb-1 pr-anchor" data-testid="proof-ribbon">
      <button
        type="button"
        data-testid="proof-toggle"
        data-action="proof-only"
        className="pr-proof-toggle"
        aria-label={t('proof.openCenter', ar ? 'نسخ ملخص الإثبات وفتح مركز الإثبات' : 'Copy proof summary and open Proof Center')}
        title={t('proof.openCenter', ar ? 'نسخ ملخص الإثبات وفتح مركز الإثبات' : 'Copy proof summary and open Proof Center')}
        onClick={handleProofCopy}
      >
        {/* keyed remount on each rising edge of new evidence replays the CSS
            one-shot pulse exactly once; the pip is static when pulseGen === 0 */}
        <span
          key={pulseGen}
          className={`pr-toggle-dot${pulseGen > 0 ? ' is-pulsing' : ''}`}
          aria-hidden="true"
        />
        <span className="pr-tag" aria-hidden>PROOF</span>
        <span className="proof-ribbon-title sr-only">{t('proof.title', 'Proof')}</span>
      </button>
    </div>
  );
}
export default ProofRibbon;
