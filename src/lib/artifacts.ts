// ============================================================
// SADEEM v5 — Artifacts Hub (مركز الأدلة)
// Derives verifiable PROOF from a session's own transcript:
// the plan, the todo checklist, files touched, commands run,
// documents made, screenshots the agent took, and the final
// walkthrough — then renders a self-contained shareable HTML
// proof page (RTL-safe, bilingual chrome, zero dependencies).
// Pure functions — unit-testable without Electron.
// ============================================================
import type { ChatMessage, TodoItem } from '../../shared/types';

export interface ArtifactStats {
  edits: number;
  commands: number;
  documents: number;
  screenshots: number;
  mcpCalls: number;
}

export interface ArtifactReport {
  sessionId: string;
  title: string;
  dateIso: string;
  model: string;
  stats: ArtifactStats;
  filesTouched: string[];
  plan: string | null;
  todos: { content: string; status: TodoItem['status'] }[];
  walkthrough: string | null;
  screenshots: { label: string; dataUrl: string }[];
}

const EDIT_TOOLS = new Set(['edit_file', 'multi_edit', 'write_file', 'create_file', 'notebook_edit']);
const CMD_TOOLS = new Set(['run_command', 'run_background']);
const DOC_TOOLS = new Set(['make_document']);
const SHOT_TOOLS = new Set(['preview_screenshot', 'screenshot', 'read_image']);
const STOP_TOOLS = new Set(['stop_process', 'process_output', 'process_list', 'process_kill']);

interface ToolCallMsg extends ChatMessage {
  kind: 'tool_call';
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isToolCall(m: ChatMessage): m is ToolCallMsg {
  return m.kind === 'tool_call' && !!m.toolName;
}

/** Normalize a path arg to a short, workspace-relative-looking display. */
function shortPath(p: unknown): string {
  const s = String(p ?? '').trim();
  if (!s) return '';
  return s.replace(/\\/g, '/');
}

/** Derive the proof report from a session transcript. */
export function deriveArtifacts(
  messages: ChatMessage[],
  opts: { sessionId: string; title: string; model?: string; todos?: TodoItem[] },
): ArtifactReport {
  const stats: ArtifactStats = { edits: 0, commands: 0, documents: 0, screenshots: 0, mcpCalls: 0 };
  const files = new Set<string>();
  const screenshots: { label: string; dataUrl: string }[] = [];
  const callsById = new Map<string, ToolCallMsg>();

  for (const m of messages) {
    if (isToolCall(m)) {
      callsById.set(m.toolCallId ?? m.id, m);
      const name = m.toolName!;
      if (EDIT_TOOLS.has(name)) {
        stats.edits++;
        const p = shortPath(parseToolArgs(m.content).path);
        if (p) files.add(p);
      } else if (CMD_TOOLS.has(name)) stats.commands++;
      else if (DOC_TOOLS.has(name)) {
        stats.documents++;
        const p = shortPath(parseToolArgs(m.content).path);
        if (p) files.add(p);
      } else if (name.startsWith('mcp__')) stats.mcpCalls++;
      continue;
    }
    if (m.kind === 'tool_result' && m.toolCallId) {
      const call = callsById.get(m.toolCallId);
      const name = call?.toolName ?? '';
      if (SHOT_TOOLS.has(name) && m.resultOk !== false && m.images?.length) {
        stats.screenshots++;
        if (screenshots.length < 6) {
          screenshots.push({
            label: name === 'screenshot' ? 'screen' : 'preview',
            dataUrl: m.images[0],
          });
        }
      }
      continue;
    }
  }

  // walkthrough = last substantial assistant text
  let walkthrough: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.kind !== 'tool_call' && m.kind !== 'tool_result' && (m.content ?? '').trim().length >= 120) {
      walkthrough = m.content.trim();
      break;
    }
  }

  return {
    sessionId: opts.sessionId,
    title: opts.title,
    dateIso: new Date().toISOString(),
    model: opts.model ?? '',
    stats,
    filesTouched: [...files].slice(0, 60),
    plan: null, // filled by the panel from the live plan card when present
    todos: (opts.todos ?? []).map((t) => ({ content: t.content, status: t.status })),
    walkthrough,
    screenshots,
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const L = {
  ar: {
    proof: 'دليل التنفيذ',
    generatedBy: 'أُنتج آلياً بواسطة سديم',
    summary: 'الملخص',
    edits: 'تعديل ملف',
    commands: 'أمر تنفيذ',
    documents: 'مستند',
    screenshots: 'لقطة شاشة',
    mcp: 'أداة MCP',
    checklist: 'قائمة المهام',
    done: 'مكتملة',
    progress: 'قيد التنفيذ',
    pending: 'معلّقة',
    walkthrough: 'جولة الختام (من الوكيل)',
    files: 'الملفات التي تم لمسها',
    shots: 'لقطات التحقق',
    none: 'لا يوجد',
    footer: 'صفحة أدلة مولّدة محلياً — كل عنصر هنا مستخرج من سجل جلسة حقيقية.',
  },
  en: {
    proof: 'Proof of Work',
    generatedBy: 'Generated autonomously by SADEEM',
    summary: 'Summary',
    edits: 'file edits',
    commands: 'commands',
    documents: 'documents',
    screenshots: 'screenshots',
    mcp: 'MCP calls',
    checklist: 'Task checklist',
    done: 'done',
    progress: 'in progress',
    pending: 'pending',
    walkthrough: 'Final walkthrough (from the agent)',
    files: 'Files touched',
    shots: 'Verification screenshots',
    none: 'none',
    footer: 'Locally generated proof page — every item is extracted from a real session transcript.',
  },
};

/** Render the self-contained proof page (bilingual chrome, RTL-safe). */
export function buildProofHtml(report: ArtifactReport, lang: 'ar' | 'en'): string {
  const t = L[lang];
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const done = report.todos.filter((x) => x.status === 'completed').length;
  const stat = (n: number, label: string) =>
    `<div class="stat"><b>${n}</b><span>${label}</span></div>`;

  const todosHtml = report.todos.length
    ? `<section><h2>${t.checklist} <small>${done}/${report.todos.length}</small></h2><ul class="todos">${report.todos
        .map(
          (td) =>
            `<li class="${td.status}"><span class="box">${td.status === 'completed' ? '✓' : ''}</span> ${esc(td.content)}</li>`,
        )
        .join('')}</ul></section>`
    : '';

  const filesHtml = report.filesTouched.length
    ? `<section><h2>${t.files}</h2><ul class="files">${report.filesTouched.map((f) => `<li dir="ltr">${esc(f)}</li>`).join('')}</ul></section>`
    : '';

  const shotsHtml = report.screenshots.length
    ? `<section><h2>${t.shots}</h2><div class="shots">${report.screenshots
        .map((s) => `<figure><img src="${s.dataUrl}" alt="${esc(s.label)}"/><figcaption>${esc(s.label)}</figcaption></figure>`)
        .join('')}</div></section>`
    : '';

  const walkHtml = report.walkthrough
    ? `<section><h2>${t.walkthrough}</h2><div class="walk">${report.walkthrough
        .split('\n')
        .map((l) => esc(l))
        .join('<br/>')}</div></section>`
    : '';

  const dateStr = report.dateIso.slice(0, 10);

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(report.title)} — ${t.proof}</title>
<style>
  :root { --ink:#26251f; --dim:#67655a; --line:rgba(30,29,24,.12); --acc:#5f7a38; --bg:#fbfaf7; --card:#ffffff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.8 ${rtl ? "'Cairo','Inter'" : "'Inter','Cairo'"},system-ui,sans-serif; }
  .page { max-width:860px; margin:0 auto; padding:48px 28px 64px; }
  header { border-bottom:2px solid var(--ink); padding-bottom:20px; margin-bottom:26px; }
  h1 { font-size:26px; margin:0 0 6px; }
  .meta { color:var(--dim); font-size:13px; }
  .meta b { color:var(--acc); }
  .stats { display:flex; flex-wrap:wrap; gap:10px; margin:22px 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 18px; min-width:104px; }
  .stat b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
  .stat span { font-size:12px; color:var(--dim); }
  section { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin:14px 0; }
  h2 { font-size:15px; margin:0 0 10px; }
  h2 small { color:var(--dim); font-weight:600; }
  ul { margin:0; padding:0; list-style:none; }
  .todos li { padding:4px 0; display:flex; gap:8px; align-items:baseline; }
  .todos .box { display:inline-flex; width:16px; height:16px; border:1.5px solid var(--line); border-radius:5px;
    align-items:center; justify-content:center; font-size:11px; color:#fff; flex:none; }
  .todos li.completed .box { background:var(--acc); border-color:var(--acc); }
  .todos li.completed { color:var(--dim); }
  .files li { font:12.5px/1.9 ui-monospace,Consolas,monospace; color:var(--dim); }
  .shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
  .shots img { width:100%; border:1px solid var(--line); border-radius:10px; display:block; }
  figcaption { font-size:11px; color:var(--dim); text-align:center; padding-top:4px; }
  .walk { white-space:pre-wrap; font-size:13.5px; color:var(--ink); }
  footer { margin-top:26px; color:var(--dim); font-size:11.5px; border-top:1px solid var(--line); padding-top:12px; }
</style>
</head>
<body>
<div class="page">
  <header>
    <h1>${esc(report.title)}</h1>
    <div class="meta">${t.proof} · <b>${dateStr}</b>${report.model ? ` · ${esc(report.model)}` : ''} · ${t.generatedBy}</div>
  </header>
  <div class="stats">
    ${stat(report.stats.edits, t.edits)}
    ${stat(report.stats.commands, t.commands)}
    ${stat(report.stats.documents, t.documents)}
    ${stat(report.stats.screenshots, t.screenshots)}
    ${stat(report.stats.mcpCalls, t.mcp)}
  </div>
  ${todosHtml}
  ${walkHtml}
  ${shotsHtml}
  ${filesHtml}
  <footer>${t.footer}</footer>
</div>
</body>
</html>`;
}
