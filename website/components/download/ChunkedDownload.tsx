'use client';
// v11.43 — resilient download when Vercel Blob is suspended: the installer is
// served as <100 MB static parts from /dl/<name>.partNN, reassembled in-browser
// into one Blob and verified against the real SHA-256 before saving. Honest:
// no fake progress, exact hash check, clear error on any failed part.
import { useState } from 'react';

type Props = {
  parts: string[];      // ordered URLs, e.g. ['/dl/setup.part00', '/dl/setup.part01']
  filename: string;     // e.g. 'SADEEM-Setup-11.12.0.exe'
  expectedSha256: string;
  children: React.ReactNode; // button content (reuses the site's button look)
  className?: string;
};

async function sha256hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function ChunkedDownload({ parts, filename, expectedSha256, children, className }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function run() {
    setState('loading');
    setMsg('');
    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (let i = 0; i < parts.length; i++) {
        const r = await fetch(parts[i], { cache: 'no-store' });
        if (!r.ok) throw new Error(`part ${i + 1}/${parts.length}: HTTP ${r.status}`);
        const b = new Uint8Array(await r.arrayBuffer());
        chunks.push(b);
        total += b.length;
        setMsg(`${i + 1}/${parts.length}`);
      }
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      const got = await sha256hex(merged.buffer);
      if (got !== expectedSha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch — expected ${expectedSha256.slice(0, 12)}…, got ${got.slice(0, 12)}…`);
      }
      const url = URL.createObjectURL(new Blob([merged], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState('done');
      setMsg('verified · saved');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <button type="button" className={className} onClick={run} disabled={state === 'loading'}>
        {children}
      </button>
      {state !== 'idle' && (
        <p className="mono" role="status" style={{ fontSize: 12, opacity: .8, marginTop: 6 }}>
          {state === 'loading' ? `downloading ${msg}…` : state === 'done' ? msg : `error: ${msg}`}
        </p>
      )}
    </div>
  );
}
