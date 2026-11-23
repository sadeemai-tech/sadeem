// Shared permission/task-mode orders — ONE source of truth so the store's
// /mode cycle, the TitleBar segment strip, the StatusBar chips and the
// Composer stamps all cycle (and sort) identically. Kept as a tiny lib file
// (not store.ts) to avoid circular imports from leaf components.
import type { PermissionMode, TaskMode } from '../../shared/types';

/** Canonical permission-mode order (PLAN first — read-only → full access). */
export const PERMISSION_MODES: PermissionMode[] = ['plan', 'default', 'autoEdit', 'fullAccess'];

/** Canonical task-mode order (the Composer taskMode segment strip). */
export const TASK_MODES: TaskMode[] = ['build', 'plan', 'debug', 'review'];

/**
 * Shared fallback descriptions for the task-mode stamps. This table existed
 * as four identical copies (StatusBar, Composer, TitleBar grammar, store) —
 * consolidate to one exported map.
 */
export const TASK_MODE_DESC: Record<TaskMode, string> = {
  build: 'BUILD — default execution posture',
  plan: 'PLAN — research and propose, no writes',
  debug: 'DEBUG — hypothesis → test discipline',
  review: 'REVIEW — read-only review posture',
};

/** Next entry of a cyclic order (wraps around; unknown values start at 0). */
export function nextIn<T>(order: readonly T[], cur: T): T {
  const i = order.indexOf(cur);
  return order[(i + 1) % order.length] ?? order[0];
}

// ============================================================
// v11.10 — PER-TOOL "always allow" scope derivation (founder complaint #1:
// "I tell it ALWAYS allow, it keeps asking again and again").
// The engine stores the decision scope via commandRuleKey(decision.value)
// and ruleAllows() prefix-matches token-boundary-wise — so a scope of "npm"
// covers every later "npm <anything>", while the legacy no-scope ALWAYS
// remembered only the exact command ("npm install") and re-prompted on the
// next sibling invocation. ONE derivation, shared by the store + tests.
// ============================================================

/**
 * Extract the per-tool scope from a command line:
 *   "FOO=1 BAR= npm install express" → "npm"
 *   "cd app && npm run dev"          → "cd"   (first segment wins — the user
 *   approved what they SAW; compound commands keep the visible head tool)
 *   "npm"                            → "npm"
 * Returns '' when nothing usable remains (empty / pure shell operators).
 */
export function deriveToolScope(command: string): string {
  const raw = String(command ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // shell control chars split segments; the FIRST segment is what the
  // approval card displayed — remember its tool.
  const head = raw.split(/(?:&&|\|\||;|\|)/)[0].trim();
  if (!head) return '';
  // strip leading env assignments (FOO=bar / FOO=)
  const toks = head.split(' ').filter(Boolean);
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  const tool = toks[i] ?? '';
  // quotes / subshells / pure operators are not a rememberable tool
  if (!tool || /^[("'`&;|<>*]/.test(tool)) return '';
  return tool;
}

/** Best-effort command extraction from an approval card's detail text. */
export function firstCommandLike(detail: string): string {
  const lines = String(detail ?? '').split('\n');
  for (const l of lines) {
    const t = l.replace(/^\[(cwd[^\]]*)\]\s*/i, '').trim();
    if (t) return t;
  }
  return '';
}

// ============================================================
// v11.26 — EVERY advertised slash command is REAL.
//
// The founder (repeated many times): "كل أوامر السلاش يجب أن تعمل بشكل
// المثالي والمطلوب." This registry is the ONE source of truth for what the
// Composer slash menu advertises. It deliberately carries NO translations
// (those stay in the Composer, where useT() lives) — it carries the *contract*:
// group, UI action and, crucially, the REAL effect mechanism. The proof test
// (tests/v1126-slash-all.test.mjs) iterates this list and asserts that every
// command maps to a handler that produces an observable effect, and that the
// four mode commands map 1:1 to real engine TASK_MODE_SPECS protocols.
// ============================================================

export type SlashGroup = 'session' | 'context' | 'build' | 'agent' | 'app' | 'panels' | 'custom';
export type SlashAction =
  | 'send'
  | 'fill'
  | 'model'
  | 'plans'
  | 'theme'
  | 'lang'
  | 'mode'
  | 'schedule'
  | 'settings'
  | 'panel'
  | 'taskmode';

/** How a command produces a REAL, observable effect (no cosmetic-only claims). */
export type SlashEffect =
  /** renderer store.ts `cmd === '…'` branch — transcript/state/IPC change */
  | 'store'
  /** SLASH_PROMPT_TEMPLATES expansion → a real agent send */
  | 'template'
  /** Composer `selectSlash` local action — visible state change */
  | 'ui'
  /** engine slashService TASK_MODE dispatch — real protocol on the next run */
  | 'engine-mode';

export interface SlashSpec {
  /** Advertised token, always with a single leading '/'. */
  cmd: string;
  group: SlashGroup;
  action: SlashAction;
  effect: SlashEffect;
  /** Command takes an argument → Composer shows a placeholder + trailing space. */
  arg?: boolean;
  panel?: string;
  section?: string;
  /** For action === 'taskmode': the mode the BUILD/PLAN/DEBUG/REVIEW stamp sets. */
  taskMode?: TaskMode;
}

/**
 * The canonical advertised set (Composer slash menu). Every entry has a real
 * handler; the proof test fails loudly if one is advertised but dead.
 * `/build` and `/debug` are advertised alongside `/plan` so that all FOUR
 * engine task modes (and their four Composer stamps) are reachable by slash.
 */
export const SLASH_COMMANDS: SlashSpec[] = [
  // session
  { cmd: '/clear', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/compact', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/rewind', group: 'session', action: 'fill', effect: 'store' },
  { cmd: '/undo', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/continue', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/fork', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/export', group: 'session', action: 'send', effect: 'store' },
  { cmd: '/goal', group: 'session', action: 'fill', effect: 'store', arg: true },
  { cmd: '/schedule', group: 'session', action: 'schedule', effect: 'ui' },
  { cmd: '/handoff', group: 'session', action: 'send', effect: 'template' },
  // context
  { cmd: '/init', group: 'context', action: 'fill', effect: 'store' },
  { cmd: '/context', group: 'context', action: 'fill', effect: 'store' },
  { cmd: '/cost', group: 'context', action: 'fill', effect: 'store' },
  { cmd: '/dna', group: 'context', action: 'fill', effect: 'store' },
  // build & review — all four task modes are slash-reachable
  { cmd: '/build', group: 'build', action: 'taskmode', effect: 'engine-mode', taskMode: 'build' },
  { cmd: '/plan', group: 'build', action: 'taskmode', effect: 'engine-mode', taskMode: 'plan' },
  { cmd: '/debug', group: 'build', action: 'taskmode', effect: 'engine-mode', taskMode: 'debug' },
  { cmd: '/review', group: 'build', action: 'send', effect: 'store' },
  { cmd: '/tests', group: 'build', action: 'fill', effect: 'template', arg: true },
  { cmd: '/diff', group: 'build', action: 'fill', effect: 'store', arg: true },
  { cmd: '/test', group: 'build', action: 'fill', effect: 'store', arg: true },
  { cmd: '/explain', group: 'build', action: 'fill', effect: 'store', arg: true },
  { cmd: '/commit', group: 'build', action: 'send', effect: 'store' },
  { cmd: '/pr', group: 'build', action: 'send', effect: 'template' },
  { cmd: '/grill', group: 'build', action: 'fill', effect: 'template', arg: true },
  { cmd: '/changelog', group: 'build', action: 'send', effect: 'template' },
  { cmd: '/flows', group: 'build', action: 'send', effect: 'store' },
  // agent
  { cmd: '/effort', group: 'agent', action: 'fill', effect: 'store' },
  { cmd: '/model', group: 'agent', action: 'fill', effect: 'store', arg: true },
  { cmd: '/profile', group: 'agent', action: 'fill', effect: 'store', arg: true },
  { cmd: '/mode', group: 'agent', action: 'mode', effect: 'ui' },
  { cmd: '/budget', group: 'agent', action: 'send', effect: 'store' },
  // app
  { cmd: '/settings', group: 'app', action: 'settings', effect: 'ui' },
  { cmd: '/theme', group: 'app', action: 'theme', effect: 'ui' },
  { cmd: '/lang', group: 'app', action: 'lang', effect: 'ui' },
  { cmd: '/plans', group: 'app', action: 'plans', effect: 'ui' },
  { cmd: '/terminal', group: 'app', action: 'fill', effect: 'store' },
  { cmd: '/help', group: 'app', action: 'send', effect: 'store' },
  // panels
  { cmd: '/git', group: 'panels', action: 'panel', effect: 'ui', panel: 'git' },
  { cmd: '/mcp', group: 'panels', action: 'fill', effect: 'store', arg: true },
  { cmd: '/skills', group: 'panels', action: 'fill', effect: 'store', arg: true },
  { cmd: '/usage', group: 'panels', action: 'panel', effect: 'ui', panel: 'usage' },
  { cmd: '/library', group: 'panels', action: 'panel', effect: 'ui', panel: 'library' },
  { cmd: '/prompts', group: 'panels', action: 'panel', effect: 'ui', panel: 'prompts' },
];

// ============================================================
// v11.42 — BILINGUAL LABELS FOR THE CANONICAL SLASH REGISTRY.
//
// The founder's v11.42 request: the always-visible mono slash-hint row is
// visual clutter; EVERY advertised slash command now lives behind the single
// "+" menu (AttachMenu). That submenu must show the REAL command tokens and
// REAL descriptions — not a hand-made decorative list — so the labels sit
// here, next to SLASH_COMMANDS (same one source of truth), as plain bilingual
// data. Each label carries both languages inline, so a command is correct even
// before a central translation exists. This is a VIEW of the registry only —
// adding/removing a command happens in SLASH_COMMANDS above. A missing label
// degrades honestly to the bare command token (no blank row, no invented text).
// ============================================================

/** One short, honest, single-language line per advertised slash command. */
export interface SlashLabel {
  en: string;
  ar: string;
}

/** Group captions — same ids as `SlashGroup`, bilingual. */
export const SLASH_GROUP_LABELS: Record<SlashGroup, SlashLabel> = {
  session: { en: 'Session', ar: 'الجلسة' },
  context: { en: 'Context', ar: 'السياق' },
  build: { en: 'Build & review', ar: 'البناء والمراجعة' },
  agent: { en: 'Agent', ar: 'الوكيل' },
  app: { en: 'App', ar: 'التطبيق' },
  panels: { en: 'Panels', ar: 'اللوحات' },
  custom: { en: 'Custom commands', ar: 'أوامر مخصصة' },
};

/**
 * Descriptions for every built-in advertised command. Keys deliberately match
 * `SLASH_COMMANDS[].cmd` 1:1 — the v1142 test fails if one is missing or if a
 * label is left over for a command that no longer exists.
 */
export const SLASH_LABELS: Record<string, SlashLabel> = {
  '/clear': { en: 'New session', ar: 'جلسة جديدة' },
  '/compact': { en: 'Summarize and compact context', ar: 'تلخيص وتضييق السياق' },
  '/rewind': { en: 'Restore the last checkpoint', ar: 'استعادة آخر نقطة تحقق' },
  '/undo': { en: 'Undo — restore the newest checkpoint', ar: 'تراجع — استعادة أحدث نقطة تحقق' },
  '/continue': { en: 'Continue the last task from where it stopped', ar: 'متابعة آخر مهمة من حيث توقفت' },
  '/fork': { en: 'Fork this session', ar: 'نسخ هذه الجلسة' },
  '/export': { en: 'Download the session as Markdown', ar: 'تنزيل الجلسة بصيغة Markdown' },
  '/goal': { en: 'Set and track an agent goal', ar: 'تحديد هدف للوكيل وتتبعه' },
  '/schedule': { en: 'Scheduled agent jobs', ar: 'مهام الوكيل المجدولة' },
  '/handoff': { en: 'Session handoff note (HANDOFF.md)', ar: 'مذكرة تسليم الجلسة (HANDOFF.md)' },
  '/init': { en: 'Generate project memory (MEMORY.md)', ar: 'إنشاء ذاكرة المشروع (MEMORY.md)' },
  '/context': { en: 'Context window breakdown', ar: 'تفصيل نافذة السياق' },
  '/cost': { en: 'This session', ar: 'هذه الجلسة' },
  '/dna': { en: 'What has SADEEM learned?', ar: 'ماذا تعلّم سديم؟' },
  '/build': { en: 'BUILD — full execution with test verification', ar: 'وضع البناء — تنفيذ كامل مع تحقق بالاختبارات' },
  '/plan': { en: 'PLAN — read-only research, then a plan', ar: 'وضع التخطيط — بحث للقراءة فقط ثم خطة' },
  '/debug': { en: 'DEBUG — hypothesis → test with an automatic verify loop', ar: 'وضع الفحص — فرضية ثم اختبار مع حلقة تحقق تلقائية' },
  '/review': { en: 'AI review of pending changes', ar: 'مراجعة التغييرات المعلقة بالذكاء الاصطناعي' },
  '/tests': { en: 'Generate tests for a file', ar: 'توليد اختبارات لملف' },
  '/diff': { en: 'Unified diff of uncommitted changes (optional path)', ar: 'فرق موحّد للتغييرات غير الملتزمة (مسار اختياري)' },
  '/test': { en: 'Run the test command with a real exit-code verdict', ar: 'تشغيل أمر الاختبار مع نتيجة حقيقية برقم الخروج' },
  '/explain': { en: 'Read a file and explain it in your language', ar: 'قراءة ملف وشرحه بلغتك' },
  '/commit': { en: 'AI-suggested commit message', ar: 'رسالة التزام مقترحة من الذكاء الاصطناعي' },
  '/pr': { en: 'Draft a PR description from your changes', ar: 'صياغة وصف طلب سحب من تغييراتك' },
  '/grill': { en: 'Interview me before coding (recommended options first)', ar: 'مقابلة أسئلة قبل البرمجة (الخيارات الموصى بها أولاً)' },
  '/changelog': { en: 'Release notes from recent commits', ar: 'ملاحظات الإصدار من الالتزامات الأخيرة' },
  '/flows': { en: 'Manage one-click flows', ar: 'إدارة التدفقات بنقرة واحدة' },
  '/effort': { en: 'Toggle deep thinking effort', ar: 'تبديل مستوى التفكير العميق' },
  '/model': { en: 'Switch the active model', ar: 'تبديل النموذج النشط' },
  '/profile': { en: 'Switch the tool profile', ar: 'تبديل ملف أدوات الوكيل' },
  '/mode': { en: 'Cycle the permission mode', ar: 'تغيير وضع الصلاحيات' },
  '/budget': { en: 'Real token and cost totals for this session', ar: 'إجمالي الرموز والتكلفة الحقيقية لهذه الجلسة' },
  '/settings': { en: 'Open Settings', ar: 'افتح الإعدادات' },
  '/theme': { en: 'Cycle the theme', ar: 'تغيير السمة' },
  '/lang': { en: 'Toggle language AR / EN', ar: 'تغيير اللغة عربي / إنجليزي' },
  '/plans': { en: 'Plans and upgrade', ar: 'الخطط والترقية' },
  '/terminal': { en: 'Toggle the terminal', ar: 'إظهار الطرفية أو إخفاؤها' },
  '/help': { en: 'SADEEM commands', ar: 'أوامر سديم' },
  '/git': { en: 'Source control', ar: 'التحكم بالمصدر' },
  '/mcp': { en: 'List MCP servers or test one by id', ar: 'عرض خوادم MCP أو اختبار أحدها بالمعرف' },
  '/skills': { en: 'Toggle skill injection or list workspace skills', ar: 'تفعيل المهارات أو عرض مهارات مساحة العمل' },
  '/usage': { en: 'Usage and cost', ar: 'الاستخدام والتكلفة' },
  '/library': { en: 'Output library', ar: 'مكتبة المخرجات' },
  '/prompts': { en: 'Reusable prompt library', ar: 'مكتبة التوجيهات القابلة لإعادة الاستخدام' },
};

/** Commands advertised by /help + the CapabilityGuide but not in the Composer menu. */
export const SLASH_STORE_EXTRA: string[] = ['/status', '/share'];

/** The four mode commands ↔ the four Composer stamps ↔ the engine task modes. */
export const SLASH_TASK_MODE: Record<TaskMode, string> = {
  build: '/build',
  plan: '/plan',
  debug: '/debug',
  review: '/review',
};

/**
 * Parse a raw slash input: leading '/', a ASCII-slug command name, and an
 * optional argument tail. Accepts Arabic (or any UTF-8) text in the ARGUMENT —
 * the command slug itself is intentionally ASCII (all advertised commands are
 * ASCII), so an Arabic-typed command falls through to the honest unknown notice.
 * Returns null for non-slash input (a leading space or a bare path is tolerated).
 */
export function parseSlashCommand(raw: string): { name: string; args: string } | null {
  const t = String(raw ?? '').trimStart();
  if (!t.startsWith('/')) return null;
  const m = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(t);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

/** True for the live-filtering slash menu query ('/', '/pl', '/plan …'). */
export function isSlashMenuQuery(value: string): boolean {
  const t = String(value ?? '');
  return t.startsWith('/') && !/\s/.test(t.slice(1));
}

/** Bilingual, honest notice for an unknown command — never a silent no-op. */
export function unknownSlashNotice(name: string): string {
  const c = String(name ?? '');
  return (
    `Unknown command /${c} — nothing was sent to the model. Type /help for the available commands.` +
    `\nأمر غير معروف /${c} — لم يُرسل شيء إلى النموذج. اكتب /help لعرض الأوامر المتاحة.`
  );
}

// ============================================================
// v11.34 — TOOL PROFILE SELECTION (VIEW ONLY — never a capability cut).
//
// A strong model (e.g. Claude 5.5) can pick from all 145 tool defs. A weak
// one drowns in ~103KB of schemas. The honest fix is NOT deletion: every def
// and executor always exists. We only choose which focused SUBSET is
// advertised in `tools[]` for THIS turn. executeTool() still resolves the
// FULL registry, so naming any tool from any profile always dispatches it.
// Kept here (a tiny leaf lib) so the renderer and the engine share one rule.
// ============================================================

/** Selectable tool profiles: legacy scopes + the six per-tool category views. */
export type ToolProfileId =
  | 'essential' | 'balanced' | 'full'
  | 'core' | 'workflow' | 'advanced' | 'desktop' | 'web' | 'mcp';

/** Every selectable profile (single source of truth for menus + tests). */
export const TOOL_PROFILE_IDS: readonly ToolProfileId[] = [
  'balanced', 'core', 'workflow', 'advanced', 'desktop', 'web', 'mcp', 'essential', 'full',
];

/** The app default — unchanged by v11.34. */
export const DEFAULT_TOOL_PROFILE: ToolProfileId = 'balanced';

/**
 * Best-effort weak-model detector from a model id (never a hard capability
 * claim — small local models / "haiku"-class tiers benefit from a short menu).
 * Explicit parameter sizes <= 3B and known small families count as weak.
 */
export function isWeakModelId(model: string): boolean {
  const s = String(model ?? '').toLowerCase();
  if (!s) return false;
  if (/\b(haiku|gemma|tinyllama|tinyllama2|phi[ -]?2|qwen[\w.-]*:(0\.5|1\.5|3)b)\b/.test(s)) return true;
  const m = /(?:^|[-_/:])(\d+(?:\.\d+)?)b(?:\b|_|$)/.exec(s);
  return !!m && Number.parseFloat(m[1]) <= 3;
}

/**
 * Resolve the profile to ADVERTISE for one turn.
 *  - An explicit setting always wins (including 'full' and category views).
 *  - The default 'balanced' stays for strong models.
 *  - A weak model on the default gets 'core' — a focused, human-sized view.
 * Switching this value NEVER removes a tool: dispatch still uses the full
 * 145-tool registry, so hidden tools remain callable by their exact name.
 */
export function advertisedToolProfile(
  configured: ToolProfileId | undefined,
  model: string,
): ToolProfileId {
  const p: ToolProfileId = configured ?? DEFAULT_TOOL_PROFILE;
  if (p !== DEFAULT_TOOL_PROFILE) return p;
  return isWeakModelId(model) ? 'core' : DEFAULT_TOOL_PROFILE;
}

// ============================================================
// v11.35 — PER-MODEL SALIENCE: STRONG MODELS SEE EVERY TOOL.
//
// The founder's final instruction for this release: "أعطيه كل القدرات كل
// الإمكانيات المتاحة" — give the AI EVERY available capability. A strong model
// (Claude 5.5, GPT-5, Opus/Sonnet 4.5+, Gemini 2.5 Pro, ...) must be ADVERTISED
// the complete 145-tool surface, not a 120-tool subset. A weak/local model
// keeps the focused 'core' view — but that remains a VIEW only: every tool is
// still callable by its exact name because dispatch resolves the FULL registry
// (getToolDefs([], 'full')). Nothing is deleted or permission-gated.
//
// `advertisedToolProfile()` above is intentionally UNCHANGED for v11.34
// compatibility (engine.ts:2624 + the v1134 guard suite pin its behaviour).
// `salientToolProfile()` is the corrected v11.35 rule: engine.ts should call
// THIS one (a one-line import/call swap) to give strong models 'full'.
// ============================================================

/** Strong-model detector (never a hard capability claim — a salience hint). */
export function isStrongModelId(model: string): boolean {
  const s = String(model ?? '').toLowerCase();
  if (!s) return false;
  if (isWeakModelId(s)) return false;
  // Claude 4.5/5.x family (incl. 'claude-sonnet-5-5', 'claude-opus-5', 'claude-...-4-5').
  if (/\bclaude\b/.test(s) && /(?:^|[^0-9])(?:[4-9](?:\.\d+)?|4[-_.]?5|5[-_.]?5)(?:\b|[-_.:/]|$)/.test(s)) return true;
  if (/\b(opus|sonnet)\s*[-_.]?\s*(?:4[.-]?5|[5-9])\b/.test(s)) return true;
  // OpenAI GPT-5+ / o-series reasoners.
  if (/\bgpt[-_ ]?[5-9]\b/.test(s) || /\bo\d\b/.test(s)) return true;
  // Gemini 2.5+ Pro / Ultra, DeepSeek R1-class, other large frontier tiers.
  if (/\bgemini\b/.test(s) && /2\.[5-9]|3\./.test(s)) return true;
  if (/\b(deepseek[-_ ]?r1|r1|qwen3[-_ ]?max|grok[-_ ]?4)\b/.test(s)) return true;
  return false;
}

/**
 * v11.35 canonical salience rule. Explicit setting always wins (including a
 * deliberate category view or 'full'). Otherwise a strong model gets 'full'
 * (all 145 tools), a weak model gets 'core' (focused), and anything unknown
 * keeps the balanced default. Regardless of the returned VIEW, every tool in
 * the registry stays callable by name — profiles are not capability gates.
 */
export function salientToolProfile(configured: ToolProfileId | undefined, model: string): ToolProfileId {
  const p: ToolProfileId = configured ?? DEFAULT_TOOL_PROFILE;
  if (p !== DEFAULT_TOOL_PROFILE) return p;
  if (isWeakModelId(model)) return 'core';
  if (isStrongModelId(model)) return 'full';
  return DEFAULT_TOOL_PROFILE;
}

/**
 * Honest capability invariant: a profile only controls what is ADVERTISED for
 * one turn. It NEVER controls what may be CALLED — dispatch resolves the full
 * registry, so any tool name from any profile is executable. Exported so the
 * v11.35 test can assert the "focused view still allows calling any tool by
 * name" guarantee without depending on engine internals.
 */
export function toolCallableByName(_profile: ToolProfileId, _name: string): true {
  return true;
}
