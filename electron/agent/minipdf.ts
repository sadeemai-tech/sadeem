// ============================================================
// Surnia v3.1 — minipdf: a minimal, dependency-free PDF writer.
// Fallback renderer for make_document(format:'pdf') when the
// Electron print path (printToPdf, full CSS + unicode) is not
// available (CLI bundle / headless tests). Produces a valid
// PDF 1.4 file: Helvetica/Helvetica-Bold core fonts, A4 pages,
// word-wrapped plain text with headings/bullets. Latin-1 only —
// the caller surfaces that limit and prefers the print path.
// ============================================================

export interface MiniPdfLine {
  text: string;
  size: number;
  bold: boolean;
  gapBefore: number;
  /** v11.10 — render this line in Courier (pdf_make code blocks / tables). */
  mono?: boolean;
  /** v11.10 — left indent in points (nested list levels, quote blocks). */
  indent?: number;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const WINANSI_EXTRA: Record<string, string> = {
  '\u2018': '\u2018', // keep smart quotes via cp1252 bytes below
};

/** Latin-1/cp1252-safe: map common unicode punctuation to WinAnsi equivalents, drop the rest. */
function toWinAnsi(text: string): string {
  const map: Record<string, string> = {
    '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
    '\u2013': '-', '\u2014': '--', '\u2026': '...', '\u00a0': ' ',
    '\u2022': '-', '\u2192': '->', '\u00ab': '<<', '\u00bb': '>>',
  };
  let out = '';
  for (const ch of text) {
    if (map[ch]) out += map[ch];
    else {
      const code = ch.codePointAt(0) ?? 63;
      out += code <= 0xff ? ch : '?';
    }
  }
  return out;
}

/** Approximate Helvetica widths (per-mille of font size) — good enough to wrap. */
function charWidth(ch: string, bold: boolean): number {
  const wide = 'mwMW@';
  const narrow = 'iljtfrI.,;:!\'"|()[]{}';
  if (ch === ' ') return 278;
  if (wide.includes(ch)) return bold ? 889 : 833;
  if (narrow.includes(ch)) return bold ? 333 : 278;
  if (ch >= 'A' && ch <= 'Z') return bold ? 722 : 667;
  if (ch >= 'a' && ch <= 'z') return bold ? 611 : 556;
  if (ch >= '0' && ch <= '9') return 556;
  return 556;
}

/** Word-wrap a string to a max width (in points) at a given size. */
export function wrapText(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const clean = toWinAnsi(text.replace(/\t/g, '  '));
  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const width = (s: string): number =>
    [...s].reduce((a, ch) => a + (charWidth(ch, bold) * size) / 1000, 0);
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (width(cand) <= maxWidth) cur = cand;
    else {
      if (cur) lines.push(cur);
      if (width(w) > maxWidth) {
        // hard-break very long tokens (paths, URLs)
        let piece = '';
        for (const ch of w) {
          if (width(piece + ch) > maxWidth) {
            lines.push(piece);
            piece = ch;
          } else piece += ch;
        }
        cur = piece;
      } else cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * Render simple line specs to a PDF Buffer. Lines flow across pages with
 * word wrap; `size`/`bold` set per line; `gapBefore` adds vertical space.
 */
export function renderMiniPdf(title: string, lines: MiniPdfLine[]): Buffer {
  // ---------- layout into pages ----------
  const pages: string[][] = [];
  let current: string[] = [];
  let y = PAGE_H - MARGIN;
  const pushOps = (ops: string[]): void => {
    current.push(...ops);
  };
  const newPage = (): void => {
    pages.push(current);
    current = [];
    y = PAGE_H - MARGIN;
  };
  // Optional title header on page 1
  if (title.trim()) {
    const tLines = wrapText(title, 18, true, PAGE_W - MARGIN * 2);
    y -= 6;
    for (const tl of tLines) {
      pushOps([`BT /F2 18 Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdf(tl)}) Tj ET`]);
      y -= 24;
    }
    y -= 6;
  }
  for (const line of lines) {
    y -= line.gapBefore;
    const indent = line.indent ?? 0;
    const wrapped = wrapText(line.text, line.size, line.bold, PAGE_W - MARGIN * 2 - indent);
    const font = line.mono ? 'F3' : line.bold ? 'F2' : 'F1';
    for (const wl of wrapped) {
      if (y < MARGIN + line.size * 1.6) newPage();
      pushOps([
        `BT /${font} ${line.size} Tf ${(MARGIN + indent).toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(wl)}) Tj ET`,
      ]);
      y -= line.size * 1.55;
    }
  }
  pages.push(current);

  // ---------- assemble objects ----------
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  // 1: catalog, 2: pages tree, 3/4/5: fonts, pages from 6
  const firstPageId = 6;
  pages.forEach((_, i) => pageObjIds.push(firstPageId + i * 2));
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  // v11.10 — Courier for mono lines (code blocks, tables)
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  pages.forEach((ops, i) => {
    const pageId = pageObjIds[i];
    const contentId = pageId + 1;
    const content = ops.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  // ---------- serialize ----------
  let out = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(out, 'latin1');
  const maxId = objects.length;
  out += `xref\n0 ${maxId}\n0000000000 65535 f \n`;
  for (let id = 1; id < maxId; id++) {
    out += offsets[id]
      ? `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n';
  }
  out += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// ============================================================
// v11.10 — pdf_make shared markdown → line-spec parser.
// Understands: #/##/### headings, -/* bullets (with nesting),
// 1. numbered items, ``` code fences (Courier), | tables |
// (rendered as aligned mono rows), > quotes, and plain
// paragraphs. Horizontal rules become gaps. Bold **x** and
// inline `code` markers are stripped (plain-text fidelity).
// ============================================================
export function pdfLinesFromMarkdown(md: string): MiniPdfLine[] {
  const lines: MiniPdfLine[] = [];
  const stripInline = (t: string): string =>
    t
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|\W)\*([^*\s][^*]*)\*/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  let inCode = false;
  for (const raw of md.split('\n')) {
    const t = raw.replace(/\t/g, '  ');
    if (/^\s*```/.test(t)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      lines.push({ text: t, size: 8.5, bold: false, gapBefore: 0, mono: true, indent: 10 });
      continue;
    }
    const trimmed = t.trim();
    if (!trimmed) {
      lines.push({ text: '', size: 10, bold: false, gapBefore: 6 });
      continue;
    }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      lines.push({ text: '', size: 10, bold: false, gapBefore: 10 });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      lines.push({ text: stripInline(h[2]), size: 20 - h[1].length * 2, bold: true, gapBefore: 12 });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      lines.push({ text: stripInline(quote[1]), size: 10, bold: false, gapBefore: 2, indent: 16 });
      continue;
    }
    // table row: | a | b | — collected as-is (mono alignment makes columns readable)
    if (/^\s*\|.*\|\s*$/.test(t)) {
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      lines.push({ text: cells.join('  |  '), size: 8.5, bold: false, gapBefore: 0, mono: true });
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(t);
    if (bullet) {
      const level = Math.min(3, Math.floor(bullet[1].length / 2));
      lines.push({ text: '\u2022 ' + stripInline(bullet[2]), size: 10.5, bold: false, gapBefore: 1, indent: level * 14 });
      continue;
    }
    const num = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(t);
    if (num) {
      const level = Math.min(3, Math.floor(num[1].length / 2));
      lines.push({ text: `${num[2]}. ${stripInline(num[3])}`, size: 10.5, bold: false, gapBefore: 1, indent: level * 14 });
      continue;
    }
    lines.push({ text: stripInline(trimmed), size: 10.5, bold: false, gapBefore: 2 });
  }
  return lines.length ? lines : [{ text: '', size: 10, bold: false, gapBefore: 0 }];
}
