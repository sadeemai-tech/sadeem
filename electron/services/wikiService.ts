// ============================================================
// Surnia v6 — Repo Wiki (ZCode Wiki clone, hardened)
// ------------------------------------------------------------
// An auto-generated architecture wiki per workspace, stored OUTSIDE the
// repository (userData/wiki/<hash>/wiki.json) so it never pollutes the
// user's tree. Pipeline: scan (hygiene-filtered) → catalog → pages.
//
// SECRET HYGIENE (ZCode parity): the scanner skips .git, gitignored-style
// noise dirs, dependency/install dirs, binaries, lockfiles, symlinks, and
// ANY file whose name contains token/secret/credential/password/key — the
// model never sees their contents. Depth and file caps keep huge repos sane.
//
// AUTO-REFRESH CHECK: a cheap stats-only signature (relpath+mtime+size of
// every tracked file) is stored with the wiki; getWiki() recomputes it and
// reports `stale: true` when code changed since generation — the panel then
// offers a refresh. One generation per repo at a time (module lock).
// ============================================================
import * as fsSync from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { streamTurn } from '../agent/providers';
import type { ModelConfig } from '../../shared/types';

export interface WikiPage {
  slug: string;
  title: string;
  body: string;
}
export interface WikiData {
  generatedAt: number;
  language: 'ar' | 'en';
  catalog: { slug: string; title: string }[];
  pages: WikiPage[];
  /** Honest provenance — a saved wiki can itself be an offline repo-derived one. */
  source?: 'generated' | 'repo-docs';
}

const MAX_FILES = 350;
const MAX_DEPTH = 6;
const FILE_SNIPPET_CHARS = 2400;
const PAGE_FILES = 8;
const PAGE_FILE_CHARS = 7000;
const MAX_PAGES = 8;
const WALK_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 240_000;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.venv', 'venv', 'env', '__pycache__', 'target', 'vendor', 'coverage', '.cache',
  '.surnia', '.idea', '.vscode', 'Pods', 'DerivedData', '.gradle', 'bin', 'obj',
  // v11.31 — credential stores must never reach the model, even by directory name.
  'secrets', 'credentials', '.ssh', '.aws', '.gnupg',
]);

// v6 audit L-1 — widened: keys/sa/service-account names + key-store binaries.
const SECRET_NAME = /(token|secret|credential|password|passwd|api[-_]?key|private[-_]?key|\.pem$|\.key$|\.env|(^|[-_.])(key|keys|sa|service[-_]account)([-_.]|$)|\.pfx$|\.jks$|\.p12$|\.keystore$)/i;

const READABLE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java',
  '.kt', '.kts', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.vue',
  '.svelte', '.astro', '.md', '.mdx', '.json', '.yml', '.yaml', '.toml', '.sql',
  '.html', '.css', '.scss', '.sh', '.ps1', '.dart', '.lua', '.ex', '.exs', '.clj',
]);

export interface ScannedFile {
  rel: string;
  size: number;
  /** mtime is part of the signature: a same-size edit must still mark the wiki stale. */
  mtimeMs: number;
  head: string;
}

function wikiDir(workspace: string): string {
  const hash = createHash('sha1').update(path.resolve(workspace)).digest('hex').slice(0, 16);
  let base = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    base = app?.getPath?.('userData') ?? '';
  } catch {
    /* non-electron — fall through */
  }
  if (!base) base = process.env.SURNIA_HOME || path.join(process.env.HOME || process.cwd(), '.surnia');
  return path.join(base, 'wiki', hash);
}

/**
 * v11.38 — IPC gate, kept in the service so it is testable without booting
 * Electron. The renderer sets `wsPath` the instant a folder is opened, but
 * `recentPaths` is persisted asynchronously; a wiki:get that arrives in that
 * window used to be silently nulled by the old recentPaths-only gate. Accept a
 * real, project-looking directory even when recentPaths has not caught up.
 * Scanner hygiene (secret-name skip, bounded read) already limits exposure,
 * and only trusted renderer senders reach this code.
 */
export function isAllowedWikiWorkspace(workspace: string, recentPaths: string[] = []): boolean {
  const resolved = path.resolve(String(workspace ?? ''));
  if (!resolved || resolved === path.parse(resolved).root) return false;
  for (const p of Array.isArray(recentPaths) ? recentPaths : []) {
    try {
      if (path.resolve(String(p)) === resolved) return true;
    } catch {
      /* ignore bad entries */
    }
  }
  try {
    const st = fsSync.statSync(resolved);
    if (!st.isDirectory()) return false;
    // "Opened as a workspace" leaves at least one recognisable project marker.
    return ['README.md', 'readme.md', 'package.json', 'docs', 'src', '.git', 'pyproject.toml', 'go.mod']
      .some((name) => fsSync.existsSync(path.join(resolved, name)));
  } catch {
    return false;
  }
}

interface WalkCounter { n: number }

/**
 * Cheap stats-only signature. BOTH callers now walk the same bounded,
 * hygiene-filtered file set — otherwise a repo over MAX_FILES produced a
 * different signature at generate time and at getWiki time, so a wiki was
 * permanently reported stale right after generation.
 */
function codeSignature(workspace: string, files?: ScannedFile[]): string {
  if (files) {
    const h = createHash('sha1');
    for (const f of files) h.update(`${f.rel}:${f.size}:${f.mtimeMs};`);
    return h.digest('hex');
  }
  const h = createHash('sha1');
  try {
    walk(workspace, workspace, 0, (_p, st, rel) => {
      h.update(`${rel}:${st.size}:${st.mtimeMs};`);
    }, { n: 0 });
  } catch {
    return 'walk-failed';
  }
  return h.digest('hex');
}

/** Bounded walker (dirs + readable files), secret-hygiene enforced. */
function walk(root: string, dir: string, depth: number, visit: (p: string, st: fsSync.Stats, rel: string) => void, counter: WalkCounter): void {
  if (depth > MAX_DEPTH || counter.n >= MAX_FILES) return;
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (counter.n >= MAX_FILES) break;
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // links are an escape/hole vector — never follow
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(root, abs, depth + 1, visit, counter);
      continue;
    }
    if (!e.isFile()) continue;
    if (SECRET_NAME.test(e.name)) continue; // secret hygiene: name-based skip
    if (!READABLE_EXT.has(path.extname(e.name).toLowerCase())) continue;
    try {
      const st = fsSync.statSync(abs);
      if (st.size > 512_000) continue;
      counter.n++;
      visit(abs, st, path.relative(root, abs).replace(/\\/g, '/'));
    } catch {
      /* vanished — skip */
    }
  }
}

/** Scan the workspace into catalog snippets (bounded, secret-hygiene enforced). */
export function scanWorkspace(workspace: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  walk(workspace, workspace, 0, (abs, st, rel) => {
    if (out.length >= MAX_FILES) return;
    let head = '';
    try {
      const fh = fsSync.openSync(abs, 'r');
      const buf = Buffer.alloc(Math.min(FILE_SNIPPET_CHARS, st.size));
      const read = fsSync.readSync(fh, buf, 0, buf.length, 0);
      fsSync.closeSync(fh);
      head = buf.toString('utf8', 0, read).replace(/\s+/g, ' ').trim();
    } catch {
      return;
    }
    out.push({ rel, size: st.size, mtimeMs: st.mtimeMs, head });
  }, { n: 0 });
  return out;
}

function wikiSystemPrompt(lang: 'ar' | 'en'): string {
  const langLine =
    lang === 'ar'
      ? 'اكتب كل النصوص بالعربية الفصحى المبسطة مع إبقاء أسماء الملفات والمصطلحات التقنية بالإنجليزية.'
      : 'Write in clear, professional English (keep file paths and technical terms verbatim).';
  return (
    'You are a senior software architect writing a REPO WIKI — an architecture guide that helps a new engineer ' +
    'understand this codebase fast. Ground EVERY claim in the provided file snippets; never invent modules that ' +
    'are not evidenced. ' +
    langLine +
    ' Output clean markdown with ## section headings. No preamble, no meta commentary.'
  );
}

async function wikiCall(
  model: ModelConfig,
  creds: { apiKey?: string; baseUrl?: string },
  lang: 'ar' | 'en',
  prompt: string,
): Promise<string> {
  let acc = '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    await streamTurn({
      model: { ...model, temperature: 0.2, reasoning: 'off' },
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      system: wikiSystemPrompt(lang),
      messages: [{ role: 'user', text: prompt }],
      tools: [],
      signal: ctrl.signal,
      onText: (t) => {
        if (acc.length < 30_000) acc += t;
      },
      onToolUse: () => {
        /* no tools */
      },
    });
  } finally {
    clearTimeout(timer);
  }
  return acc.trim();
}

interface ParsedCatalogPage { slug: string; title: string; files?: string[] }

/** Parse the catalog JSON out of a model reply (defensive). */
function parseCatalog(out: string): ParsedCatalogPage[] {
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as { pages?: unknown };
    if (!Array.isArray(parsed.pages)) return [];
    const seen = new Set<string>();
    const outPages: ParsedCatalogPage[] = [];
    for (const raw of parsed.pages) {
      const p = raw as { slug?: unknown; title?: unknown; files?: unknown };
      if (typeof p.slug !== 'string' || typeof p.title !== 'string') continue;
      const slug = p.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      // v11.31 — KEEP the model's file choices. Dropping them made every page
      // say "(none — infer from the earlier inventory)": a wiki without files.
      const files = Array.isArray(p.files)
        ? p.files.filter((f): f is string => typeof f === 'string' && !!f.trim()).slice(0, PAGE_FILES)
        : undefined;
      outPages.push({ slug, title: p.title.slice(0, 80), ...(files?.length ? { files } : {}) });
      if (outPages.length >= MAX_PAGES) break;
    }
    return outPages;
  } catch {
    return [];
  }
}

/** Atomic 0600 write so a crash mid-generation can never truncate wiki.json. */
function writeJsonAtomic(file: string, data: unknown): void {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fsSync.renameSync(tmp, file);
}

/** Refuse a corrupted/truncated wiki.json from reaching the panel. */
function sanitizeWiki(raw: unknown): WikiData | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Partial<WikiData>;
  const pages: WikiPage[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(w.pages) ? w.pages : []) {
    const page = p as Partial<WikiPage>;
    if (typeof page?.slug !== 'string' || typeof page.title !== 'string' || typeof page.body !== 'string') continue;
    if (!page.body.trim() || seen.has(page.slug)) continue;
    seen.add(page.slug);
    pages.push({ slug: page.slug, title: page.title.slice(0, 80), body: page.body.slice(0, 20_000) });
  }
  if (!pages.length) return null;
  return {
    generatedAt: typeof w.generatedAt === 'number' && Number.isFinite(w.generatedAt) ? w.generatedAt : 0,
    language: w.language === 'ar' ? 'ar' : 'en',
    catalog: Array.isArray(w.catalog)
      ? w.catalog
          .filter((c): c is { slug: string; title: string } => !!c && typeof (c as { slug?: unknown }).slug === 'string' && typeof (c as { title?: unknown }).title === 'string')
          .slice(0, MAX_PAGES)
      : pages.map((p) => ({ slug: p.slug, title: p.title })),
    pages,
    source: w.source === 'repo-docs' ? 'repo-docs' : 'generated',
  };
}

export interface GenerateResult {
  ok: boolean;
  error?: string;
  pages?: number;
  skipped?: number;
  /** True when the model was unavailable and a real offline wiki was saved. */
  offline?: boolean;
  source?: 'generated' | 'repo-docs';
}

export interface GenerateOptions {
  language?: 'ar' | 'en';
  model: ModelConfig;
  creds?: { apiKey?: string; baseUrl?: string };
  onStage?: (stage: 'scan' | 'catalog' | 'pages' | 'save', detail?: string) => void;
}

let runningLock = new Set<string>();

/** Is a generation already running for this workspace? */
export function isGenerating(workspace: string): boolean {
  return runningLock.has(path.resolve(workspace));
}

/**
 * Generate the wiki. Never throws — failures return { ok:false, error }.
 * Single-page failures are skipped (one bad page never kills the run). With a
 * key the model writes an architecture guide; if the model is unreachable or
 * useless we persist the REAL offline repo wiki instead of leaving a blank
 * panel — and report `offline: true` so the UI stays honest about provenance.
 */
export async function generateWiki(
  workspace: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const ws = path.resolve(workspace);
  if (runningLock.has(ws)) return { ok: false, error: 'A wiki generation is already running for this workspace.' };
  if (!opts.creds?.apiKey) {
    return {
      ok: false,
      error: 'no_api_key: add a provider key in Settings first to generate the AI wiki. Your repo\'s Markdown docs (README.md, docs/*.md) and source structure are still read and shown without a key.',
    };
  }
  runningLock.add(ws);
  try {
    opts.onStage?.('scan');
    const files = scanWorkspace(ws);
    const lang = opts.language === 'ar' ? 'ar' : 'en';
    const dir = wikiDir(ws);
    if (!files.length) {
      return {
        ok: false,
        error: 'No readable source files found. Hidden/dependency folders, binaries, lockfiles and credential-named files are skipped on purpose.',
      };
    }
    const signature = codeSignature(ws, files);

    /** Persist the honest offline wiki when the model cannot deliver. */
    const offlineFallback = (): GenerateResult => {
      const offline = buildOfflineWiki(ws, lang);
      if (!offline) return { ok: false, error: 'No readable source or Markdown files were found in this folder.' };
      writeJsonAtomic(path.join(dir, 'wiki.json'), offline);
      writeJsonAtomic(path.join(dir, 'meta.json'), { generatedAt: offline.generatedAt, signature });
      return { ok: true, pages: offline.pages.length, offline: true, source: 'repo-docs' };
    };

    opts.onStage?.('catalog', String(files.length));
    const listing = files.map((f) => `- ${f.rel} (${f.size}b): ${f.head.slice(0, 220)}`).join('\n');
    let catalogOut = '';
    try {
      catalogOut = await wikiCall(
        opts.model,
        opts.creds,
        lang,
        `Here is the file inventory of the repository:\n\n${listing.slice(0, 90_000)}\n\n` +
          `Design a wiki for this repo. Output ONLY a JSON object, no fences:\n` +
          `{"pages":[{"slug":"overview","title":"...","files":["rel/path.ts", ...]}, ...]}\n` +
          `Rules: the FIRST page must be slug "overview" (what this repo is, architecture map, how parts connect). ` +
          `Then up to ${MAX_PAGES - 1} topic pages (module deep-dives, data flow, setup/build, conventions). ` +
          `Every page lists the 1-${PAGE_FILES} most relevant file paths from the inventory.`,
      );
    } catch {
      return offlineFallback();
    }
    const catalog = parseCatalog(catalogOut);
    if (!catalog.length) return offlineFallback();

    opts.onStage?.('pages', String(catalog.length));
    const pages: WikiPage[] = [];
    let skipped = 0;
    for (const entry of catalog) {
      try {
        const rels = (entry.files ?? []).slice(0, PAGE_FILES);
        const chunks: string[] = [];
        for (const rel of rels) {
          const f = files.find((x) => x.rel === rel) ?? files.find((x) => x.rel.endsWith(rel));
          if (!f) continue;
          let body = '';
          try {
            body = fsSync.readFileSync(path.join(ws, f.rel), 'utf8').slice(0, PAGE_FILE_CHARS);
          } catch {
            body = f.head;
          }
          chunks.push(`--- ${f.rel} ---\n${body}`);
        }
        const pageOut = await wikiCall(
          opts.model,
          opts.creds,
          lang,
          `Write wiki page "${entry.title}" (slug: ${entry.slug}).\n\n` +
            `Relevant source files:\n\n${chunks.join('\n\n').slice(0, 60_000) || '(none — infer from the earlier inventory)'}\n\n` +
            `Start with a # heading using the title. Explain what this part does, how it connects to the rest, ` +
            `and anything a new engineer would trip on. 200-450 words.`,
        );
        if (pageOut) pages.push({ slug: entry.slug, title: entry.title, body: pageOut.slice(0, 20_000) });
        else skipped++;
      } catch {
        skipped++; // one bad page is skipped, but reported honestly
      }
    }
    if (!pages.length) return offlineFallback();

    opts.onStage?.('save');
    const data: WikiData = {
      generatedAt: Date.now(),
      language: lang,
      catalog: pages.map((p) => ({ slug: p.slug, title: p.title })),
      pages,
      source: 'generated',
    };
    writeJsonAtomic(path.join(dir, 'wiki.json'), data);
    writeJsonAtomic(path.join(dir, 'meta.json'), { generatedAt: data.generatedAt, signature });
    return { ok: true, pages: pages.length, ...(skipped ? { skipped } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    runningLock.delete(ws);
  }
}

export interface WikiStatus {
  wiki: WikiData | null;
  stale: boolean;
  generating: boolean;
  /** Set when a wiki file exists but is corrupt/empty — never a silent blank panel. */
  error?: string;
  /** v11.36 — 'repo-docs' means the pages come straight from real Markdown files. */
  source?: 'generated' | 'repo-docs';
}

const DOC_MAX_DEPTH = 4;
const DOC_MAX_BYTES = 120_000;

interface DocHit { abs: string; rel: string; mtimeMs: number }

/** Bounded Markdown-only walker (no dependencies, no secrets, no symlinks). */
function walkDocs(root: string, dir: string, depth: number, out: DocHit[], counter: { n: number }): void {
  if (depth > DOC_MAX_DEPTH || counter.n >= MAX_PAGES * 4) return;
  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (counter.n >= MAX_PAGES * 4) break;
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDocs(root, abs, depth + 1, out, counter);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.mdx?$/i.test(entry.name)) continue;
    if (SECRET_NAME.test(entry.name)) continue;
    try {
      const st = fsSync.statSync(abs);
      if (!st.isFile() || st.size === 0 || st.size > DOC_MAX_BYTES) continue;
      counter.n++;
      out.push({ abs, rel: path.relative(root, abs).replace(/\\/g, '/'), mtimeMs: st.mtimeMs });
    } catch {
      /* vanished */
    }
  }
}

function docTitle(body: string, rel: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading && heading[1].trim()) return heading[1].trim().slice(0, 80);
  return path.basename(rel).replace(/\.mdx?$/i, '').replace(/[-_]+/g, ' ').slice(0, 80) || rel;
}

interface PackageInfo { name: string; description: string; scripts: [string, string][] }

/** Read package.json name/description/scripts without ever executing anything. */
function readPackageInfo(ws: string): PackageInfo | null {
  try {
    const raw = fsSync.readFileSync(path.join(ws, 'package.json'), 'utf8').slice(0, 60_000);
    const j = JSON.parse(raw) as { name?: unknown; description?: unknown; scripts?: unknown };
    const scripts: [string, string][] = [];
    if (j.scripts && typeof j.scripts === 'object') {
      for (const [k, v] of Object.entries(j.scripts as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) scripts.push([k, v.trim().slice(0, 300)]);
        if (scripts.length >= 40) break;
      }
    }
    return {
      name: typeof j.name === 'string' ? j.name : '',
      description: typeof j.description === 'string' ? j.description : '',
      scripts,
    };
  } catch {
    return null;
  }
}

/** Group source files (non-Markdown) into a bounded, honest directory map. */
function structureSummary(files: ScannedFile[]): { dirs: [string, number][]; notable: string[]; total: number } {
  const counts = new Map<string, number>();
  const source = files.filter((f) => !/\.mdx?$/i.test(f.rel));
  for (const f of source) {
    const parts = f.rel.split('/');
    const top = parts.length > 1 ? parts[0] : '.';
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const dirs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30) as [string, number][];
  const notable = source.slice(0, 40).map((f) => f.rel);
  return { dirs, notable, total: source.length };
}

/**
 * v11.38 — build a REAL offline wiki from the repository itself. No model is
 * involved: pages come from README, docs/*.md, the source-tree shape and the
 * package.json script list. This is the honest fallback that makes the repo
 * wiki useful even with no provider key — not an empty "nothing here" panel.
 * The generated (AI) wiki, when available, is strictly an upgrade on top.
 */
function buildOfflineWiki(workspace: string, lang: 'ar' | 'en' = 'en'): WikiData | null {
  const ws = path.resolve(workspace);
  const hits: DocHit[] = [];
  walkDocs(ws, ws, 0, hits, { n: 0 });
  // README first, then docs/, then the rest — stable and human-sensible.
  hits.sort((a, b) => {
    const rank = (h: DocHit) => /^readme(\.|$)/i.test(path.basename(h.rel)) ? 0 : h.rel.startsWith('docs/') ? 1 : 2;
    return rank(a) - rank(b) || a.rel.localeCompare(b.rel);
  });

  const files = scanWorkspace(ws);
  const pkg = readPackageInfo(ws);
  const structure = structureSummary(files);
  const used = new Set<string>();
  const pages: WikiPage[] = [];
  let generatedAt = 0;

  const add = (title: string, body: string, mtime: number): void => {
    if (!body.trim()) return;
    let slug = title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `page-${pages.length + 1}`;
    while (used.has(slug)) slug = `${slug.slice(0, 36)}-${used.size + 1}`;
    used.add(slug);
    pages.push({ slug, title: title.slice(0, 80), body: body.slice(0, 20_000) });
    generatedAt = Math.max(generatedAt, mtime);
  };

  let hasReadme = false;
  for (const hit of hits) {
    if (pages.length >= MAX_PAGES - 2) break; // reserve room for structure + scripts
    let body = '';
    try {
      body = fsSync.readFileSync(hit.abs, 'utf8').slice(0, 20_000);
    } catch {
      continue;
    }
    if (!body.trim()) continue;
    if (/^readme(\.|$)/i.test(path.basename(hit.rel))) hasReadme = true;
    add(docTitle(body, hit.rel), body, hit.mtimeMs);
  }

  // No README? Synthesise a real overview from package metadata + file map.
  if (!hasReadme && (pkg || structure.total)) {
    const name = pkg?.name || path.basename(ws);
    const desc = pkg?.description || (lang === 'ar'
      ? 'دليل ويكي مُولَّد من ملفات المستودع الحقيقية.'
      : 'A wiki built automatically from this repository\'s real files.');
    const body = [
      `# ${name}`,
      '',
      desc,
      '',
      `## ${lang === 'ar' ? 'نظرة عامة' : 'At a glance'}`,
      '',
      `- ${lang === 'ar' ? 'ملفات مصدر مقروءة' : 'Readable source files'}: ${files.length}`,
      `- ${lang === 'ar' ? 'ملفات توثيق' : 'Markdown docs'}: ${hits.length}`,
      `- ${lang === 'ar' ? 'ملفات مصدر (غير توثيق)' : 'Source files (non-doc)'}: ${structure.total}`,
      '',
      `> ${lang === 'ar'
        ? 'هذه الصفحة مبنية من بنية المستودع وبيانات package.json — بدون أي مفتاح ذكاء اصطناعي.'
        : 'Built from the repository structure and package.json — no AI key required.'}`,
    ].join('\n');
    add(lang === 'ar' ? 'نظرة عامة' : 'Overview', body, generatedAt || Date.now());
  }

  if (structure.total > 0) {
    const body = [
      `# ${lang === 'ar' ? 'بنية المشروع' : 'Project structure'}`,
      '',
      `${structure.total} ${lang === 'ar' ? 'ملف مصدر مقروء، موزّعة على' : 'readable source files across'} ${structure.dirs.length} ${lang === 'ar' ? 'مجلد' : 'top-level areas'}.`,
      '',
      `## ${lang === 'ar' ? 'المجلدات' : 'Top-level areas'}`,
      '',
      ...structure.dirs.map(([d, n]) => `- \`${d}/\` — ${n} ${lang === 'ar' ? 'ملف' : 'files'}`),
      '',
      `## ${lang === 'ar' ? 'ملفات بارزة' : 'Notable files'}`,
      '',
      ...structure.notable.map((rel) => `- \`${rel}\``),
    ].join('\n');
    add(lang === 'ar' ? 'بنية المشروع' : 'Project structure', body, generatedAt || Date.now());
  }

  if (pkg?.scripts.length) {
    const body = [
      `# ${lang === 'ar' ? 'الأوامر والإعداد' : 'Scripts & setup'}`,
      '',
      `${lang === 'ar' ? 'أوامر package.json كما هي في المستودع:' : 'Scripts exactly as declared in package.json:'}`,
      '',
      ...pkg.scripts.map(([k, v]) => `- \`${k}\` → \`${v}\``),
      '',
      `> ${lang === 'ar' ? 'لم يتم تنفيذ أي أمر — هذه قراءة فقط.' : 'Nothing was executed — this is read-only.'}`,
    ].join('\n');
    add(lang === 'ar' ? 'الأوامر والإعداد' : 'Scripts & setup', body, generatedAt || Date.now());
  }

  if (!pages.length) return null;
  return {
    generatedAt: generatedAt || Date.now(),
    language: lang,
    catalog: pages.map((p) => ({ slug: p.slug, title: p.title })),
    pages,
    source: 'repo-docs',
  };
}

/** Load the wiki + staleness (cheap stats-only signature compare). */
export function getWiki(workspace: string): WikiStatus {
  const ws = path.resolve(workspace);
  const dir = wikiDir(ws);
  let raw: unknown = null;
  let corrupt = false;
  try {
    raw = JSON.parse(fsSync.readFileSync(path.join(dir, 'wiki.json'), 'utf8'));
  } catch {
    /* no wiki yet, or truncated file */
    corrupt = fsSync.existsSync(path.join(dir, 'wiki.json'));
  }
  const wiki = sanitizeWiki(raw);
  if (corrupt || (raw && !wiki)) {
    return { wiki: null, stale: false, generating: isGenerating(ws), error: 'The saved wiki is unreadable. Generate it again.' };
  }
  // No generated wiki yet: build the REAL offline wiki from README, docs/,
  // source structure and package scripts (v11.38). It needs no key and is
  // genuinely useful — never an empty shell.
  if (!wiki) {
    const docs = buildOfflineWiki(ws);
    if (docs) return { wiki: docs, stale: false, generating: isGenerating(ws), source: 'repo-docs' };
    return {
      wiki: null,
      stale: false,
      generating: isGenerating(ws),
      error: 'No readable source files or Markdown docs were found in this folder. Add a README.md or source files, then refresh.',
    };
  }
  let signature = '';
  try {
    const meta = JSON.parse(fsSync.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { signature?: string };
    signature = String(meta.signature ?? '');
  } catch {
    signature = '';
  }
  // Use the EXACT same bounded, hygiene-filtered scan the generator used —
  // including mtime — so a freshly generated wiki is not reported stale and
  // a same-size edit is still caught.
  const stale = !!wiki && !!signature && codeSignature(ws, scanWorkspace(ws)) !== signature;
  const source = wiki.source === 'repo-docs' ? 'repo-docs' : 'generated';
  return { wiki, stale, generating: isGenerating(ws), source };
}
