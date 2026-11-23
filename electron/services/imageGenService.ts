// ============================================================
// Surnia — image generation service ("superpower: توليد صور")
// ------------------------------------------------------------
// The agent can now GENERATE images (hero art, illustrations,
// og-images, placeholders, logos) via the keyless Pollinations
// image endpoint — zero setup works with every provider because
// the TOOL does the generation; the model only writes the prompt.
// Security posture:
//   · fixed allow-listed host (image.pollinations.ai) — no
//     arbitrary URLs, no SSRF surface
//   · prompt sanitized (control chars stripped, capped length)
//   · output ALWAYS written inside the workspace (resolved via
//     the same write-wall helper the other tools use)
//   · size clamped to a sane set; format locked to jpg/png
//   · 60s timeout, 12MB response cap, content-type verified
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

const IMAGE_HOST = 'image.pollinations.ai';
const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_PROMPT = 480;

// v11.32 (NO BLIND RETRY) — the founder's screenshot: a 503 from the image
// service used to invite another attempt, so the model kept calling this
// tool forever while the UI showed "thinking 58s / 64s — still reasoning".
// The failure text now NEVER invites another call: it names the concrete
// alternative (a hand-crafted SVG/CSS icon written with write_file) or an
// honest "continue without it". The engine-level breaker in engine.ts backs
// this up by redirecting after 2 identical failed calls.
const SERVICE_UNAVAILABLE_503 =
  'Image service unavailable (503) — DO NOT retry this tool. Switch to writing a hand-crafted SVG/CSS icon with write_file instead, or continue without it.';

const SIZES: Record<string, { w: number; h: number }> = {
  square: { w: 1024, h: 1024 },
  landscape: { w: 1280, h: 720 },
  portrait: { w: 832, h: 1216 },
  wide: { w: 1440, h: 620 },
  icon: { w: 512, h: 512 },
};

export interface ImageGenResult {
  ok: boolean;
  output: string;
}

/** Strip control chars + trim; keeps Arabic/emoji (URL-encoded downstream). */
function sanitizePrompt(raw: string): string {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT);
}

/** Sniff real raster bytes — a 200 with text/html must never be saved as an image. */
export function detectRaster(buf: Buffer): 'jpeg' | 'png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';
  return null;
}

/** Generate one image and write it into the workspace. */
export async function generateImage(
  args: {
    prompt?: string;
    dest?: string;
    size?: string;
    model?: string;
  },
  resolveWrite: (p: string) => string | null,
): Promise<ImageGenResult> {
  const prompt = sanitizePrompt(args?.prompt ?? '');
  if (prompt.length < 3) {
    return { ok: false, output: 'ERROR: prompt is required (describe the image in natural language, any language).' };
  }
  const sizeKey = String(args?.size ?? 'landscape').toLowerCase();
  const size = SIZES[sizeKey] ?? SIZES.landscape;
  const model = String(args?.model ?? 'flux').replace(/[^\w-]/g, '') || 'flux';

  const destRaw = String(args?.dest ?? '').trim();
  const fallbackName = `generated-${Date.now()}.jpg`;
  const resolved = resolveWrite(destRaw || path.join('assets', fallbackName));
  if (!resolved) {
    return { ok: false, output: 'ERROR: dest must be a path inside the workspace (e.g. assets/hero.jpg).' };
  }
  const ext = path.extname(resolved).toLowerCase();
  // SECURITY: a provided dest without an extension used to bypass this check
  // (`ext === ''` fell through) — require an image extension in all cases.
  if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
    return { ok: false, output: 'ERROR: dest must end with .jpg or .png.' };
  }

  const format = ext === '.png' ? 'png' : 'jpeg';
  const url =
    `https://${IMAGE_HOST}/prompt/${encodeURIComponent(prompt)}` +
    `?width=${size.w}&height=${size.h}&model=${encodeURIComponent(model)}&nologo=true&format=${format}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // SECURITY: the allow-list is meaningless with redirect:'follow' — a
    // compromised/hijacked endpoint could bounce us to 169.254.169.254 or any
    // internal service. Refuse ALL redirects instead of following them.
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, output: 'ERROR: the image service redirected to another host — refused (no external fetch followed).' };
    }
    if (!res.ok) {
      // v11.32 — 503 / service-busy gets the NO-RETRY instruction verbatim;
      // every other non-2xx is also framed as a switch, never a blind retry.
      if (res.status === 503) return { ok: false, output: SERVICE_UNAVAILABLE_503 };
      return {
        ok: false,
        output:
          `ERROR: image service returned HTTP ${res.status}. DO NOT retry this tool with the same arguments — ` +
          `switch to a hand-crafted SVG/CSS icon with write_file, or continue without the image.`,
      };
    }
    const ctype = String(res.headers.get('content-type') ?? '');
    if (!/^image\//.test(ctype)) {
      return { ok: false, output: `ERROR: unexpected content-type "${ctype}" — no image written.` };
    }
    // SECURITY: SVG is an image/ type that can embed <script> — it would be a
    // stored-XSS payload once served by the preview server. Only raster output
    // (.jpg/.png dests anyway) may be written.
    if (/svg/i.test(ctype)) {
      return {
        ok: false,
        output:
          'ERROR: SVG output is not allowed (SVG can embed scripts) — DO NOT retry this tool. ' +
          'Write a hand-crafted SVG/CSS icon with write_file instead, or keep the .jpg/.png dest and continue without it.',
      };
    }
    // SECURITY: pre-read size gate. The full-body cap below still applies as
    // the backstop (chunked responses / lying Content-Length), but honoring a
    // declared oversized Content-Length avoids buffering the body at all.
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return { ok: false, output: 'ERROR: image exceeds the 12MB safety cap (Content-Length).' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return { ok: false, output: 'ERROR: empty response from the image service.' };
    if (buf.length > MAX_BYTES) return { ok: false, output: 'ERROR: image exceeds the 12MB safety cap.' };
    // A lying content-type (or an error page served as image/*) must not land
    // as a fake .jpg. Verify the magic bytes before touching the filesystem.
    const actual = detectRaster(buf);
    if (!actual) {
      return { ok: false, output: 'ERROR: the image service returned bytes that are not a valid JPEG/PNG image — nothing was written.' };
    }
    const mismatch = (format === 'png') !== (actual === 'png');

    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, buf);
    // v10.2 — Library: generated images land in the cross-session gallery
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('./libraryService').noteLibraryItem({
        kind: 'image',
        title: path.basename(resolved),
        path: resolved,
        size: buf.length,
        origin: 'image_generate',
      });
    } catch {
      /* library is best-effort */
    }
    const kb = Math.max(1, Math.round(buf.length / 1024));
    return {
      ok: true,
      output:
        `Image generated → ${resolved} (${size.w}x${size.h}, ${kb}KB, model ${model}).\n` +
        (mismatch
          ? `Note: the service returned ${actual.toUpperCase()} bytes for a .${format === 'png' ? 'png' : 'jpg'} destination — ` +
            `the file is valid but its extension does not match its content (rename it for correct preview MIME).\n`
          : '') +
        `Use read_image on this path if you need to inspect it visually, or reference it directly in the UI you are building.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // v11.32 — inviting another attempt was the literal infinite-loop trigger. A busy /
    // unavailable transport gets the exact NO-RETRY instruction; every other
    // failure still redirects instead of inviting another identical call.
    if (/503|busy|unavailable|service/i.test(msg)) return { ok: false, output: SERVICE_UNAVAILABLE_503 };
    return {
      ok: false,
      output:
        `ERROR: image generation failed (${msg}). DO NOT retry this tool with the same arguments — ` +
        `switch to writing a hand-crafted SVG/CSS icon with write_file, or continue without the image and tell the user.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
