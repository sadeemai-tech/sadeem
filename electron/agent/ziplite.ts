// ============================================================
// Surnia v3.1 — ziplite: a minimal, dependency-free ZIP writer.
// Purpose: generate real .docx / .xlsx files (both are ZIP
// containers of XML parts) with NOTHING but node:zlib, so the
// agent can produce Office documents offline, with no pip/npm
// round-trip. Implements the subset of the PKZIP APPNOTE that
// Word/Excel/LibreOffice need: local file headers + central
// directory + EOCD, CRC-32, stored or deflate entries.
// ============================================================
import * as zlib from 'node:zlib';

// ---------- CRC-32 (slice-by-1, IEEE 0xEDB88320) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  /** Deflate when smaller (default), else store. */
  compress?: boolean;
}

interface BuiltEntry {
  name: string;
  crc: number;
  size: number;
  compressedSize: number;
  method: number;
  offset: number;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Build a ZIP archive Buffer from entries. UTF-8 filenames flagged via the
 * language-encoding bit (0x0800) so Word/Excel read unicode part names.
 */
export function buildZip(entries: ZipEntry[], opts?: { mtime?: Date }): Buffer {
  const mtime = opts?.mtime ?? new Date();
  const { time, date } = dosDateTime(mtime);
  const chunks: Buffer[] = [];
  const built: BuiltEntry[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(raw);
    let method = 0;
    let payload = raw;
    if (e.compress !== false && raw.length > 64) {
      const deflated = zlib.deflateRawSync(raw, { level: 9 });
      if (deflated.length < raw.length) {
        method = 8;
        payload = deflated;
      }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed (2.0 — deflate)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    chunks.push(local, nameBuf, payload);
    built.push({
      name: e.name,
      crc,
      size: raw.length,
      compressedSize: payload.length,
      method,
      offset,
    });
    offset += local.length + nameBuf.length + payload.length;
  }

  // ---------- central directory ----------
  const cdStart = offset;
  for (const b of built) {
    const nameBuf = Buffer.from(b.name, 'utf8');
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0014, 4); // version made by (2.0, MS-DOS)
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // UTF-8 flag
    cd.writeUInt16LE(b.method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(b.crc, 16);
    cd.writeUInt32LE(b.compressedSize, 20);
    cd.writeUInt32LE(b.size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42); // relative offset of local header
    cd.writeUInt32LE(b.offset, 42);
    chunks.push(cd, nameBuf);
    offset += cd.length + nameBuf.length;
  }
  const cdSize = offset - cdStart;

  // ---------- end of central directory ----------
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(built.length, 8);
  eocd.writeUInt16LE(built.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}
