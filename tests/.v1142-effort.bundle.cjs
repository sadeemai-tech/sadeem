var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// <stdin>
var stdin_exports = {};
__export(stdin_exports, {
  EffortControl: () => EffortControl,
  ReasoningSlider: () => ReasoningSlider,
  useStore: () => useStore
});
module.exports = __toCommonJS(stdin_exports);

// src/components/EffortControl.tsx
var import_react2 = require("react");

// src/store.ts
var import_zustand = require("zustand");

// shared/types.ts
var MAX_SUBAGENTS_DEFAULT = 64;
var MAX_SUBAGENTS_MIN = 1;
var MAX_SUBAGENTS_CEILING = 64;
function clampMaxSubagents(v) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return MAX_SUBAGENTS_DEFAULT;
  return Math.max(MAX_SUBAGENTS_MIN, Math.min(MAX_SUBAGENTS_CEILING, Math.floor(n)));
}

// src/lib/api.ts
var api = typeof window !== "undefined" ? window.surnia ?? window.kodex ?? {} : {};

// src/lib/ctx.ts
function ctxFillTokens(u) {
  if (!u) return 0;
  return Math.max(0, (u.inputTokens ?? 0) + (u.outputTokens ?? 0));
}
var COMPACT_TRIGGER_RATIO = 0.9;
function compactionThresholdTokens(ctxWindow) {
  if (!Number.isFinite(ctxWindow) || ctxWindow <= 0) return 0;
  return Math.floor(ctxWindow * COMPACT_TRIGGER_RATIO);
}
function isCompactionEligible(fill, ctxWindow) {
  const threshold = compactionThresholdTokens(ctxWindow);
  if (threshold <= 0) return false;
  return Math.max(0, fill) >= threshold;
}
function accumulateUsage(prev, delta) {
  const p = prev ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    inputTokens: (p.inputTokens ?? 0) + (delta.inputTokens ?? 0),
    outputTokens: (p.outputTokens ?? 0) + (delta.outputTokens ?? 0),
    costUsd: Math.round(((p.costUsd ?? 0) + (delta.costUsd ?? 0)) * 1e6) / 1e6,
    cacheReadTokens: (p.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
    cacheCreationTokens: (p.cacheCreationTokens ?? 0) + (delta.cacheCreationTokens ?? 0),
    attempts: [...p.attempts ?? [], ...delta.attempts ?? []]
  };
}
function emptySessionUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    attempts: []
  };
}
function runUsageView(u) {
  if (!u) return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const attempts = u.attempts ?? [];
  return {
    inputTokens: u.runInput ?? u.inputTokens,
    outputTokens: u.runOutput ?? u.outputTokens,
    costUsd: u.runCost ?? u.costUsd,
    cacheReadTokens: u.runCacheRead ?? u.cacheReadTokens,
    cacheCreationTokens: u.runCacheCreation ?? u.cacheCreationTokens,
    estimated: u.estimated === true || attempts.some((a) => a.estimated === true) || void 0,
    attempts: attempts.length ? attempts : void 0
  };
}

// src/lib/usage.ts
function attachTurnUsage(msgs, usage) {
  let lastAssistant = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && (m.kind ?? "text") === "text") {
      lastAssistant = i;
      break;
    }
  }
  if (lastAssistant >= 0) {
    msgs[lastAssistant] = { ...msgs[lastAssistant], usage };
    return lastAssistant;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].kind === "tool_call") {
      msgs[i] = { ...msgs[i], usage };
      return i;
    }
  }
  msgs.push({
    id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    role: "assistant",
    kind: "text",
    content: "",
    timestamp: Date.now(),
    usage
  });
  return msgs.length - 1;
}

// src/lib/providerSlice.ts
function providerHasCredentials(entry, preset) {
  if (!entry) return preset?.keyless === true;
  if (preset?.keyless) return true;
  if (typeof entry.apiKey === "string" && entry.apiKey.trim() !== "") return true;
  if (typeof entry.baseUrl === "string" && entry.baseUrl.trim() !== "") return true;
  return false;
}
function providerModelIds(entry, presetModels = []) {
  const clean = (xs) => Array.isArray(xs) ? xs.filter((m) => typeof m === "string" && m.trim() !== "") : [];
  const live = clean(entry?.lastModels);
  if (live.length) return live;
  const legacy = clean(entry?.models);
  if (legacy.length) return legacy;
  return clean(presetModels);
}

// src/lib/modes.ts
var PERMISSION_MODES = ["plan", "default", "autoEdit", "fullAccess"];
function nextIn(order, cur) {
  const i = order.indexOf(cur);
  return order[(i + 1) % order.length] ?? order[0];
}
function deriveToolScope(command) {
  const raw = String(command ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const head = raw.split(/(?:&&|\|\||;|\|)/)[0].trim();
  if (!head) return "";
  const toks = head.split(" ").filter(Boolean);
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  const tool = toks[i] ?? "";
  if (!tool || /^[("'`&;|<>*]/.test(tool)) return "";
  return tool;
}
function firstCommandLike(detail) {
  const lines = String(detail ?? "").split("\n");
  for (const l of lines) {
    const t = l.replace(/^\[(cwd[^\]]*)\]\s*/i, "").trim();
    if (t) return t;
  }
  return "";
}

// src/i18n.ts
var D = {
  // app / titlebar
  "app.name": ["SADEEM", "\u0633\u062F\u064A\u0645"],
  "app.tagline": ["AI Coding Workstation", "\u0645\u062D\u0637\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0628\u0631\u0645\u062C\u064A\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "tb.mode.plan": ["Plan", "\u062E\u0637\u0629"],
  "tb.mode.plan.desc": ["Read-only research, then proposes a plan", "\u0642\u0631\u0627\u0621\u0629 \u0648\u0628\u062D\u062B \u0641\u0642\u0637 \u062B\u0645 \u064A\u0642\u062A\u0631\u062D \u062E\u0637\u0629 \u0644\u0644\u062A\u0646\u0641\u064A\u0630"],
  "tb.mode.default": ["Ask", "\u062A\u0623\u0643\u064A\u062F"],
  "tb.mode.autoEdit": ["Auto-edit", "\u062A\u0639\u062F\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A"],
  "tb.mode.fullAccess": ["Full access", "\u0648\u0635\u0648\u0644 \u0643\u0627\u0645\u0644"],
  "tb.mode.default.desc": ["Ask before every write or command", "\u0627\u0637\u0644\u0628 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0642\u0628\u0644 \u0643\u0644 \u062A\u0639\u062F\u064A\u0644 \u0623\u0648 \u0623\u0645\u0631"],
  "tb.mode.autoEdit.desc": ["Auto-approve file edits, ask for commands", "\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0648\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0628\u0627\u0644\u062A\u0623\u0643\u064A\u062F"],
  "tb.mode.fullAccess.desc": [
    "Auto-approve edits & commands \u2014 flagged high-risk commands still ask once",
    "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0639\u0644\u0649 \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0648\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u2014 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0631\u0629 \u062A\u0628\u0642\u0649 \u062A\u0637\u0644\u0628 \u062A\u0623\u0643\u064A\u062F\u0627\u064B \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629"
  ],
  // v11.10 (A4) — REAL task modes (Build/Plan/Debug/Review). Canonical EN+AR
  // strings for the mode behaviors; the engine (slashService dispatch + mode
  // notices) mirrors these texts — single behavior, two languages.
  "mode.build.switched": [
    "Switched to BUILD mode \u2014 full access, apply then verify with tests (persists for this session).",
    "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0628\u0646\u0627\u0621 \u2014 \u062A\u0646\u0641\u064A\u0630 \u0643\u0627\u0645\u0644 \u0645\u0639 \u0627\u0644\u062A\u062D\u0642\u0642 \u0628\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A (\u064A\u0633\u062A\u0645\u0631 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629)."
  ],
  "mode.plan.switched": [
    "Switched to PLAN mode \u2014 read-only: produce the step-by-step plan (plan.md + propose_plan); edits/commands are denied (persists for this session).",
    "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629 \u2014 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637: \u0642\u062F\u0651\u0645 \u062E\u0637\u0629 \u062A\u0646\u0641\u064A\u0630 (plan.md + propose_plan) \u062F\u0648\u0646 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0644\u0641\u0627\u062A (\u064A\u0633\u062A\u0645\u0631 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629)."
  ],
  "mode.debug.switched": [
    "Switched to DEBUG mode \u2014 debugging protocol + automatic post-fix test loop (persists for this session).",
    "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u062A\u0635\u062D\u064A\u062D \u0627\u0644\u0623\u062E\u0637\u0627\u0621 \u2014 \u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u062A\u0634\u062E\u064A\u0635 + \u062D\u0644\u0642\u0629 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0628\u0639\u062F \u0627\u0644\u0625\u0635\u0644\u0627\u062D (\u064A\u0633\u062A\u0645\u0631 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629)."
  ],
  "mode.review.switched": [
    "Switched to REVIEW mode \u2014 read-only review; a structured review report is produced at the end (persists for this session).",
    "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u2014 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637 \u0645\u0639 \u062A\u0642\u0631\u064A\u0631 \u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0646\u0638\u0645 \u0641\u064A \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 (\u064A\u0633\u062A\u0645\u0631 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629)."
  ],
  "mode.plan.nextStep": [
    "Plan ready \u2014 switch to BUILD mode (/build or the mode strip) to implement it.",
    "\u0627\u0644\u062E\u0637\u0629 \u062C\u0627\u0647\u0632\u0629 \u2014 \u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0628\u0646\u0627\u0621 (\u200E/build \u0623\u0648 \u0634\u0631\u064A\u0637 \u0627\u0644\u0623\u0648\u0636\u0627\u0639) \u0644\u062A\u0646\u0641\u064A\u0630\u0647\u0627."
  ],
  "slash.unknown": [
    'Unknown command /{cmd} \u2014 nothing was sent to the model. Type /help for the available commands. If you meant a file path, drop the leading "/" or rephrase.',
    "\u0623\u0645\u0631 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641 /{cmd} \u2014 \u0644\u0645 \u064A\u064F\u0631\u0633\u0644 \u0634\u064A\u0621 \u0625\u0644\u0649 \u0627\u0644\u0646\u0645\u0648\u0630\u062C. \u0627\u0643\u062A\u0628 /help \u0644\u0639\u0631\u0636 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0645\u062A\u0627\u062D\u0629. \u0625\u0646 \u0643\u0627\u0646 \u0627\u0644\u0645\u0642\u0635\u0648\u062F \u0645\u0633\u0627\u0631 \u0645\u0644\u0641 \u0641\u0627\u062D\u0630\u0641 \u0627\u0644\u0634\u0631\u0637\u0629 \u0627\u0644\u0645\u0627\u0626\u0644\u0629 \u0623\u0648 \u0623\u0639\u062F \u0627\u0644\u0635\u064A\u0627\u063A\u0629."
  ],
  // plan card
  "chat.plan.title": ["Plan ready", "\u0627\u0644\u062E\u0637\u0629 \u062C\u0627\u0647\u0632\u0629"],
  "chat.plan.hint": [
    "The agent researched the request and proposes this plan. Executing switches to Auto-edit and implements it.",
    "\u0628\u062D\u062B \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0637\u0644\u0628 \u0648\u0627\u0642\u062A\u0631\u062D \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0629. \u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u064A\u0628\u062F\u0651\u0644 \u0625\u0644\u0649 \u0627\u0644\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A \u0648\u064A\u0646\u0641\u0651\u0630\u0647\u0627 \u062E\u0637\u0648\u0629 \u0628\u062E\u0637\u0648\u0629."
  ],
  "chat.plan.execute": ["Execute plan", "\u0646\u0641\u0651\u0630 \u0627\u0644\u062E\u0637\u0629"],
  "chat.plan.dismiss": ["Dismiss", "\u062A\u062C\u0627\u0647\u0644"],
  // rail
  "rail.workspace": ["Workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "rail.sessions": ["Sessions", "\u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "rail.git": ["Source control", "\u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631"],
  "rail.mcp": ["MCP tools", "\u0623\u062F\u0648\u0627\u062A MCP"],
  "rail.usage": ["Usage", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "rail.settings": ["Settings", "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "rail.terminal": ["Toggle terminal", "\u0625\u0638\u0647\u0627\u0631/\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "rail.plans": ["Plans & upgrade", "\u0627\u0644\u062E\u0637\u0637 \u0648\u0627\u0644\u062A\u0631\u0642\u064A\u0629"],
  "rail.preview": ["Live preview", "\u0645\u0639\u0627\u064A\u0646\u0629 \u062D\u064A\u0651\u0629"],
  // live preview
  "preview.title": ["Preview", "\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "preview.urlPlaceholder": ["http://127.0.0.1:5173", "http://127.0.0.1:5173"],
  "preview.reload": ["Reload", "\u062A\u062D\u062F\u064A\u062B"],
  "preview.external": ["Open in browser", "\u0627\u0641\u062A\u062D \u0641\u064A \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  "preview.device.full": ["Full width", "\u0639\u0631\u0636 \u0643\u0627\u0645\u0644"],
  "preview.device.tablet": ["Tablet 820px", "\u0644\u0648\u062D\u064A 820\u0628\u0643\u0633\u0644"],
  "preview.device.mobile": ["Mobile 400px", "\u0647\u0627\u062A\u0641 400\u0628\u0643\u0633\u0644"],
  "preview.serveStatic": ["Serve static", "\u062E\u062F\u0645\u0629 \u062B\u0627\u0628\u062A\u0629"],
  "preview.staticHint": ["Serve the workspace as a static site (index.html or dist/)", "\u0642\u062F\u0651\u0645 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0643\u0645\u0648\u0642\u0639 \u062B\u0627\u0628\u062A (index.html \u0623\u0648 dist/)"],
  "preview.runDev": ["Run dev server", "\u0634\u063A\u0651\u0644 \u062E\u0627\u062F\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631"],
  "preview.devHint": ["Run the project dev script and auto-detect its URL", "\u0634\u063A\u0651\u0644 \u0633\u0643\u0631\u0628\u062A \u0627\u0644\u062A\u0637\u0648\u064A\u0631 \u0648\u0627\u0643\u062A\u0634\u0641 \u0627\u0644\u0631\u0627\u0628\u0637 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "preview.stopDev": ["Stop dev", "\u0623\u0648\u0642\u0641 \u0627\u0644\u062E\u0627\u062F\u0645"],
  "preview.openPort": ["Preview this local server", "\u0639\u0627\u064A\u0646 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0627\u0644\u0645\u062D\u0644\u064A"],
  "preview.devLog": ["Dev server output", "\u0645\u062E\u0631\u062C\u0627\u062A \u062E\u0627\u062F\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631"],
  "preview.built": ["Built \u2014 preview ready", "\u062A\u0645 \u0627\u0644\u0628\u0646\u0627\u0621 \u2014 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062C\u0627\u0647\u0632\u0629"],
  "preview.loading": ["Loading preview.", "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629."],
  "preview.failed.hint": ["The page did not respond. Check the causes below, then try again.", "\u0644\u0645 \u062A\u0633\u062A\u062C\u0628 \u0627\u0644\u0635\u0641\u062D\u0629. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0623\u0633\u0628\u0627\u0628 \u0623\u062F\u0646\u0627\u0647 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."],
  "preview.hideErrorDetails": ["Hide error details", "\u0625\u062E\u0641\u0627\u0621 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062E\u0637\u0623"],
  "preview.showErrorDetails": ["Error details", "\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062E\u0637\u0623"],
  "preview.hideDevLog": ["Hide server log", "\u0625\u062E\u0641\u0627\u0621 \u0633\u062C\u0644 \u0627\u0644\u062E\u0627\u062F\u0645"],
  "preview.starting": ["starting", "\u064A\u0628\u062F\u0623 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "preview.failed": ["This page could not be loaded", "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629"],
  "preview.back": ["Back", "\u0631\u062C\u0648\u0639"],
  "preview.emptyTitle": ["See what the agent builds \u2014 live", "\u0634\u0627\u0647\u062F \u0645\u0627 \u064A\u0628\u0646\u064A\u0647 \u0627\u0644\u0648\u0643\u064A\u0644 \u2014 \u0645\u0628\u0627\u0634\u0631\u0629"],
  "preview.emptyBody": [
    "Run a dev server, serve the workspace as a static site, or paste a URL. The agent can also start the preview for you after building an app.",
    "\u0634\u063A\u0651\u0644 \u062E\u0627\u062F\u0645 \u062A\u0637\u0648\u064A\u0631\u060C \u0642\u062F\u0651\u0645 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0643\u0645\u0648\u0642\u0639 \u062B\u0627\u0628\u062A\u060C \u0623\u0648 \u0627\u0644\u0635\u0642 \u0631\u0627\u0628\u0637\u0627\u064B. \u064A\u0645\u0643\u0646 \u0644\u0644\u0648\u0643\u064A\u0644 \u0623\u064A\u0636\u0627\u064B \u0628\u062F\u0621 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0639\u062F \u0628\u0646\u0627\u0621 \u0627\u0644\u062A\u0637\u0628\u064A\u0642."
  ],
  // usage: app performance
  "usage.perf": ["App performance", "\u0623\u062F\u0627\u0621 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "usage.cpu": ["App CPU", "\u0645\u0639\u0627\u0644\u062C \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "usage.ram": ["App memory", "\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "usage.processes": ["Processes", "\u0627\u0644\u0639\u0645\u0644\u064A\u0627\u062A"],
  "usage.hostMem": ["Device memory in use", "\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629"],
  // status bar
  "sb.tokens": ["tokens", "\u0631\u0645\u0632"],
  "sb.cost": ["cost", "\u0627\u0644\u062A\u0643\u0644\u0641\u0629"],
  "sb.branch": ["branch", "\u0627\u0644\u0641\u0631\u0639"],
  "sb.noRepo": ["no git repo", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u062A\u0648\u062F\u0639 git"],
  "sb.model": ["model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  // welcome
  "welcome.title": ["Build at the speed of thought", "\u0627\u0628\u0646\u0650 \u0628\u0633\u0631\u0639\u0629 \u062A\u0641\u0643\u064A\u0631\u0643"],
  "welcome.greet.morning": ["Good morning.", "\u0635\u0628\u0627\u062D \u0627\u0644\u062E\u064A\u0631."],
  "welcome.greet.afternoon": ["Good afternoon.", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631."],
  "welcome.greet.evening": ["Good evening.", "\u0645\u0633\u0627\u0621 \u0627\u0644\u062E\u064A\u0631."],
  "welcome.hint.palette": ["Command palette", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "welcome.hint.sidebar": ["Toggle sidebar", "\u0625\u0638\u0647\u0627\u0631/\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0634\u0631\u064A\u0637 \u0627\u0644\u062C\u0627\u0646\u0628\u064A"],
  "sb.context": ["Context", "\u0627\u0644\u0633\u064A\u0627\u0642"],
  "sb.context.full": ["Context window nearly full \u2014 run /compact to free space", "\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642 \u0634\u0628\u0647 \u0645\u0645\u062A\u0644\u0626\u0629 \u2014 \u0646\u0641\u0651\u0630 \u200E/compact \u0644\u062A\u062D\u0631\u064A\u0631 \u0627\u0644\u0645\u0633\u0627\u062D\u0629"],
  "welcome.sub": [
    "SADEEM is a desktop AI engineer: it reads your project, writes and refactors code, runs commands, and ships \u2014 with your approval at every critical step.",
    "\u0633\u062F\u064A\u0645 \u0645\u0647\u0646\u062F\u0633 \u0628\u0631\u0645\u062C\u064A\u0627\u062A \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u064A\u0639\u0645\u0644 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643: \u064A\u0642\u0631\u0623 \u0645\u0634\u0631\u0648\u0639\u0643\u060C \u064A\u0643\u062A\u0628 \u0627\u0644\u0643\u0648\u062F \u0648\u064A\u0639\u062F\u0651\u0644\u0647\u060C \u064A\u0646\u0641\u0651\u0630 \u0627\u0644\u0623\u0648\u0627\u0645\u0631\u060C \u0648\u064A\u0633\u0644\u0651\u0645 \u0627\u0644\u0639\u0645\u0644 \u2014 \u0628\u0645\u0648\u0627\u0641\u0642\u062A\u0643 \u0641\u064A \u0643\u0644 \u062E\u0637\u0648\u0629 \u062D\u0633\u0627\u0633\u0629."
  ],
  "welcome.open": ["Open folder", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B"],
  "welcome.newSession": ["New agent session", "\u062C\u0644\u0633\u0629 \u0648\u0643\u064A\u0644 \u062C\u062F\u064A\u062F\u0629"],
  "welcome.recent": ["Recent projects", "\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "welcome.noRecent": ["No recent projects yet", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0634\u0627\u0631\u064A\u0639 \u0623\u062E\u064A\u0631\u0629 \u0628\u0639\u062F"],
  "welcome.f1": ["Full agentic loop: read, edit, search, run, verify", "\u062D\u0644\u0642\u0629 \u0648\u0643\u064A\u0644 \u0643\u0627\u0645\u0644\u0629: \u0642\u0631\u0627\u0621\u0629\u060C \u062A\u0639\u062F\u064A\u0644\u060C \u0628\u062D\u062B\u060C \u062A\u0646\u0641\u064A\u0630\u060C \u062A\u062D\u0642\u0642"],
  "welcome.f2": ["Visual diff review for every change", "\u0645\u0631\u0627\u062C\u0639\u0629 \u0628\u0635\u0631\u064A\u0629 \u0644\u0644\u0641\u0631\u0648\u0642\u0627\u062A \u0644\u0643\u0644 \u062A\u063A\u064A\u064A\u0631"],
  "welcome.f3": ["Integrated terminal and git", "\u0637\u0631\u0641\u064A\u0629 \u0648git \u0645\u062F\u0645\u062C\u0627\u0646"],
  "welcome.f4": ["Claude, GPT, Gemini, GLM, DeepSeek, Ollama & more", "\u0643\u0644\u0648\u062F \u0648GPT \u0648\u062C\u064A\u0645\u064A\u0646\u0627\u064A \u0648GLM \u0648\u062F\u064A\u0628\u0633\u064A\u0643 \u0648\u0623\u0648\u0644\u0627\u0645\u0627 \u0648\u0627\u0644\u0645\u0632\u064A\u062F"],
  "welcome.f5": ["MCP tools & subagents", "\u0623\u062F\u0648\u0627\u062A MCP \u0648\u0648\u0643\u0644\u0627\u0621 \u0641\u0631\u0639\u064A\u0648\u0646"],
  "welcome.f6": ["Bilingual interface (AR/EN) with RTL", "\u0648\u0627\u062C\u0647\u0629 \u062B\u0646\u0627\u0626\u064A\u0629 \u0627\u0644\u0644\u063A\u0629 \u0645\u0639 \u062F\u0639\u0645 RTL"],
  // command-center hero (v1.5)
  "welcome.cmdPlaceholder": [
    "Command your agent \u2014 \u201Cbuild a REST API with tests\u201D, \u201Cfind and fix the memory leak\u201D\u2026",
    "\u0627\u0648\u062C\u062F\u0651\u062F \u0648\u0643\u064A\u0644\u0643 \u2014 \xAB\u0627\u0628\u0646\u0650 REST API \u0645\u0639 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A\xBB\u060C \xAB\u0627\u0639\u062B\u0631 \u0639\u0644\u0649 \u062A\u0633\u0631\u064A\u0628 \u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0648\u0623\u0635\u0644\u062D\u0647\xBB\u2026"
  ],
  "welcome.cmdPlaceholderEmpty": [
    "Open a folder, then command your agent from here\u2026",
    "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u062B\u0645 \u0648\u062C\u0651\u0647 \u0648\u0643\u064A\u0644\u0643 \u0645\u0646 \u0647\u0646\u0627\u2026"
  ],
  "welcome.launch": ["Launch", "\u0625\u0637\u0644\u0627\u0642"],
  "welcome.launchHint": ["launch on recent project", "\u064A\u064F\u0637\u0644\u0642 \u0639\u0644\u0649 \u0622\u062E\u0631 \u0645\u0634\u0631\u0648\u0639"],
  "welcome.needFolder": ["Open a folder first \u2014 then command from here.", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B \u062B\u0645 \u0648\u062C\u0651\u0647 \u0648\u0643\u064A\u0644\u0643 \u0645\u0646 \u0647\u0646\u0627."],
  "welcome.noModel": ["No model connected", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0645\u0648\u0630\u062C \u0645\u062A\u0635\u0644"],
  // onboarding
  "onboard.title": ["Welcome to SADEEM", "\u0645\u0631\u062D\u0628\u0627\u064B \u0628\u0643 \u0641\u064A \u0633\u062F\u064A\u0645"],
  "onboard.step": ["Step", "\u062E\u0637\u0648\u0629"],
  "onboard.of": ["of", "\u0645\u0646"],
  // v9.0.0 Aurora — new shell strings (bilingual)
  "tb.searchPh": ["Search or run a command\u2026", "\u0627\u0628\u062D\u062B \u0623\u0648 \u0634\u063A\u0651\u0644 \u0623\u0645\u0631\u0627\u064B\u2026"],
  "onboard.key.ok": ["Provider ready", "\u0627\u0644\u0645\u0632\u0648\u062F \u062C\u0627\u0647\u0632"],
  "onboard.key.missing": ["No key yet \u2014 SADEEM will ask when you first run", "\u0644\u0627 \u0645\u0641\u062A\u0627\u062D \u0628\u0639\u062F \u2014 \u0633\u064A\u0633\u0623\u0644\u0643 \u0633\u062F\u064A\u0645 \u0639\u0646\u062F \u0623\u0648\u0644 \u062A\u0634\u063A\u064A\u0644"],
  "onboard.ws.later": ["Or open one later from the Welcome screen", "\u0623\u0648 \u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0644\u0627\u062D\u0642\u0627\u064B \u0645\u0646 \u0634\u0627\u0634\u0629 \u0627\u0644\u062A\u0631\u062D\u064A\u0628"],
  "onboard.security.sub": ["One posture for approvals, verification and network \u2014 change it anytime in Settings.", "\u0648\u0636\u0639\u064A\u0629 \u0648\u0627\u062D\u062F\u0629 \u0644\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0648\u0627\u0644\u0634\u0628\u0643\u0629 \u2014 \u063A\u064A\u0651\u0631\u0647\u0627 \u0641\u064A \u0623\u064A \u0648\u0642\u062A \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A."],
  "onboard.enter": ["Enter SADEEM", "\u0627\u062F\u062E\u0644 \u0633\u062F\u064A\u0645"],
  "onboard.enter.hint": ["Provider, folder and security can all be changed later in Settings \u2014 Esc exits anytime.", "\u0627\u0644\u0645\u0632\u0648\u062F \u0648\u0627\u0644\u0645\u062C\u0644\u062F \u0648\u0627\u0644\u0623\u0645\u0627\u0646 \u0643\u0644\u0647\u0627 \u062A\u064F\u063A\u064A\u064E\u0651\u0631 \u0644\u0627\u062D\u0642\u0627\u064B \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2014 Esc \u0644\u0644\u062E\u0631\u0648\u062C \u0641\u064A \u0623\u064A \u0648\u0642\u062A."],
  "onboard.lang.title": ["Choose your language", "\u0627\u062E\u062A\u0631 \u0644\u063A\u062A\u0643"],
  "onboard.lang.sub": ["You can change this anytime from the title bar.", "\u064A\u0645\u0643\u0646\u0643 \u062A\u063A\u064A\u064A\u0631\u0647\u0627 \u0641\u064A \u0623\u064A \u0648\u0642\u062A \u0645\u0646 \u0627\u0644\u0634\u0631\u064A\u0637 \u0627\u0644\u0639\u0644\u0648\u064A."],
  "onboard.ws.title": ["Open a project", "\u0627\u0641\u062A\u062D \u0645\u0634\u0631\u0648\u0639\u0627\u064B"],
  "onboard.ws.sub": ["Pick a folder on your machine \u2014 SADEEM works locally on your files.", "\u0627\u062E\u062A\u0631 \u0645\u062C\u0644\u062F\u0627\u064B \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u2014 \u0633\u062F\u064A\u0645 \u064A\u0639\u0645\u0644 \u0645\u062D\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u0645\u0644\u0641\u0627\u062A\u0643."],
  "onboard.ai.title": ["Connect an AI model", "\u0627\u0631\u0628\u0637 \u0646\u0645\u0648\u0630\u062C \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "onboard.ai.sub": ["Bring your own API key \u2014 it is stored locally on your machine only.", "\u0623\u062F\u062E\u0644 \u0645\u0641\u062A\u0627\u062D API \u0627\u0644\u062E\u0627\u0635 \u0628\u0643 \u2014 \u064A\u064F\u062D\u0641\u0638 \u0645\u062D\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0641\u0642\u0637."],
  "onboard.done": ["Start building", "\u0627\u0628\u062F\u0623 \u0627\u0644\u0628\u0646\u0627\u0621"],
  "onboard.skip": ["Skip", "\u062A\u062E\u0637\u064A"],
  "onboard.next": ["Next", "\u0627\u0644\u062A\u0627\u0644\u064A"],
  "onboard.back": ["Back", "\u0627\u0644\u0633\u0627\u0628\u0642"],
  // settings
  "settings.title": ["Settings", "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "settings.general": ["General", "\u0639\u0627\u0645"],
  "settings.providers": ["AI providers", "\u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "settings.permissions": ["Permissions", "\u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "settings.mcp": ["MCP servers", "\u062E\u0648\u0627\u062F\u0645 MCP"],
  "settings.billing": ["Billing", "\u0627\u0644\u0641\u0648\u0627\u062A\u064A\u0631"],
  "settings.about": ["About", "\u062D\u0648\u0644"],
  "settings.language": ["Interface language", "\u0644\u063A\u0629 \u0627\u0644\u0648\u0627\u062C\u0647\u0629"],
  "settings.theme": ["Theme", "\u0627\u0644\u0633\u0645\u0629"],
  "settings.theme.obsidian": ["Dark (secondary)", "\u062F\u0627\u0643\u0646 (\u062C\u0627\u0646\u0628\u064A)"],
  "settings.theme.midnight": ["Deep (secondary)", "\u0639\u0645\u064A\u0642 (\u062C\u0627\u0646\u0628\u064A)"],
  "settings.theme.light": ["Light (primary)", "\u0641\u0627\u062A\u062D (\u0623\u0633\u0627\u0633\u064A)"],
  "settings.fontSize": ["Editor font size", "\u062D\u062C\u0645 \u062E\u0637 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.termFontSize": ["Terminal font size", "\u062D\u062C\u0645 \u062E\u0637 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.autoApproveEdits": ["Auto-approve file edits in this workspace", "\u0645\u0648\u0627\u0641\u0642\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0639\u0644\u0649 \u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629"],
  "settings.checkpoints": ["Create checkpoints before agent edits", "\u0625\u0646\u0634\u0627\u0621 \u0646\u0642\u0627\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0642\u0628\u0644 \u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644"],
  "settings.apiKey": ["API key", "\u0645\u0641\u062A\u0627\u062D API"],
  "settings.baseUrl": ["Base URL (optional)", "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062E\u062F\u0645\u0629 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)"],
  "settings.verify": ["Verify", "\u062A\u062D\u0642\u0642"],
  "settings.verified": ["Connected", "\u0645\u062A\u0635\u0644"],
  "settings.verifyFailed": ["Connection failed", "\u0641\u0634\u0644 \u0627\u0644\u0627\u062A\u0635\u0627\u0644"],
  // v11.10 (A8) — provider enable: field-level errors + honest warnings
  "settings.providers.errKey": ["An API key is required to enable this provider.", "\u0645\u0637\u0644\u0648\u0628 \u0645\u0641\u062A\u0627\u062D API \u0644\u062A\u0641\u0639\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0632\u0648\u0651\u062F."],
  "settings.providers.enableHint": ["Enable \u2014 fetch models and pick a default automatically", "\u062A\u0641\u0639\u064A\u0644 \u2014 \u062C\u0644\u0628 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0648\u0627\u062E\u062A\u064A\u0627\u0631 \u0646\u0645\u0648\u0630\u062C \u0627\u0641\u062A\u0631\u0627\u0636\u064A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.providers.disableHint": ["Enabled \u2014 models are live and the picker can use this provider", "\u0645\u0641\u0639\u0651\u0644 \u2014 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u062C\u0627\u0647\u0632\u0629 \u0648\u064A\u0645\u0643\u0646 \u0644\u0623\u062F\u0627\u0629 \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0647\u0630\u0627 \u0627\u0644\u0645\u0632\u0648\u0651\u062F"],
  "settings.providers.enabled": ["Enabled", "\u0645\u0641\u0639\u0651\u0644"],
  "settings.providers.enabledAuto": ["Provider enabled \u2014 model {m} selected", "\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u2014 \u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C {m}"],
  "settings.providers.enabledWarn": ["Provider enabled \u2014 model list unavailable, curated presets in use", "\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u2014 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629\u060C \u0648\u062A\u064F\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0645\u0639\u062F\u0651\u0629 \u0645\u0633\u0628\u0642\u0627\u064B"],
  "settings.providers.warnModels": ["Model list unavailable right now \u2014 the provider is saved and curated presets are in use. Error:", "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0627\u0644\u0622\u0646 \u2014 \u062A\u0645 \u062D\u0641\u0638 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0648\u062A\u064F\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0645\u0639\u062F\u0651\u0629 \u0645\u0633\u0628\u0642\u0627\u064B. \u0627\u0644\u062E\u0637\u0623:"],
  "settings.keyStored": ["Key saved locally", "\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u062D\u0641\u0648\u0638 \u0645\u062D\u0644\u064A\u0627\u064B"],
  "settings.mode": ["Default permission mode", "\u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A"],
  "settings.mcp.add": ["Add server", "\u0623\u0636\u0641 \u062E\u0627\u062F\u0645\u0627\u064B"],
  "settings.mcp.name": ["Name", "\u0627\u0644\u0627\u0633\u0645"],
  "settings.mcp.command": ["Command", "\u0627\u0644\u0623\u0645\u0631"],
  "settings.mcp.args": ["Arguments (space-separated)", "\u0627\u0644\u0648\u0633\u0627\u0626\u0637 (\u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0645\u0633\u0627\u0641\u0629)"],
  "settings.mcp.test": ["Test", "\u0627\u062E\u062A\u0628\u0627\u0631"],
  "settings.mcp.enabled": ["Enabled", "\u0645\u064F\u0641\u0639\u0651\u0644"],
  "settings.mcp.noServers": ["No MCP servers configured. Add stdio servers to extend SADEEM with external tools.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062E\u0648\u0627\u062F\u0645 MCP. \u0623\u0636\u0641 \u062E\u0648\u0627\u062F\u0645 stdio \u0644\u062A\u0648\u0633\u064A\u0639 \u0633\u062F\u064A\u0645 \u0628\u0623\u062F\u0648\u0627\u062A \u062E\u0627\u0631\u062C\u064A\u0629."],
  "settings.billing.plan": ["Current plan", "\u062E\u0637\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "settings.billing.license": ["License key", "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0631\u062E\u064A\u0635"],
  "settings.billing.activate": ["Activate", "\u062A\u0646\u0634\u064A\u0637"],
  "settings.billing.stripe": ["Stripe payment link (for subscriptions)", "\u0631\u0627\u0628\u0637 \u062F\u0641\u0639 Stripe (\u0644\u0644\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A)"],
  "settings.billing.hint": ["Paste your Stripe Payment Link \u2014 the Upgrade buttons will open it.", "\u0627\u0644\u0635\u0642 \u0631\u0627\u0628\u0637 \u0627\u0644\u062F\u0641\u0639 \u0645\u0646 Stripe \u2014 \u0633\u062A\u0641\u062A\u062D \u0623\u0632\u0631\u0627\u0631 \u0627\u0644\u062A\u0631\u0642\u064A\u0629 \u0647\u0630\u0627 \u0627\u0644\u0631\u0627\u0628\u0637."],
  "settings.about.version": ["Version", "\u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "settings.about.keys": ["Your API keys are stored locally with OS-level encryption when available. Nothing is sent to SADEEM servers.", "\u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u062A\u064F\u062E\u0632\u0646 \u0645\u062D\u0644\u064A\u0627\u064B \u0645\u0639 \u062A\u0634\u0641\u064A\u0631 \u0639\u0644\u0649 \u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0646\u0638\u0627\u0645 \u0639\u0646\u062F \u062A\u0648\u0641\u0631\u0647. \u0644\u0627 \u064A\u064F\u0631\u0633\u0644 \u0634\u064A\u0621 \u0625\u0644\u0649 \u062E\u0648\u0627\u062F\u0645 \u0633\u062F\u064A\u0645."],
  // plans
  "plans.title": ["Choose your plan", "\u0627\u062E\u062A\u0631 \u062E\u0637\u062A\u0643"],
  "plans.sub": ["SADEEM is BYOK-first: bring your own API keys and work free during the public season. No subscription, no credits \u2014 you connect your own provider.", "\u0633\u062F\u064A\u0645 \u064A\u0639\u0645\u0644 \u0628\u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0627\u0644\u062E\u0627\u0635\u0629 \u0645\u062C\u0627\u0646\u0627\u064B \u062E\u0644\u0627\u0644 \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0639\u0627\u0645. \u0628\u0644\u0627 \u0627\u0634\u062A\u0631\u0627\u0643 \u0623\u0648 \u0631\u0635\u064A\u062F \u2014 \u0623\u0646\u062A \u062A\u0631\u0628\u0637 \u0645\u0632\u0648\u0651\u062F\u0643 \u0627\u0644\u062E\u0627\u0635."],
  "plans.free.name": ["Free", "\u0645\u062C\u0627\u0646\u064A"],
  "plans.pro.name": ["Pro", "\u0627\u062D\u062A\u0631\u0627\u0641\u064A"],
  "plans.team.name": ["Team", "\u0641\u0631\u064A\u0642"],
  "plans.free.price": ["$0", "$0"],
  "plans.pro.price": ["$20/mo", "$20/\u0634\u0647\u0631\u064A\u0627\u064B"],
  "plans.team.price": ["$49/user/mo", "$49/\u0645\u0633\u062A\u062E\u062F\u0645/\u0634\u0647\u0631\u064A\u0627\u064B"],
  "plans.free.f1": ["All core agent features", "\u0643\u0644 \u0645\u064A\u0632\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629"],
  "plans.free.f2": ["Bring your own API keys", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0627\u0644\u062E\u0627\u0635\u0629"],
  "plans.free.f3": ["15 agent runs / day", "15 \u062A\u0634\u063A\u064A\u0644\u0627\u064B \u0644\u0644\u0648\u0643\u064A\u0644 \u064A\u0648\u0645\u064A\u0627\u064B"],
  "plans.pro.f1": ["Unlimited agent runs", "\u062A\u0634\u063A\u064A\u0644 \u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F"],
  "plans.pro.f2": ["Checkpoints & rewind", "\u0646\u0642\u0627\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0648\u062A\u0631\u0627\u062C\u0639"],
  "plans.pro.f3": ["MCP & subagents", "MCP \u0648\u0648\u0643\u0644\u0627\u0621 \u0641\u0631\u0639\u064A\u0648\u0646"],
  "plans.pro.f4": ["Priority email support", "\u062F\u0639\u0645 \u0628\u0631\u064A\u062F \u0623\u0648\u0644\u0648\u064A"],
  "plans.team.f1": ["Everything in Pro", "\u0643\u0644 \u0645\u0632\u0627\u064A\u0627 \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A"],
  "plans.team.f2": ["Shared MCP server catalog", "\u0643\u062A\u0627\u0644\u0648\u062C MCP \u0645\u0634\u062A\u0631\u0643"],
  "plans.team.f3": ["Central billing & seats", "\u0641\u0648\u0627\u062A\u064A\u0631 \u0645\u0631\u0643\u0632\u064A\u0629 \u0648\u0645\u0642\u0627\u0639\u062F"],
  "plans.team.f4": ["Onboarding & SLA", "\u062A\u0647\u064A\u0626\u0629 \u0648\u0627\u062A\u0641\u0627\u0642\u064A\u0629 \u0645\u0633\u062A\u0648\u0649 \u062E\u062F\u0645\u0629"],
  "plans.current": ["Current plan", "\u062E\u0637\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "plans.upgrade": ["Upgrade", "\u062A\u0631\u0642\u064A\u0629"],
  "plans.activate": ["Have a license key? Activate it below.", "\u0644\u062F\u064A\u0643 \u0645\u0641\u062A\u0627\u062D \u062A\u0631\u062E\u064A\u0635\u061F \u0641\u0639\u0651\u0644\u0647 \u0628\u0627\u0644\u0623\u0633\u0641\u0644."],
  "plans.activated": ["License activated", "\u062A\u0645 \u062A\u0646\u0634\u064A\u0637 \u0627\u0644\u062A\u0631\u062E\u064A\u0635"],
  "plans.invalidKey": ["Invalid license key", "\u0645\u0641\u062A\u0627\u062D \u062A\u0631\u062E\u064A\u0635 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D"],
  "plans.limitTitle": ["Daily limit reached", "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062D\u0635\u0629 \u0627\u0644\u064A\u0648\u0645\u064A\u0629"],
  "plans.limitBody": ["Free plan allows 15 agent runs per day. Upgrade to Pro for unlimited runs.", "\u0627\u0644\u062E\u0637\u0629 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629 \u062A\u0633\u0645\u062D \u0628\u064015 \u062A\u0634\u063A\u064A\u0644\u0627\u064B \u064A\u0648\u0645\u064A\u0627\u064B. \u0631\u0642\u0650\u0651 \u0625\u0644\u0649 \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u0644\u062A\u0634\u063A\u064A\u0644 \u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F."],
  // chat
  "chat.empty1": ["Ask SADEEM to build, fix or explain anything", "\u0627\u0637\u0644\u0628 \u0645\u0646 \u0633\u062F\u064A\u0645 \u0623\u0646 \u064A\u0628\u0646\u064A \u0623\u0648 \u064A\u0635\u0644\u062D \u0623\u0648 \u064A\u0634\u0631\u062D \u0623\u064A \u0634\u064A\u0621"],
  "chat.empty2": ["It will explore your project, propose changes and run commands \u2014 with your approval.", "\u0633\u064A\u0633\u062A\u0643\u0634\u0641 \u0645\u0634\u0631\u0648\u0639\u0643 \u0648\u064A\u0642\u062A\u0631\u062D \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0648\u064A\u0646\u0641\u0651\u0630 \u0623\u0648\u0627\u0645\u0631 \u2014 \u0628\u0645\u0648\u0627\u0641\u0642\u062A\u0643."],
  "chat.s1": ["Explain this project", "\u0627\u0634\u0631\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "chat.s2": ["Find and fix bugs", "\u062C\u062F \u0627\u0644\u0623\u062E\u0637\u0627\u0621 \u0648\u0623\u0635\u0644\u062D\u0647\u0627"],
  "chat.s3": ["Add a new feature", "\u0623\u0636\u0641 \u0645\u064A\u0632\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "chat.s4": ["Write tests for the core module", "\u0627\u0643\u062A\u0628 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0644\u0648\u062D\u062F\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629"],
  "chat.placeholder": ["Describe a task, @mention files, /commands\u2026", "\u0627\u0643\u062A\u0628 \u0645\u0647\u0645\u0629\u060C @\u0630\u0643\u0631 \u0645\u0644\u0641\u0627\u062A\u060C /\u0623\u0648\u0627\u0645\u0631\u2026"],
  "chat.send": ["Send", "\u0625\u0631\u0633\u0627\u0644"],
  "chat.stop": ["Stop", "\u0625\u064A\u0642\u0627\u0641"],
  "chat.attachImage": ["Attach image (vision)", "\u0625\u0631\u0641\u0627\u0642 \u0635\u0648\u0631\u0629 (\u0631\u0624\u064A\u0629)"],
  "chat.removeImage": ["Remove", "\u0625\u0632\u0627\u0644\u0629"],
  "chat.imagesOnly": ["[image attached]", "[\u0635\u0648\u0631\u0629 \u0645\u0631\u0641\u0642\u0629]"],
  "chat.new": ["New session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "chat.compact": ["Compact context", "\u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "chat.compacting": ["Compacting\u2026", "\u062C\u0627\u0631\u064A \u0627\u0644\u0636\u063A\u0637\u2026"],
  // v11.11 (A1-STREAM) — the static "the-run-is-busy" label key is RETIRED
  // (founder: zero busy-word text anywhere). The working state is the ONE
  // quiet line: chat.gerund.* (Thinking/Planning/Building/Exploring/Verifying)
  // picked by src/lib/streamDisplay.ts — never a static label again.
  // v8.1 — stream band labels (THINK/WORK/BUILD/RUN/PROVE)
  "chat.phaseThink": ["reasoning", "\u0627\u0633\u062A\u062F\u0644\u0627\u0644"],
  "chat.phaseWork": ["investigation", "\u0627\u0633\u062A\u0643\u0634\u0627\u0641"],
  "chat.phaseBuild": ["files changed", "\u0645\u0644\u0641\u0627\u062A \u0645\u064F\u0639\u062F\u0651\u0644\u0629"],
  "chat.phaseRun": ["commands", "\u0623\u0648\u0627\u0645\u0631 \u0648\u062A\u0634\u063A\u064A\u0644"],
  "chat.phaseProve": ["gates & proof", "\u0628\u0648\u0627\u0628\u0627\u062A \u0648\u0625\u062B\u0628\u0627\u062A"],
  "chat.runsToday": ["runs today", "\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u064A\u0648\u0645"],
  "chat.approve": ["Approve", "\u0645\u0648\u0627\u0641\u0642\u0629"],
  "chat.approveAlways": ["Always allow", "\u0627\u0633\u0645\u062D \u062F\u0627\u0626\u0645\u0627\u064B"],
  "chat.deny": ["Deny", "\u0631\u0641\u0636"],
  "chat.allowOnce": ["Allow once", "\u0627\u0633\u0645\u062D \u0645\u0631\u0629"],
  "chat.wantsToWrite": ["SADEEM wants to edit a file", "\u0633\u062F\u064A\u0645 \u064A\u0631\u064A\u062F \u062A\u0639\u062F\u064A\u0644 \u0645\u0644\u0641\u0627\u064B"],
  "chat.wantsToRun": ["SADEEM wants to run a command", "\u0633\u062F\u064A\u0645 \u064A\u0631\u064A\u062F \u062A\u0646\u0641\u064A\u0630 \u0623\u0645\u0631\u0627\u064B"],
  "chat.wantsMcp": ["SADEEM wants to call an MCP tool", "\u0633\u062F\u064A\u0645 \u064A\u0631\u064A\u062F \u0627\u0633\u062A\u062F\u0639\u0627\u0621 \u0623\u062F\u0627\u0629 MCP"],
  "chat.deniedByUser": ["Denied by user", "\u0631\u0641\u0636\u0647 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645"],
  "chat.contextCompacted": ["Context compacted \u2014 older messages summarized.", "\u062A\u0645 \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642 \u2014 \u0644\u064F\u062E\u0651\u0635\u062A \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0623\u0642\u062F\u0645."],
  "chat.you": ["You", "\u0623\u0646\u062A"],
  "chat.surnia": ["SADEEM", "\u0633\u062F\u064A\u0645"],
  // tools
  "tool.list_dir": ["List directory", "\u0639\u0631\u0636 \u0645\u062C\u0644\u062F"],
  "tool.read_file": ["Read file", "\u0642\u0631\u0627\u0621\u0629 \u0645\u0644\u0641"],
  "tool.write_file": ["Write file", "\u0643\u062A\u0627\u0628\u0629 \u0645\u0644\u0641"],
  "tool.edit_file": ["Edit file", "\u062A\u0639\u062F\u064A\u0644 \u0645\u0644\u0641"],
  "tool.run_command": ["Run command", "\u062A\u0646\u0641\u064A\u0630 \u0623\u0645\u0631"],
  "tool.run_background": ["Start background process", "\u062A\u0634\u063A\u064A\u0644 \u0639\u0645\u0644\u064A\u0629 \u062E\u0644\u0641\u064A\u0629"],
  "tool.process_output": ["Process output", "\u0645\u062E\u0631\u062C\u0627\u062A \u0627\u0644\u0639\u0645\u0644\u064A\u0629"],
  "tool.stop_process": ["Stop process", "\u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0639\u0645\u0644\u064A\u0629"],
  "tool.preview_screenshot": ["Screenshot preview", "\u0644\u0642\u0637\u0629 \u0645\u0646 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "tool.search_files": ["Search files", "\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "tool.todo_write": ["Update plan", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062E\u0637\u0629"],
  "tool.task": ["Subagent task", "\u0645\u0647\u0645\u0629 \u0648\u0643\u064A\u0644 \u0641\u0631\u0639\u064A"],
  "tool.web_fetch": ["Fetch page", "\u062C\u0644\u0628 \u0635\u0641\u062D\u0629"],
  "tool.mcp": ["MCP tool", "\u0623\u062F\u0627\u0629 MCP"],
  // v11.10 builder-arsenal tool rows
  "tool.pdf_make": ["Create PDF", "\u0625\u0646\u0634\u0627\u0621 PDF"],
  "tool.pptx_make": ["Create PowerPoint", "\u0625\u0646\u0634\u0627\u0621 \u0639\u0631\u0636 PowerPoint"],
  "tool.docx_make": ["Create Word document", "\u0625\u0646\u0634\u0627\u0621 \u0645\u0633\u062A\u0646\u062F Word"],
  "tool.xlsx_make": ["Create Excel sheet", "\u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0641 Excel"],
  "tool.export_project": ["Export project ZIP", "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 ZIP"],
  "tool.diagnose_preview": ["Diagnose preview", "\u062A\u0634\u062E\u064A\u0635 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "tool.browser_download": ["Download asset", "\u062A\u0646\u0632\u064A\u0644 \u0645\u0644\u0641"],
  "tool.browser_console": ["Browser console", "\u0643\u0648\u0646\u0633\u0648\u0644 \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  "tool.browser_console_eval": ["Evaluate in browser console", "\u062A\u0646\u0641\u064A\u0630 \u0641\u064A \u0643\u0648\u0646\u0633\u0648\u0644 \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  "tool.browser_pdf": ["Save page as PDF", "\u062D\u0641\u0638 \u0627\u0644\u0635\u0641\u062D\u0629 PDF"],
  "tool.sqlite_query": ["SQLite query", "\u0627\u0633\u062A\u0639\u0644\u0627\u0645 SQLite"],
  "tool.env_install": ["Install dependencies", "\u062A\u062B\u0628\u064A\u062A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F\u064A\u0627\u062A"],
  "tool.search_grep": ["Search text (grep)", "\u0628\u062D\u062B \u0646\u0635\u064A (grep)"],
  "tool.git_local": ["Git operation", "\u0639\u0645\u0644\u064A\u0629 Git"],
  "tool.image_probe": ["Inspect image", "\u0641\u062D\u0635 \u0635\u0648\u0631\u0629"],
  "tool.status.running": ["Running", "\u0642\u064A\u062F \u0627\u0644\u062A\u0646\u0641\u064A\u0630"],
  "tool.status.ok": ["Done", "\u062A\u0645"],
  "tool.status.denied": ["Denied", "\u0645\u0631\u0641\u0648\u0636"],
  "tool.status.error": ["Error", "\u062E\u0637\u0623"],
  "tool.newFile": ["(new file)", "(\u0645\u0644\u0641 \u062C\u062F\u064A\u062F)"],
  "tool.linesChanged": ["lines changed", "\u0633\u0637\u0631\u0627\u064B \u062A\u0645 \u062A\u063A\u064A\u064A\u0631\u0647\u0645\u0627"],
  "tool.exitCode": ["exit code", "\u0631\u0645\u0632 \u0627\u0644\u062E\u0631\u0648\u062C"],
  // workspace panel
  "ws.open": ["Open", "\u0641\u062A\u062D"],
  "ws.newFile": ["New file", "\u0645\u0644\u0641 \u062C\u062F\u064A\u062F"],
  "ws.newFolder": ["New folder", "\u0645\u062C\u0644\u062F \u062C\u062F\u064A\u062F"],
  "ws.refresh": ["Refresh", "\u062A\u062D\u062F\u064A\u062B"],
  "ws.search": ["Search in project\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0634\u0631\u0648\u0639\u2026"],
  "ws.noResults": ["No results", "\u0644\u0627 \u0646\u062A\u0627\u0626\u062C"],
  "ws.rename": ["Rename", "\u0625\u0639\u0627\u062F\u0629 \u062A\u0633\u0645\u064A\u0629"],
  "ws.delete": ["Delete", "\u062D\u0630\u0641"],
  "ws.confirmDelete": ["Delete this path?", "\u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u0627\u0631\u061F"],
  "ws.name": ["Name", "\u0627\u0644\u0627\u0633\u0645"],
  "ws.create": ["Create", "\u0625\u0646\u0634\u0627\u0621"],
  "ws.cancel": ["Cancel", "\u0625\u0644\u063A\u0627\u0621"],
  "ws.openFolder": ["Open folder", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F"],
  "ws.noWorkspace": ["No folder open", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u062C\u0644\u062F \u0645\u0641\u062A\u0648\u062D"],
  // sessions panel
  "sess.title": ["Sessions", "\u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "sess.new": ["New session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "sess.search": ["Search sessions\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u062C\u0644\u0633\u0627\u062A\u2026"],
  "sess.none": ["No sessions yet. Start chatting!", "\u0644\u0627 \u062C\u0644\u0633\u0627\u062A \u0628\u0639\u062F. \u0627\u0628\u062F\u0623 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629!"],
  "sess.messages": ["messages", "\u0631\u0633\u0627\u0644\u0629"],
  // git panel
  "git.title": ["Source control", "\u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631"],
  "git.init": ["Initialize repository", "\u062A\u0647\u064A\u0626\u0629 \u0645\u0633\u062A\u0648\u062F\u0639"],
  "git.notRepo": ["This folder is not a git repository yet.", "\u0647\u0630\u0627 \u0627\u0644\u0645\u062C\u0644\u062F \u0644\u064A\u0633 \u0645\u0633\u062A\u0648\u062F\u0639 git \u0628\u0639\u062F."],
  "git.commitMsg": ["Commit message\u2026", "\u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0625\u064A\u062F\u0627\u0639\u2026"],
  "git.commit": ["Commit", "\u0625\u064A\u062F\u0627\u0639"],
  "git.commitDone": ["Committed", "\u062A\u0645 \u0627\u0644\u0625\u064A\u062F\u0627\u0639"],
  "git.stage": ["Stage", "\u062A\u062C\u0647\u064A\u0632"],
  "git.unstage": ["Unstage", "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062A\u062C\u0647\u064A\u0632"],
  "git.noChanges": ["No changes", "\u0644\u0627 \u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  "git.staged": ["Staged", "\u0645\u064F\u062C\u0647\u0651\u0632"],
  "git.changes": ["Changes", "\u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  "git.viewDiff": ["View diff", "\u0639\u0631\u0636 \u0627\u0644\u0641\u0631\u0642"],
  "git.diffTitle": ["Working tree diff", "\u0641\u0631\u0642 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644"],
  // mcp panel
  "mcp.title": ["MCP servers", "\u062E\u0648\u0627\u062F\u0645 MCP"],
  "mcp.ok": ["Connected", "\u0645\u062A\u0635\u0644"],
  "mcp.fail": ["Failed", "\u0641\u0634\u0644"],
  // usage panel
  "usage.title": ["Usage", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "usage.today": ["Today", "\u0627\u0644\u064A\u0648\u0645"],
  "usage.runs": ["Agent runs", "\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644"],
  "usage.tokens": ["Tokens", "\u0627\u0644\u0631\u0645\u0648\u0632"],
  "usage.cost": ["Est. cost", "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062A\u0642\u062F\u064A\u0631\u064A\u0629"],
  "usage.session": ["This session", "\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "usage.freeLimit": ["Free plan daily limit", "\u062D\u062F \u0627\u0644\u062E\u0637\u0629 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629 \u0627\u0644\u064A\u0648\u0645\u064A"],
  "usage.upgrade": ["Upgrade", "\u062A\u0631\u0642\u064A\u0629"],
  "usage.perDay": ["Last 7 days", "\u0622\u062E\u0631 7 \u0623\u064A\u0627\u0645"],
  // palette
  "palette.placeholder": ["Type a command\u2026", "\u0627\u0643\u062A\u0628 \u0623\u0645\u0631\u0627\u064B\u2026"],
  "palette.openFolder": ["Open folder\u2026", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u2026"],
  "palette.newSession": ["New session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "palette.toggleTerminal": ["Toggle terminal", "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "palette.toggleSidebar": ["Toggle sidebar", "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0634\u0631\u064A\u0637 \u0627\u0644\u062C\u0627\u0646\u0628\u064A"],
  "palette.toggleChat": ["Toggle chat panel", "\u062A\u0628\u062F\u064A\u0644 \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "palette.mode.default": ["Permission mode: Ask", "\u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A: \u062A\u0623\u0643\u064A\u062F"],
  "palette.mode.autoEdit": ["Permission mode: Auto-edit", "\u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A: \u062A\u0639\u062F\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A"],
  "palette.mode.fullAccess": ["Permission mode: Full access", "\u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A: \u0648\u0635\u0648\u0644 \u0643\u0627\u0645\u0644"],
  "palette.changeModel": ["Change AI model\u2026", "\u062A\u063A\u064A\u064A\u0631 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A\u2026"],
  "palette.theme.obsidian": ["Theme: Obsidian", "\u0627\u0644\u0633\u0645\u0629: \u0623\u0648\u0628\u0633\u064A\u062F\u064A\u0627\u0646"],
  "palette.theme.midnight": ["Theme: Midnight", "\u0627\u0644\u0633\u0645\u0629: \u0645\u0646\u062A\u0635\u0641 \u0627\u0644\u0644\u064A\u0644"],
  "palette.theme.light": ["Theme: Light", "\u0627\u0644\u0633\u0645\u0629: \u0641\u0627\u062A\u062D"],
  "palette.lang": ["Toggle language AR/EN", "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0644\u063A\u0629 \u0639\u0631\u0628\u064A/\u0625\u0646\u062C\u0644\u064A\u0632\u064A"],
  "palette.openSettings": ["Open settings", "\u0641\u062A\u062D \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "palette.openPlans": ["Plans & upgrade", "\u0627\u0644\u062E\u0637\u0637 \u0648\u0627\u0644\u062A\u0631\u0642\u064A\u0629"],
  "palette.init": ["/init \u2014 generate project memory (MEMORY.md)", "/init \u2014 \u0625\u0646\u0634\u0627\u0621 \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 (MEMORY.md)"],
  "palette.compact": ["/compact \u2014 summarize and compact context", "/compact \u2014 \u062A\u0644\u062E\u064A\u0635 \u0648\u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "palette.context": ["/context \u2014 context window breakdown", "/context \u2014 \u062A\u0641\u0635\u064A\u0644 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "palette.rewind": ["/rewind \u2014 restore the last checkpoint", "/rewind \u2014 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0622\u062E\u0631 \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642"],
  "palette.effort": ["/effort \u2014 toggle deep thinking effort", "/effort \u2014 \u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0639\u0645\u064A\u0642"],
  "palette.planMode": ["/plan \u2014 plan mode (read-only research)", "/plan \u2014 \u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629 (\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637)"],
  "palette.saveAll": ["Save all files", "\u062D\u0641\u0638 \u0643\u0644 \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "palette.closeTab": ["Close tab", "\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062A\u0628\u0648\u064A\u0628"],
  // model picker
  "mp.title": ["Choose model", "\u0627\u062E\u062A\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "mp.noKey": ["API key not configured", "\u0645\u0641\u062A\u0627\u062D API \u063A\u064A\u0631 \u0645\u064F\u0639\u062F"],
  "mp.configure": ["Configure in Settings \u2192 AI providers", "\u0627\u0636\u0628\u0637\u0647 \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2192 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "mp.custom": ["Custom model ID", "\u0645\u0639\u0631\u0651\u0641 \u0646\u0645\u0648\u0630\u062C \u0645\u062E\u0635\u0635"],
  // diff
  "diff.approve": ["Approve & apply", "\u0645\u0648\u0627\u0641\u0642\u0629 \u0648\u062A\u0637\u0628\u064A\u0642"],
  "diff.deny": ["Deny", "\u0631\u0641\u0636"],
  "diff.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "diff.newFile": ["New file", "\u0645\u0644\u0641 \u062C\u062F\u064A\u062F"],
  // editor AI (inline edit widget + ghost text + editor context actions)
  "editor.inlineEdit": ["Inline edit", "\u062A\u062D\u0631\u064A\u0631 \u0633\u0637\u0631\u064A"],
  "editor.inlineEdit.ph": ["Describe the change\u2026", "\u0627\u0648\u0635\u0641 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u2026"],
  "editor.inlineEdit.working": ["Generating\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u0648\u0644\u064A\u062F\u2026"],
  "editor.inlineEdit.generate": ["Generate", "\u062A\u0648\u0644\u064A\u062F"],
  "editor.inlineEdit.apply": ["Apply", "\u062A\u0637\u0628\u064A\u0642"],
  "editor.inlineEdit.accept": ["Apply", "\u062A\u0637\u0628\u064A\u0642"],
  "editor.inlineEdit.reject": ["Discard", "\u0625\u0644\u063A\u0627\u0621"],
  "editor.inlineEdit.failed": ["Request failed", "\u0641\u0634\u0644 \u0627\u0644\u0637\u0644\u0628"],
  "editor.action.explain": ["Explain selection", "\u0627\u0634\u0631\u062D \u0627\u0644\u0645\u062D\u062F\u062F"],
  "editor.action.fix": ["Fix problems in selection", "\u0623\u0635\u0644\u062D \u0645\u0634\u0643\u0644\u0627\u062A \u0627\u0644\u0645\u062D\u062F\u062F"],
  "editor.action.addTests": ["Add tests for selection", "\u0623\u0636\u0641 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0644\u0645\u062D\u062F\u062F"],
  "editor.action.refactor": ["Refactor selection", "\u0623\u0639\u062F \u0647\u064A\u0643\u0644\u0629 \u0627\u0644\u0645\u062D\u062F\u062F"],
  "editor.action.sendToChat": ["Send selection to chat", "\u0623\u0631\u0633\u0644 \u0627\u0644\u0645\u062D\u062F\u062F \u0625\u0644\u0649 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "settings.inlineSuggestions": ["Inline ghost suggestions", "\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0634\u0628\u062D\u064A\u0629 \u0633\u0637\u0631\u064A\u0629"],
  "settings.inlineSuggestions.hint": ["AI completions as you type in the editor", "\u0625\u0643\u0645\u0627\u0644\u0627\u062A \u0630\u0643\u064A\u0629 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0641\u064A \u0627\u0644\u0645\u062D\u0631\u0631"],
  // terminal
  "term.title": ["Terminal", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "term.clear": ["Clear", "\u0645\u0633\u062D"],
  "term.interrupt": ["Interrupt (Ctrl+C)", "\u0625\u064A\u0642\u0627\u0641 (Ctrl+C)"],
  "term.hint": ["Type a command and press Enter", "\u0627\u0643\u062A\u0628 \u0623\u0645\u0631\u0627\u064B \u0648\u0627\u0636\u063A\u0637 Enter"],
  // misc
  "misc.error": ["Error", "\u062E\u0637\u0623"],
  "misc.loading": ["Loading\u2026", "\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "misc.today": ["today", "\u0627\u0644\u064A\u0648\u0645"],
  "misc.save": ["Save", "\u062D\u0641\u0638"],
  "misc.saved": ["Saved", "\u062A\u0645 \u0627\u0644\u062D\u0641\u0638"],
  "misc.savedAll": ["All files saved", "\u062D\u064F\u0641\u0638\u062A \u0643\u0644 \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "misc.fileTooLarge": ["File too large to open", "\u0627\u0644\u0645\u0644\u0641 \u0643\u0628\u064A\u0631 \u062C\u062F\u0627\u064B"],
  "misc.readOnlyFile": ["Cannot open binary file", "\u0644\u0627 \u064A\u0645\u0643\u0646 \u0641\u062A\u062D \u0645\u0644\u0641 \u062B\u0646\u0627\u0626\u064A"],
  "misc.notify.compactDone": ["Context compacted", "\u062A\u0645 \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "misc.notify.initDone": ["MEMORY.md created \u2014 SADEEM now knows your project", "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 MEMORY.md \u2014 \u0633\u062F\u064A\u0645 \u064A\u0639\u0631\u0641 \u0645\u0634\u0631\u0648\u0639\u0643 \u0627\u0644\u0622\u0646"],
  "misc.notify.noWorkspace": ["Open a folder first", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B"],
  "misc.notify.noKey": ["Configure an API key for this provider first (Settings \u2192 AI providers)", "\u0627\u0636\u0628\u0637 \u0645\u0641\u062A\u0627\u062D API \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0632\u0648\u062F \u0623\u0648\u0644\u0627\u064B (\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2192 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A)"],
  "misc.untitledSession": ["New session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "help.title": ["SADEEM commands", "\u0623\u0648\u0627\u0645\u0631 \u0633\u062F\u064A\u0645"],
  // ---------- auth (sign in / sign up) ----------
  "auth.welcomeBack": ["Welcome back", "\u0623\u0647\u0644\u0627\u064B \u0628\u0639\u0648\u062F\u062A\u0643"],
  "auth.signInSub": ["Sign in to your local SADEEM account.", "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0625\u0644\u0649 \u062D\u0633\u0627\u0628 \u0633\u062F\u064A\u0645 \u0627\u0644\u0645\u062D\u0644\u064A."],
  "auth.name": ["Full name", "\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u0645\u0644"],
  "auth.email": ["Email", "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A"],
  "auth.password": ["Password", "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631"],
  "auth.confirm": ["Confirm password", "\u062A\u0623\u0643\u064A\u062F \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631"],
  "auth.signIn": ["Sign in", "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644"],
  "auth.signUp": ["Create account", "\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628"],
  "auth.switchToUp": ["New here? Create an account", "\u062C\u062F\u064A\u062F \u0647\u0646\u0627\u061F \u0623\u0646\u0634\u0626 \u062D\u0633\u0627\u0628\u0627\u064B"],
  "auth.switchToIn": ["Already have an account? Sign in", "\u0644\u062F\u064A\u0643 \u062D\u0633\u0627\u0628\u061F \u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644"],
  "auth.strength.weak": ["Weak", "\u0636\u0639\u064A\u0641\u0629"],
  "auth.strength.fair": ["Fair", "\u0645\u0642\u0628\u0648\u0644\u0629"],
  "auth.strength.good": ["Good", "\u062C\u064A\u062F\u0629"],
  "auth.strength.strong": ["Strong", "\u0642\u0648\u064A\u0629"],
  "auth.err.name_required": ["Please enter your name", "\u0623\u062F\u062E\u0644 \u0627\u0633\u0645\u0643 \u0645\u0646 \u0641\u0636\u0644\u0643"],
  "auth.err.email_invalid": ["That email address does not look valid", "\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D"],
  "auth.err.email_taken": ["An account with this email already exists", "\u064A\u0648\u062C\u062F \u062D\u0633\u0627\u0628 \u0628\u0647\u0630\u0627 \u0627\u0644\u0628\u0631\u064A\u062F \u0628\u0627\u0644\u0641\u0639\u0644"],
  "auth.err.password_short": ["Password must be at least 8 characters", "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 8 \u0623\u062D\u0631\u0641 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644"],
  "auth.err.password_mismatch": ["Passwords do not match", "\u0643\u0644\u0645\u062A\u0627 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0645\u062A\u0637\u0627\u0628\u0642\u062A\u064A\u0646"],
  "auth.err.no_account": ["No account found with this email", "\u0644\u0627 \u064A\u0648\u062C\u062F \u062D\u0633\u0627\u0628 \u0628\u0647\u0630\u0627 \u0627\u0644\u0628\u0631\u064A\u062F"],
  "auth.err.wrong_password": ["Incorrect password", "\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063A\u064A\u0631 \u0635\u062D\u064A\u062D\u0629"],
  "auth.err.storage_failed": ["Could not write to local storage", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062D\u0641\u0638 \u0641\u064A \u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u062D\u0644\u064A"],
  "auth.localOnly": ["Continue without an account", "\u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0628\u062F\u0648\u0646 \u062D\u0633\u0627\u0628"],
  "auth.localOnlyDesc": [
    "Everything stays on this device either way. An account adds a named profile and plan tracking \u2014 stored locally, never uploaded.",
    "\u0643\u0644 \u0634\u064A\u0621 \u064A\u0628\u0642\u0649 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0641\u064A \u0627\u0644\u062D\u0627\u0644\u062A\u064A\u0646. \u0627\u0644\u062D\u0633\u0627\u0628 \u064A\u0636\u064A\u0641 \u0645\u0644\u0641\u0627\u064B \u0634\u062E\u0635\u064A\u0627\u064B \u0648\u062A\u062A\u0628\u0639 \u0627\u0644\u062E\u0637\u0629 \u2014 \u0645\u062D\u0641\u0648\u0638 \u0645\u062D\u0644\u064A\u0627\u064B \u0648\u0644\u0627 \u064A\u064F\u0631\u0633\u0644 \u0623\u0628\u062F\u0627\u064B."
  ],
  "auth.deviceNote": ["Accounts are stored on this device only (scrypt-hashed).", "\u0627\u0644\u062D\u0633\u0627\u0628\u0627\u062A \u0645\u062D\u0641\u0648\u0638\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0641\u0642\u0637 (\u062A\u0634\u0641\u064A\u0631 scrypt)."],
  "auth.point.plan": [
    "Plan mode: the agent researches read-only, then proposes a plan you approve",
    "\u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629: \u064A\u0628\u062D\u062B \u0627\u0644\u0648\u0643\u064A\u0644 \u0628\u0627\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637 \u062B\u0645 \u064A\u0642\u062A\u0631\u062D \u062E\u0637\u0629 \u062A\u0648\u0627\u0641\u0642 \u0639\u0644\u064A\u0647\u0627"
  ],
  "auth.point.device": [
    "Real access to your machine: files, terminal, git \u2014 your tools, your machine",
    "\u0648\u0635\u0648\u0644 \u062D\u0642\u064A\u0642\u064A \u0644\u062C\u0647\u0627\u0632\u0643: \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0648git \u2014 \u0623\u062F\u0648\u0627\u062A\u0643 \u0648\u062C\u0647\u0627\u0632\u0643"
  ],
  "auth.point.models": [
    "Claude, GPT, Gemini, GLM, DeepSeek, Ollama \u2014 bring your own key",
    "\u0643\u0644\u0648\u062F \u0648GPT \u0648\u062C\u064A\u0645\u064A\u0646\u0627\u064A \u0648GLM \u0648\u062F\u064A\u0628\u0633\u064A\u0643 \u0648\u0623\u0648\u0644\u0627\u0645\u0627 \u2014 \u0628\u0645\u0641\u062A\u0627\u062D\u0643 \u0627\u0644\u062E\u0627\u0635"
  ],
  "auth.point.privacy": [
    "Local-first: keys are encrypted, code never leaves this device",
    "\u0645\u062D\u0644\u064A \u0623\u0648\u0644\u0627\u064B: \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0645\u0634\u0641\u0651\u0631\u0629 \u0648\u0627\u0644\u0643\u0648\u062F \u0644\u0627 \u064A\u062A\u0631\u0643 \u062C\u0647\u0627\u0632\u0643 \u0623\u0628\u062F\u0627\u064B"
  ],
  "auth.hello": ["Hello, {name}", "\u0645\u0631\u062D\u0628\u0627\u064B {name}"],
  "auth.planFree": ["Free plan", "\u0627\u0644\u062E\u0637\u0629 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629"],
  "auth.planPro": ["Pro plan", "\u062E\u0637\u0629 Pro"],
  "auth.planTeam": ["Team plan", "\u062E\u0637\u0629 \u0627\u0644\u0641\u0631\u064A\u0642"],
  // ---------- onboarding (5 steps) ----------
  "onboard.appearance": ["Make it yours", "\u0627\u062C\u0639\u0644\u0647 \u0644\u0643"],
  "onboard.appearance.sub": ["Pick a theme \u2014 the preview updates live.", "\u0627\u062E\u062A\u0631 \u0633\u0645\u0629 \u2014 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062A\u062A\u062D\u062F\u062B \u0641\u0648\u0631\u064A\u0627\u064B."],
  "onboard.theme.obsidian": ["Clay & Sage (dark)", "\u0637\u064A\u0646 \u0648\u0633\u064A\u062C (\u062F\u0627\u0643\u0646)"],
  "onboard.theme.midnight": ["Ink (ultra-dark)", "\u062D\u0628\u0631 (\u062F\u0627\u0643\u0646 \u062C\u062F\u0627\u064B)"],
  "onboard.theme.light": ["Warm paper (light)", "\u0648\u0631\u0642 \u062F\u0627\u0641\u0626 (\u0641\u0627\u062A\u062D)"],
  "onboard.account.title": ["Create your profile", "\u0623\u0646\u0634\u0626 \u0645\u0644\u0641\u0643 \u0627\u0644\u0634\u062E\u0635\u064A"],
  "onboard.account.sub": ["Optional \u2014 a local profile keeps your plan and settings named to you.", "\u0627\u062E\u062A\u064A\u0627\u0631\u064A \u2014 \u0645\u0644\u0641 \u0645\u062D\u0644\u064A \u064A\u062D\u0641\u0638 \u062E\u0637\u062A\u0643 \u0648\u0625\u0639\u062F\u0627\u062F\u0627\u062A\u0643 \u0628\u0627\u0633\u0645\u0643."],
  "onboard.trust.title": ["Ready to build", "\u062C\u0627\u0647\u0632 \u0644\u0644\u0628\u0646\u0627\u0621"],
  "onboard.trust.sub": ["Opening a folder grants SADEEM these abilities inside it:", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u064A\u0645\u0646\u062D \u0633\u062F\u064A\u0645 \u0647\u0630\u0647 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0627\u062A \u062F\u0627\u062E\u0644\u0647:"],
  "onboard.trust.read": ["Read files and search the codebase", "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "onboard.trust.edit": ["Edit files (with visual diffs you approve)", "\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0644\u0641\u0627\u062A (\u0645\u0639 \u0641\u0631\u0648\u0642\u0627\u062A \u062A\u0631\u0627\u062C\u0639\u0647\u0627 \u0648\u062A\u0648\u0627\u0641\u0642 \u0639\u0644\u064A\u0647\u0627)"],
  "onboard.trust.run": ["Run commands in the integrated terminal", "\u062A\u0646\u0641\u064A\u0630 \u0623\u0648\u0627\u0645\u0631 \u0641\u064A \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629"],
  "onboard.trust.git": ["Use git and your real toolchain", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 git \u0648\u0633\u0644\u0627\u0633\u0644 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629"],
  "onboard.trust.note": [
    "Nothing runs outside the chosen folder without asking you first.",
    "\u0644\u0627 \u0634\u064A\u0621 \u064A\u0639\u0645\u0644 \u062E\u0627\u0631\u062C \u0627\u0644\u0645\u062C\u0644\u062F \u0627\u0644\u0645\u062E\u062A\u0627\u0631 \u062F\u0648\u0646 \u0633\u0624\u0627\u0644\u0643 \u0623\u0648\u0644\u0627\u064B."
  ],
  "onboard.walkthrough": ["Get started", "\u0627\u0628\u062F\u0623"],
  "onboard.walkthroughSub": ["{0} of {1} steps complete", "\u0623\u064F\u0646\u062C\u0632\u062A {0} \u0645\u0646 {1} \u062E\u0637\u0648\u0627\u062A"],
  "onboard.allDone": ["All steps complete \u2014 happy building!", "\u0627\u0643\u062A\u0645\u0644\u062A \u0643\u0644 \u0627\u0644\u062E\u0637\u0648\u0627\u062A \u2014 \u0628\u0646\u0627\u0621\u064B \u0633\u0639\u064A\u062F\u0627\u064B!"],
  "onboard.markDone": ["Mark done", "\u062A\u0645"],
  // ---------- welcome hub ----------
  "welcome.newProject": ["New project", "\u0645\u0634\u0631\u0648\u0639 \u062C\u062F\u064A\u062F"],
  "welcome.newProjectDesc": ["Create a project from scratch with the AI", "\u0623\u0646\u0634\u0626 \u0645\u0634\u0631\u0648\u0639\u0627\u064B \u0645\u0646 \u0627\u0644\u0635\u0641\u0631 \u0645\u0639 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "welcome.openDesc": ["Work on any folder on this machine", "\u0627\u0639\u0645\u0644 \u0639\u0644\u0649 \u0623\u064A \u0645\u062C\u0644\u062F \u0641\u064A \u062C\u0647\u0627\u0632\u0643"],
  "welcome.clone": ["Clone repository", "\u0627\u0633\u062A\u0646\u0633\u0627\u062E \u0645\u0633\u062A\u0648\u062F\u0639"],
  "welcome.cloneDesc": ["git clone from any URL", "git clone \u0645\u0646 \u0623\u064A \u0631\u0627\u0628\u0637"],
  "welcome.walkthrough": ["Get started with SADEEM", "\u0627\u0628\u062F\u0623 \u0645\u0639 \u0633\u062F\u064A\u0645"],
  "welcome.wt.open": ["Open or create a project", "\u0627\u0641\u062A\u062D \u0623\u0648 \u0623\u0646\u0634\u0626 \u0645\u0634\u0631\u0648\u0639\u0627\u064B"],
  "welcome.wt.model": ["Connect an AI model", "\u0627\u0631\u0628\u0637 \u0646\u0645\u0648\u0630\u062C \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "welcome.wt.session": ["Start your first agent session", "\u0627\u0628\u062F\u0623 \u0623\u0648\u0644 \u062C\u0644\u0633\u0629 \u0648\u0643\u064A\u0644"],
  "welcome.wt.terminal": ["Run the project terminal", "\u0634\u063A\u0651\u0644 \u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "welcome.signOut": ["Sign out", "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C"],
  // ---------- new project (empty folder, built from scratch by the AI) ----------
  "np.title": ["New project", "\u0645\u0634\u0631\u0648\u0639 \u062C\u062F\u064A\u062F"],
  "np.name": ["Project name", "\u0627\u0633\u0645 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "np.location": ["Location", "\u0627\u0644\u0645\u0648\u0642\u0639"],
  "np.browse": ["Browse\u2026", "\u0627\u0633\u062A\u0639\u0631\u0627\u0636\u2026"],
  "np.create": ["Create project", "\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "np.created": ["Empty project created \u2014 describe what to build and the AI will create it from scratch", "\u0623\u064F\u0646\u0634\u0626 \u0645\u0634\u0631\u0648\u0639 \u0641\u0627\u0631\u063A \u2014 \u0627\u0635\u0641 \u0645\u0627 \u062A\u0631\u064A\u062F \u0628\u0646\u0627\u0621\u0647 \u0648\u0633\u064A\u0642\u0648\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0628\u0625\u0646\u0634\u0627\u0626\u0647 \u0645\u0646 \u0627\u0644\u0635\u0641\u0631"],
  "np.exists": ["A folder with this name already exists there", "\u064A\u0648\u062C\u062F \u0645\u062C\u0644\u062F \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u0647\u0646\u0627\u0643"],
  "np.scratch": ["No templates \u2014 an empty folder is created and the AI builds the project from scratch from your request.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0642\u0648\u0627\u0644\u0628 \u2014 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0645\u062C\u0644\u062F \u0641\u0627\u0631\u063A \u0648\u064A\u0628\u0646\u064A \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0645\u0646 \u0627\u0644\u0635\u0641\u0631 \u0628\u0646\u0627\u0621\u064B \u0639\u0644\u0649 \u0637\u0644\u0628\u0643."],
  // ---------- clone dialog ----------
  "cl.title": ["Clone a git repository", "\u0627\u0633\u062A\u0646\u0633\u0627\u062E \u0645\u0633\u062A\u0648\u062F\u0639 git"],
  "cl.url": ["Repository URL", "\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639"],
  "cl.urlPh": ["https://github.com/user/repo.git", "https://github.com/user/repo.git"],
  "cl.dest": ["Destination", "\u0627\u0644\u0645\u062C\u0644\u062F \u0627\u0644\u0647\u062F\u0641"],
  "cl.name": ["Folder name (optional)", "\u0627\u0633\u0645 \u0627\u0644\u0645\u062C\u0644\u062F (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)"],
  "cl.branch": ["Branch (optional)", "\u0627\u0644\u0641\u0631\u0639 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)"],
  "cl.go": ["Clone", "\u0627\u0633\u062A\u0646\u0633\u0627\u062E"],
  "cloning": ["Cloning\u2026", "\u062C\u0627\u0631\u064A \u0627\u0644\u0627\u0633\u062A\u0646\u0633\u0627\u062E\u2026"],
  "cl.done": ["Repository cloned \u2014 opening it", "\u062A\u0645 \u0627\u0644\u0627\u0633\u062A\u0646\u0633\u0627\u062E \u2014 \u062C\u0627\u0631\u064A \u0627\u0644\u0641\u062A\u062D"],
  "cl.err.bad_url": ["Use an https:// or git@ URL", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0631\u0627\u0628\u0637 https:// \u0623\u0648 git@"],
  "cl.err.exists": ["Destination folder already exists", "\u0627\u0644\u0645\u062C\u0644\u062F \u0627\u0644\u0647\u062F\u0641 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0641\u0639\u0644"],
  "cl.err.clone_failed": ["git clone failed \u2014 check the URL and your network", "\u0641\u0634\u0644 git clone \u2014 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0627\u0644\u0634\u0628\u0643\u0629"],
  "cl.err.timeout": ["Clone timed out", "\u0627\u0646\u062A\u0647\u062A \u0645\u0647\u0644\u0629 \u0627\u0644\u0627\u0633\u062A\u0646\u0633\u0627\u062E"],
  // — desktop polish (agent 2-c) —
  // note: 'settings.inlineSuggestions' + '.hint' are defined in the editor-AI section above (agent 2-b owns them)
  "settings.closeToTray": ["Close to system tray", "\u0627\u0644\u0625\u063A\u0644\u0627\u0642 \u0625\u0644\u0649 \u0634\u0631\u064A\u0637 \u0627\u0644\u0646\u0638\u0627\u0645"],
  "settings.closeToTray.hint": ["Keep SADEEM running in the tray when the window is closed", "\u0623\u0628\u0642\u0650 \u0633\u062F\u064A\u0645 \u064A\u0639\u0645\u0644 \u0641\u064A \u0627\u0644\u0634\u0631\u064A\u0637 \u0639\u0646\u062F \u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0646\u0627\u0641\u0630\u0629"],
  "settings.doneNotifications": ["Notify when agent finishes", "\u0625\u0634\u0639\u0627\u0631 \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "settings.doneNotifications.hint": ["Desktop notification when a run completes in the background", "\u0625\u0634\u0639\u0627\u0631 \u0633\u0637\u062D \u0627\u0644\u0645\u0643\u062A\u0628 \u0639\u0646\u062F \u0627\u0643\u062A\u0645\u0627\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0641\u064A \u0627\u0644\u062E\u0644\u0641\u064A\u0629"],
  "settings.memory": ["Global memory", "\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0639\u0627\u0645\u0629"],
  "settings.memory.hint": ["Memory injected into every agent run, combined with the workspace MEMORY.md", "\u0630\u0627\u0643\u0631\u0629 \u062A\u064F\u062D\u0642\u0646 \u0641\u064A \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u0644\u0644\u0648\u0643\u064A\u0644 \u0648\u062A\u064F\u062F\u0645\u062C \u0645\u0639 MEMORY.md \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "settings.memory.ph": ["Anything the agent should always know\u2026", "\u0623\u064A \u0634\u064A\u0621 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0639\u0631\u0641\u0647 \u0627\u0644\u0648\u0643\u064A\u0644 \u062F\u0627\u0626\u0645\u0627\u064B\u2026"],
  // — reasoning depth (model picker)
  "mp.reasoning": ["Reasoning depth (extended thinking)", "\u0639\u0645\u0642 \u0627\u0644\u062A\u0641\u0643\u064A\u0631 (\u062A\u0641\u0643\u064A\u0631 \u0645\u0645\u062A\u062F)"],
  "mp.reasoningHint": ["Higher = deeper thinking for hard problems (slower, more tokens). Uses Anthropic thinking, o-series reasoning_effort and OpenRouter reasoning.", "\u0627\u0644\u0623\u0639\u0644\u0649 = \u062A\u0641\u0643\u064A\u0631 \u0623\u0639\u0645\u0642 \u0644\u0644\u0645\u0633\u0627\u0626\u0644 \u0627\u0644\u0635\u0639\u0628\u0629 (\u0623\u0628\u0637\u0623 \u0648\u0631\u0645\u0648\u0632 \u0623\u0643\u062B\u0631). \u064A\u0633\u062A\u062E\u062F\u0645 \u062A\u0641\u0643\u064A\u0631 Anthropic \u0648reasoning_effort \u0644\u0633\u0644\u0633\u0644\u0629 o \u0648OpenRouter."],
  "mp.reasoning.off": ["Off", "\u0645\u0639\u0637\u0644"],
  "mp.reasoning.low": ["Low", "\u0645\u0646\u062E\u0641\u0636"],
  "mp.reasoning.medium": ["Medium", "\u0645\u062A\u0648\u0633\u0637"],
  "mp.reasoning.high": ["High", "\u0639\u0627\u0644\u064D"]
};
var D_V21 = {
  "chat.console": ["AGENT CONSOLE", "\u0643\u0648\u0646\u0633\u0648\u0644 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "chat.dismissQueued": ["Dismiss queued message", "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0645\u0646\u062A\u0638\u0631\u0629"],
  "chat.doom.always": ["ALWAYS THIS TOOL", "\u0627\u0644\u0633\u0645\u0627\u062D \u062F\u0627\u0626\u0645\u0627\u064B \u0644\u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0627\u0629"],
  "chat.doom.body": ["the engine paused before repeating the same call again", "\u0623\u0648\u0642\u0641 \u0627\u0644\u0645\u062D\u0631\u0643 \u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u0642\u0628\u0644 \u062A\u0643\u0631\u0627\u0631 \u0646\u0641\u0633 \u0627\u0644\u0646\u062F\u0648\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649"],
  "chat.doom.stop": ["STOP", "\u0625\u064A\u0642\u0627\u0641"],
  "chat.doom.title": ["Repeating tool call detected", "\u062A\u0645 \u0627\u0643\u062A\u0634\u0627\u0641 \u0646\u062F\u0648\u0629 \u0623\u062F\u0627\u0629 \u0645\u062A\u0643\u0631\u0631\u0629"],
  "chat.plan.auto": ["APPROVE \u2014 EXECUTE AUTO", "\u0645\u0648\u0627\u0641\u0642\u0629 \u2014 \u062A\u0646\u0641\u064A\u0630 \u062A\u0644\u0642\u0627\u0626\u064A"],
  "chat.plan.autoHint": ["edits auto \xB7 commands still ask", "\u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \xB7 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u062A\u0628\u0642\u0649 \u0628\u0627\u0644\u062A\u0623\u0643\u064A\u062F"],
  "chat.plan.manual": ["APPROVE \u2014 ASK PER STEP", "\u0645\u0648\u0627\u0641\u0642\u0629 \u2014 \u062A\u0623\u0643\u064A\u062F \u0644\u0643\u0644 \u062E\u0637\u0648\u0629"],
  "chat.plan.manualHint": ["confirm before every step", "\u062A\u0623\u0643\u064A\u062F \u0642\u0628\u0644 \u0643\u0644 \u062E\u0637\u0648\u0629"],
  "chat.plan.revise": ["REVISE", "\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u062E\u0637\u0629"],
  "chat.plan.reviseHint": ["send feedback \xB7 get a new plan", "\u0623\u0631\u0633\u0644 \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643 \xB7 \u062A\u062D\u0635\u0644 \u0639\u0644\u0649 \u062E\u0637\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "chat.plan.revisePh": ["What should change in this plan?", "\u0645\u0627 \u0627\u0644\u0630\u064A \u064A\u062C\u0628 \u062A\u063A\u064A\u064A\u0631\u0647 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0629\u061F"],
  "chat.plan.send": ["SEND", "\u0625\u0631\u0633\u0627\u0644"],
  "chat.recap": ["Export recap (Markdown)", "\u062A\u0635\u062F\u064A\u0631 \u0645\u0644\u062E\u0635 \u0627\u0644\u062C\u0644\u0633\u0629 (Markdown)"],
  "chat.more": ["More actions", "\u0645\u0632\u064A\u062F \u0645\u0646 \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A"],
  "chat.reviewClean": ["CLEAN", "\u0633\u0644\u064A\u0645"],
  "chat.reviewDismiss": ["Dismiss review", "\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629"],
  "chat.reviewRun": ["Run structured review", "\u062A\u0634\u063A\u064A\u0644 \u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u0646\u0638\u0645\u0629"],
  "chat.reviewTitle": ["REVIEW", "\u0645\u0631\u0627\u062C\u0639\u0629"],
  "chat.runHint": ["ENTER queue \xB7 SHIFT+ENTER steer", "ENTER \u0644\u0644\u0637\u0627\u0628\u0648\u0631 \xB7 SHIFT+ENTER \u0644\u0644\u062A\u0648\u062C\u064A\u0647 \u0627\u0644\u0641\u0648\u0631\u064A"],
  "chat.skillDelete": ["Delete skill", "\u062D\u0630\u0641 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "chat.skills": ["Skills", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  "chat.skillsEmpty": ["No skills yet \u2014 reusable SKILL.md files extracted from completed sessions appear here.", "\u0644\u0627 \u0645\u0647\u0627\u0631\u0627\u062A \u0628\u0639\u062F \u2014 \u0645\u0644\u0641\u0627\u062A SKILL.md \u0627\u0644\u0642\u0627\u0628\u0644\u0629 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C\u0629 \u0645\u0646 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0645\u0643\u062A\u0645\u0644\u0629 \u062A\u0638\u0647\u0631 \u0647\u0646\u0627."],
  "chat.steerPending": ["STEER PENDING", "\u062A\u0648\u062C\u064A\u0647 \u0628\u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631"],
  "chat.subagents": ["Background subagents", "\u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u0648\u0646 \u0641\u064A \u0627\u0644\u062E\u0644\u0641\u064A\u0629"],
  "common.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "common.off": ["OFF", "\u0645\u0639\u0637\u0644"],
  "common.on": ["ON", "\u0645\u0641\u0639\u0651\u0644"],
  "comp.taskMode": ["Task mode", "\u0646\u0645\u0637 \u0627\u0644\u0645\u0647\u0645\u0629"],
  "git.ahead": ["commits ahead of upstream", "\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A \u0645\u062A\u0642\u062F\u0645\u0629 \u0639\u0646 \u0627\u0644\u0623\u0635\u0644"],
  "git.behind": ["commits behind upstream", "\u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A \u0645\u062A\u0623\u062E\u0631\u0629 \u0639\u0646 \u0627\u0644\u0623\u0635\u0644"],
  "git.history": ["History", "\u0627\u0644\u0633\u062C\u0644"],
  "git.historyEmpty": ["No commits yet", "\u0644\u0627 \u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A \u0628\u0639\u062F"],
  "git.review.clean": ["No findings \u2014 the working diff looks clean.", "\u0644\u0627 \u0645\u0644\u0627\u062D\u0638\u0627\u062A \u2014 \u0627\u0644\u0641\u0631\u0648\u0642 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u062A\u0628\u062F\u0648 \u0633\u0644\u064A\u0645\u0629."],
  "git.review.failed": ["Review failed", "\u0641\u0634\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629"],
  "git.review.run": ["Review working diff", "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0641\u0631\u0648\u0642 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "git.review.title": ["Review", "\u0645\u0631\u0627\u062C\u0639\u0629"],
  "git.review.unavailable": ["Review bridge unavailable in this build", "\u062C\u0633\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "git.styleMatch": ["Style-match commit message", "\u0645\u0637\u0627\u0628\u0642\u0629 \u0623\u0633\u0644\u0648\u0628 \u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645"],
  "git.styleMatch.off": ["Style-match commit message: OFF", "\u0645\u0637\u0627\u0628\u0642\u0629 \u0623\u0633\u0644\u0648\u0628 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645: \u0645\u0639\u0637\u0644\u0629"],
  "git.styleMatch.on": ["Style-match commit message: ON \u2014 follows your recent commit style", "\u0645\u0637\u0627\u0628\u0642\u0629 \u0623\u0633\u0644\u0648\u0628 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645: \u0645\u0641\u0639\u0651\u0644\u0629 \u2014 \u062A\u062A\u0628\u0639 \u0623\u0633\u0644\u0648\u0628 \u0627\u0644\u062A\u0632\u0627\u0645\u0627\u062A\u0643 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "mcp.activity.clear": ["Clear", "\u062A\u0641\u0631\u064A\u063A"],
  "mcp.activity.empty": ["No tool calls yet this session.", "\u0644\u0627 \u0646\u062F\u0648\u0627\u062A \u0623\u062F\u0648\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0628\u0639\u062F."],
  "mcp.activity.hint": ["Last 100 MCP tool calls this session (cleared on restart).", "\u0622\u062E\u0631 100 \u0646\u062F\u0648\u0629 \u0623\u062F\u0627\u0629 MCP \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 (\u062A\u064F\u0641\u0631\u064E\u0651\u063A \u0639\u0646\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644)."],
  "mcp.ann.idem": ["idempotentHint \u2014 repeat-safe", "idempotentHint \u2014 \u0622\u0645\u0646\u0629 \u0644\u0644\u062A\u0643\u0631\u0627\u0631"],
  "mcp.ann.open": ["openWorldHint \u2014 accesses external systems", "openWorldHint \u2014 \u062A\u0635\u0644 \u0625\u0644\u0649 \u0623\u0646\u0638\u0645\u0629 \u062E\u0627\u0631\u062C\u064A\u0629"],
  "mcp.ann.ro": ["readOnlyHint \u2014 read-only tool", "readOnlyHint \u2014 \u0623\u062F\u0627\u0629 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637"],
  "mcp.approvalAlways": ['You approved this tool ("Always allow")', '\u0648\u0627\u0641\u0642\u062A \u0639\u0644\u0649 \u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0627\u0629 ("\u0627\u0644\u0633\u0645\u0627\u062D \u062F\u0627\u0626\u0645\u0627\u064B")'],
  "mcp.approvalDeny": ["You denied this tool \u2014 calls are blocked. Reset to allow again.", "\u0631\u0641\u0636\u062A \u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0627\u0629 \u2014 \u0627\u0644\u0646\u062F\u0648\u0627\u062A \u0645\u062D\u062C\u0648\u0628\u0629. \u0623\u0639\u062F \u0627\u0644\u062A\u0639\u064A\u064A\u0646 \u0644\u0644\u0633\u0645\u0627\u062D \u0645\u062C\u062F\u062F\u0627\u064B."],
  "mcp.approvalReset": ["Reset remembered approval", "\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629"],
  "mcp.autoQuarantine": ["Auto-quarantine servers whose tool descriptions look poisoned", "\u062D\u062C\u0631 \u062A\u0644\u0642\u0627\u0626\u064A \u0644\u0644\u062E\u0648\u0627\u062F\u0645 \u0627\u0644\u062A\u064A \u062A\u0628\u062F\u0648 \u0623\u0648\u0635\u0627\u0641 \u0623\u062F\u0648\u0627\u062A\u0647\u0627 \u0645\u0633\u0645\u0648\u0645\u0629"],
  "mcp.destructiveNote": ['DANGER tools (readOnlyHint=false or destructiveHint=true) ask for approval on every call \u2014 you can answer "Always allow" or "Deny".', '\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062E\u0637\u0631 (readOnlyHint=false \u0623\u0648 destructiveHint=true) \u062A\u0637\u0644\u0628 \u0645\u0648\u0627\u0641\u0642\u0629 \u0641\u064A \u0643\u0644 \u0646\u062F\u0648\u0629 \u2014 \u064A\u0645\u0643\u0646\u0643 \u0627\u062E\u062A\u064A\u0627\u0631 "\u0627\u0644\u0633\u0645\u0627\u062D \u062F\u0627\u0626\u0645\u0627\u064B" \u0623\u0648 "\u0631\u0641\u0636".'],
  "mcp.healthCheckNow": ["Health-check now", "\u0641\u062D\u0635 \u0627\u0644\u0635\u062D\u0629 \u0627\u0644\u0622\u0646"],
  "mcp.healthQuarantine": ["Quarantined \u2014 tool calls are blocked", "\u0645\u062D\u062C\u0648\u0631 \u2014 \u0646\u062F\u0648\u0627\u062A \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u062D\u062C\u0648\u0628\u0629"],
  "mcp.quarantined": ["Quarantined \u2014 tool execution is blocked for this server.", "\u0645\u062D\u062C\u0648\u0631 \u2014 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u062D\u062C\u0648\u0628 \u0644\u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645."],
  "mcp.registry.add": ["Add server", "\u0625\u0636\u0627\u0641\u0629 \u062E\u0627\u062F\u0645"],
  "mcp.registry.confirmAdd": ["Add this server to your MCP config?", "\u0625\u0636\u0627\u0641\u0629 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0625\u0644\u0649 \u0625\u0639\u062F\u0627\u062F\u0627\u062A MCP\u061F"],
  "mcp.registry.customize": ["Customize\u2026", "\u062A\u062E\u0635\u064A\u0635\u2026"],
  "mcp.registry.empty": ["No registry matches. Try another query.", "\u0644\u0627 \u0646\u062A\u0627\u0626\u062C \u0641\u064A \u0627\u0644\u0633\u062C\u0644. \u062C\u0631\u0651\u0628 \u0628\u062D\u062B\u0627\u064B \u0622\u062E\u0631."],
  "mcp.registry.hint": ["registry.modelcontextprotocol.io \u2014 30k+ community servers. Review the install command before adding.", "registry.modelcontextprotocol.io \u2014 \u0623\u0643\u062B\u0631 \u0645\u0646 30 \u0623\u0644\u0641 \u062E\u0627\u062F\u0645 \u0645\u062C\u062A\u0645\u0639\u064A. \u0631\u0627\u062C\u0639 \u0623\u0645\u0631 \u0627\u0644\u062A\u062B\u0628\u064A\u062A \u0642\u0628\u0644 \u0627\u0644\u0625\u0636\u0627\u0641\u0629."],
  "mcp.registry.more": ["Load more", "\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0632\u064A\u062F"],
  "mcp.registry.placeholder": ["Search the official MCP registry\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0633\u062C\u0644 MCP \u0627\u0644\u0631\u0633\u0645\u064A\u2026"],
  "mcp.registry.search": ["Search", "\u0628\u062D\u062B"],
  "mcp.release": ["Release", "\u0641\u0643 \u0627\u0644\u062D\u062C\u0632"],
  "mcp.scanner": ["Description scanner", "\u0641\u0627\u062D\u0635 \u0627\u0644\u0623\u0648\u0635\u0627\u0641"],
  "mcp.tab.activity": ["Activity", "\u0627\u0644\u0646\u0634\u0627\u0637"],
  "mcp.tab.registry": ["Registry", "\u0627\u0644\u0633\u062C\u0644"],
  "mcp.tab.servers": ["Servers", "\u0627\u0644\u062E\u0648\u0627\u062F\u0645"],
  "mcp.toolHidden": ["Disabled \u2014 hidden from the model until re-enabled.", "\u0645\u0639\u0637\u0644\u0629 \u2014 \u0645\u062E\u0641\u064A\u0629 \u0639\u0646 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u062D\u062A\u0649 \u0625\u0639\u0627\u062F\u0629 \u062A\u0641\u0639\u064A\u0644\u0647\u0627."],
  "mcp.toolsList": ["Tools", "\u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "mp.ctxTip": ["Context window", "\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "mp.customPh": ["my-org/my-model", "\u0645\u0624\u0633\u0633\u062A\u064A/\u0645\u0648\u062F\u064A\u0644\u064A"],
  "mp.free": ["FREE", "\u0645\u062C\u0627\u0646\u064A"],
  "mp.freeTip": ["No metered cost", "\u0628\u0644\u0627 \u062A\u0643\u0644\u0641\u0629 \u0645\u062D\u0633\u0648\u0628\u0629"],
  "mp.navMove": ["navigate", "\u062A\u0646\u0642\u0644"],
  "mp.navSelect": ["select", "\u0627\u062E\u062A\u064A\u0627\u0631"],
  "mp.none": ["No models match", "\u0644\u0627 \u0645\u0648\u062F\u064A\u0644\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629"],
  "mp.priceTip": ["Estimated USD per 1M tokens (input / output)", "\u0627\u0644\u062A\u0642\u062F\u064A\u0631 \u0628\u0627\u0644\u062F\u0648\u0644\u0627\u0631 \u0644\u0643\u0644 \u0645\u0644\u064A\u0648\u0646 \u0631\u0645\u0632 (\u0625\u062F\u062E\u0627\u0644 / \u0625\u062E\u0631\u0627\u062C)"],
  "mp.reason": ["REASON", "\u062A\u0641\u0643\u064A\u0631"],
  "mp.reasonTip": ["Reasoning / extended thinking", "\u0627\u0633\u062A\u062F\u0644\u0627\u0644 / \u062A\u0641\u0643\u064A\u0631 \u0645\u0645\u062A\u062F"],
  "mp.rec": ["Recommended for coding", "\u0645\u0648\u0635\u0649 \u0628\u0647 \u0644\u0644\u0628\u0631\u0645\u062C\u0629"],
  "mp.recShort": ["Rec", "\u0645\u0648\u0635\u0649"],
  "mp.searchPh": ["Filter models\u2026", "\u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0645\u0648\u062F\u064A\u0644\u0627\u062A\u2026"],
  "mp.vision": ["VISION", "\u0631\u0624\u064A\u0629"],
  "mp.visionTip": ["Accepts image input", "\u064A\u0642\u0628\u0644 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0635\u0648\u0631"],
  "onboard.account.set": ["Profile ready \u2014 you can continue.", "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A \u062C\u0627\u0647\u0632 \u2014 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629."],
  "onboard.ai.later": ["You can change the provider or model anytime from Settings.", "\u064A\u0645\u0643\u0646\u0643 \u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0645\u0632\u0648\u062F \u0623\u0648 \u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u0641\u064A \u0623\u064A \u0648\u0642\u062A \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A."],
  "sched.next": ["next", "\u0627\u0644\u062A\u0627\u0644\u064A"],
  "sched.nextRun": ["Next run", "\u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A"],
  "sched.state.active": ["ACTIVE", "\u0646\u0634\u0637"],
  "sched.state.err": ["ERR", "\u062E\u0637\u0623"],
  "sched.state.paused": ["PAUSED", "\u0645\u062A\u0648\u0642\u0641"],
  "sched.toggle": ["Enable job", "\u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u0645\u0647\u0645\u0629"],
  "security.actions": ["Quick actions", "\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0633\u0631\u064A\u0639\u0629"],
  "security.actions.clearAudit": ["Clear audit trail", "\u062A\u0641\u0631\u064A\u063A \u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642"],
  "security.actions.export": ["Export my data", "\u062A\u0635\u062F\u064A\u0631 \u0628\u064A\u0627\u0646\u0627\u062A\u064A"],
  "security.actions.hint": ["Guard mode, data controls and secret storage live in Settings \u2192 Privacy.", "\u0646\u0645\u0637 \u0627\u0644\u062D\u0627\u0631\u0633 \u0648\u0636\u0648\u0627\u0628\u0637 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0648\u0645\u062E\u0632\u0646 \u0627\u0644\u0623\u0633\u0631\u0627\u0631 \u0641\u064A \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629."],
  "security.actions.privacy": ["Privacy settings", "\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629"],
  "security.allowedRoots": ["Allowed roots", "\u0627\u0644\u062C\u0630\u0648\u0631 \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629"],
  "security.audit.clearConfirm": ["Clear the security audit trail? This cannot be undone.", "\u062A\u0641\u0631\u064A\u063A \u0633\u062C\u0644 \u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0623\u0645\u0627\u0646\u061F \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639."],
  "security.audit.cleared": ["Audit trail cleared ({{n}} entries)", "\u0641\u064F\u0631\u0651\u063A \u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642 ({{n}} \u0642\u064A\u062F\u0627\u064B)"],
  "security.audit.empty": ["Nothing recorded yet \u2014 this session has been quiet.", "\u0644\u0627 \u0634\u064A\u0621 \u0645\u0633\u062C\u0644 \u0628\u0639\u062F \u2014 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0647\u0627\u062F\u0626\u0629."],
  "security.audit.events": ["events", "\u0623\u062D\u062F\u0627\u062B"],
  "security.audit.hint": ["Append-only log at appData/audit.jsonl \u2014 blocks, approvals and redactions.", "\u0633\u062C\u0644 \u0625\u0644\u062D\u0627\u0642\u064A \u0641\u064A appData/audit.jsonl \u2014 \u0627\u0644\u062D\u062C\u0628 \u0648\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A \u0648\u0627\u0644\u062A\u0646\u0642\u064A\u0637."],
  "security.audit.label": ["Audit trail", "\u0633\u062C\u0644 \u0627\u0644\u062A\u062F\u0642\u064A\u0642"],
  "security.audit.openViewer": ["Open security panel", "\u0641\u062A\u062D \u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0645\u0627\u0646"],
  "security.audit.recent": ["Recent audit events", "\u0623\u062D\u062F\u062B \u0623\u062D\u062F\u0627\u062B \u0627\u0644\u062A\u062F\u0642\u064A\u0642"],
  "security.blockedReason": ["dangerous command", "\u0623\u0645\u0631 \u062E\u0637\u0650\u0631"],
  "security.blockedToast": ["Terminal guard blocked", "\u062D\u062C\u0628\u0647 \u062D\u0627\u0631\u0633 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "security.export.done": ["Data exported to", "\u0635\u064F\u062F\u0650\u0651\u0631\u062A \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0625\u0644\u0649"],
  "security.fsGuards": ["FS symlink guards", "\u062C\u062F\u0631\u0627\u0646 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0631\u0645\u0632\u064A\u0629"],
  "security.fsGuards.hint": ["Writes are realpath-verified to stay inside the workspace and app data dir.", "\u062A\u064F\u062A\u062D\u0642\u0642 \u0627\u0644\u0643\u062A\u0627\u0628\u0627\u062A \u0639\u0628\u0631 realpath \u0644\u0644\u0628\u0642\u0627\u0621 \u062F\u0627\u062E\u0644 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0648\u0645\u062C\u0644\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642."],
  "security.fsGuards.on": ["ON", "\u0645\u0641\u0639\u0651\u0644\u0629"],
  "security.fsGuards.standby": ["STANDBY", "\u0628\u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631"],
  "security.logRedaction": ["Log redaction", "\u062A\u0646\u0642\u064A\u0637 \u0627\u0644\u0633\u062C\u0644\u0627\u062A"],
  "security.logRedaction.hint": ["API keys, tokens and passwords are replaced with \xABredacted\xBB before anything is written to the log.", "\u0645\u0641\u0627\u062A\u064A\u062D API \u0648\u0627\u0644\u0631\u0645\u0648\u0632 \u0648\u0643\u0644\u0645\u0627\u062A \u0627\u0644\u0633\u0631 \u062A\u0633\u062A\u0628\u062F\u0644 \u0628\u0640\xABredacted\xBB \u0642\u0628\u0644 \u0623\u064A \u0643\u062A\u0627\u0628\u0629 \u0641\u064A \u0627\u0644\u0633\u062C\u0644."],
  "security.mode.off": ["OFF", "\u0645\u0639\u0637\u0644"],
  "security.mode.on": ["ON", "\u0645\u0641\u0639\u0651\u0644"],
  "security.mode.warnOnly": ["WARN-ONLY", "\u062A\u062D\u0630\u064A\u0631 \u0641\u0642\u0637"],
  "security.redactedThisSession": ["blocked this session", "\u062D\u064F\u062C\u0628\u062A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "security.status": ["Protection status", "\u062D\u0627\u0644\u0629 \u0627\u0644\u062D\u0645\u0627\u064A\u0629"],
  "security.terminalGuard": ["Terminal guard", "\u062D\u0627\u0631\u0633 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "security.terminalGuard.hint": ["Classifies every shell line before it runs; dangerous commands are held for approval.", "\u064A\u0635\u0646\u0651\u0641 \u0643\u0644 \u0633\u0637\u0631 \u0623\u0645\u0631 \u0642\u0628\u0644 \u062A\u0646\u0641\u064A\u0630\u0647\u061B \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u064F\u062D\u062C\u0632 \u0644\u0644\u0645\u0648\u0627\u0641\u0642\u0629."],
  "security.title": ["Security", "\u0627\u0644\u0623\u0645\u0627\u0646"],
  "security.unavailable": ["Security bridge unavailable in this build", "\u062C\u0633\u0631 \u0627\u0644\u0623\u0645\u0627\u0646 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "sess.noneHint": ["Start a run from the composer \u2014 every conversation is archived here.", "\u0627\u0628\u062F\u0623 \u062A\u0634\u063A\u064A\u0644\u0627\u064B \u0645\u0646 \u0627\u0644\u0645\u062D\u0631\u0631 \u2014 \u0643\u0644 \u0645\u062D\u0627\u062F\u062B\u0629 \u062A\u064F\u0624\u0631\u0634\u0641 \u0647\u0646\u0627."],
  "sess.recap": ["Export recap (copy to clipboard)", "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u0644\u062E\u0635 (\u0646\u0633\u062E \u0644\u0644\u062D\u0627\u0641\u0638\u0629)"],
  "sess.recap.copied": ["Recap copied to clipboard", "\u0646\u064F\u0633\u062E \u0627\u0644\u0645\u0644\u062E\u0635 \u0625\u0644\u0649 \u0627\u0644\u062D\u0627\u0641\u0638\u0629"],
  "sess.recap.failed": ["Could not build a recap", "\u062A\u0639\u0630\u0651\u0631 \u0628\u0646\u0627\u0621 \u0627\u0644\u0645\u0644\u062E\u0635"],
  "sess.recap.unavailable": ["Recap bridge unavailable in this build", "\u062C\u0633\u0631 \u0627\u0644\u0645\u0644\u062E\u0635 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "sess.st.done": ["DONE", "\u0645\u0643\u062A\u0645\u0644\u0629"],
  "sess.st.empty": ["EMPTY", "\u0641\u0627\u0631\u063A\u0629"],
  "sess.st.err": ["ERR", "\u062E\u0637\u0623"],
  "sess.st.errHint": ["last run failed", "\u0641\u0634\u0644 \u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644"],
  "sess.st.idle": ["IDLE", "\u062E\u0627\u0645\u0644\u0629"],
  "sess.st.idleHint": ["open, idle", "\u0645\u0641\u062A\u0648\u062D\u0629\u060C \u062E\u0627\u0645\u0644\u0629"],
  "sess.st.run": ["RUN", "\u062A\u0639\u0645\u0644"],
  "settings.agent.autoVerify": ["Auto-verify after edits", "\u062A\u062D\u0642\u0642 \u062A\u0644\u0642\u0627\u0626\u064A \u0628\u0639\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A"],
  "settings.agent.autoVerify.hint": ["Runs the project build / test / typecheck after consecutive edits and self-repairs failures.", "\u064A\u0634\u063A\u0651\u0644 \u0628\u0646\u0627\u0621/\u0627\u062E\u062A\u0628\u0627\u0631/\u0641\u062D\u0635 \u0623\u0646\u0648\u0627\u0639 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0628\u0639\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u062A\u062A\u0627\u0644\u064A\u0629 \u0648\u064A\u0635\u0644\u062D \u0627\u0644\u0625\u062E\u0641\u0627\u0642\u0627\u062A \u0630\u0627\u062A\u064A\u0627\u064B."],
  "settings.agent.compactThreshold.hint": ["20,000\u2013400,000 chars of transcript before a compaction pass runs", "20,000\u2013400,000 \u062D\u0631\u0641\u0627\u064B \u0645\u0646 \u0627\u0644\u0633\u062C\u0644 \u0642\u0628\u0644 \u062A\u0634\u063A\u064A\u0644 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0636\u063A\u0637"],
  "settings.agent.danger.alwaysAsk": ["ALWAYS ASK", "\u062A\u0623\u0643\u064A\u062F \u062F\u0627\u0626\u0645\u0627\u064B"],
  "settings.agent.danger.gateOff": ["GATE OFF", "\u0627\u0644\u0628\u0648\u0627\u0628\u0629 \u0645\u0639\u0637\u0644\u0629"],
  "settings.agent.dangerGate": ["Skip danger gate (not recommended)", "\u062A\u062C\u0627\u0648\u0632 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u062E\u0637\u0631 (\u063A\u064A\u0631 \u0645\u0648\u0635\u0649 \u0628\u0647)"],
  "settings.agent.dangerGate.desc": ["When enabled, dangerous shell commands skip the always-ask gate. Keep it off unless you know what you are doing.", "\u0639\u0646\u062F \u0627\u0644\u062A\u0641\u0639\u064A\u0644\u060C \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u062A\u062C\u0627\u0648\u0632 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0627\u0644\u062F\u0627\u0626\u0645. \u0623\u062A\u0631\u0643\u0647 \u0645\u0639\u0637\u0644\u0627\u064B \u0625\u0644\u0627 \u0625\u0630\u0627 \u0643\u0646\u062A \u062A\u0639\u0631\u0641 \u0645\u0627 \u062A\u0641\u0639\u0644\u0647."],
  "settings.agent.dangerGate.label": ["Skip danger gate (not recommended)", "\u062A\u062C\u0627\u0648\u0632 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u062E\u0637\u0631 (\u063A\u064A\u0631 \u0645\u0648\u0635\u0649 \u0628\u0647)"],
  "settings.agent.dangerPolicy": ["Dangerous-command policy", "\u0633\u064A\u0627\u0633\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629"],
  "settings.agent.dangerPolicy.hint": ["Danger-classified commands are always held for your approval unless the gate is skipped.", "\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0645\u0635\u0646\u0641\u0629 \u062E\u0637\u0631\u0629 \u062A\u064F\u062D\u062C\u0632 \u062F\u0627\u0626\u0645\u0627\u064B \u0644\u0645\u0648\u0627\u0641\u0642\u062A\u0643 \u0645\u0627 \u0644\u0645 \u062A\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u0628\u0648\u0627\u0628\u0629."],
  "settings.fontSize.hint": ["12\u201320 px \u2014 applied to every editor tab", "12\u201320 \u0628\u0643\u0633\u0644 \u2014 \u062A\u064F\u0637\u0628\u0642 \u0639\u0644\u0649 \u0643\u0644 \u062A\u0628\u0648\u064A\u0628\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.mcp.quarantineTip": ["Quarantined \u2014 tool execution blocked", "\u0645\u062D\u062C\u0648\u0631 \u2014 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u062D\u062C\u0648\u0628"],
  "settings.mcp.quarantinedServer": ["{name} was auto-quarantined by the tool-poisoning scanner.", "\u062D\u062C\u0631\u0647 \u0627\u0644\u0641\u0627\u062D\u0635 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0644\u0627\u0634\u062A\u0628\u0627\u0647 \u062A\u0633\u0645\u064A\u0645 \u0627\u0644\u0623\u062F\u0648\u0627\u062A: {name}."],
  "settings.mcp.quarantinedShort": ["quarantined", "\u0645\u062D\u062C\u0648\u0631"],
  "settings.privacy.audit.hint": ["Append-only JSONL at appData/audit.jsonl \u2014 terminal blocks, approvals, fs blocks and secret redactions.", "JSONL \u0625\u0644\u062D\u0627\u0642\u064A \u0641\u064A appData/audit.jsonl \u2014 \u062D\u062C\u0628 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0648\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A \u0648\u062D\u062C\u0628 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u062A\u0646\u0642\u064A\u0637 \u0627\u0644\u0623\u0633\u0631\u0627\u0631."],
  "settings.privacy.clear": ["Clear", "\u062A\u0641\u0631\u064A\u063A"],
  "settings.privacy.clearMcp.confirm": ["Clear cached MCP/tool approval decisions? Tools will ask again.", "\u062A\u0641\u0631\u064A\u063A \u0642\u0631\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u0644\u0623\u062F\u0648\u0627\u062A MCP\u061F \u0633\u062A\u0633\u0623\u0644 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u0646 \u062C\u062F\u064A\u062F."],
  "settings.privacy.clearMcp.done": ["Approval cache cleared", "\u0641\u064F\u0631\u0651\u063A\u062A \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A"],
  "settings.privacy.clearMcp.label": ["MCP approvals cache", "\u0630\u0627\u0643\u0631\u0629 \u0645\u0648\u0627\u0641\u0642\u0627\u062A MCP"],
  "settings.privacy.clearMemory.confirm": ["Clear the agent\u2019s learned memory (MEMORY.md \u201C## Learned\u201D) for this workspace? Your hand-written notes are kept.", "\u062A\u0641\u0631\u064A\u063A \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u062A\u0639\u0644\u0645\u0629 (MEMORY.md \xAB## Learned\xBB) \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629\u061F \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643 \u0627\u0644\u064A\u062F\u0648\u064A\u0629 \u062A\u0628\u0642\u0649."],
  "settings.privacy.clearMemory.done": ["Auto-memory cleared", "\u0641\u064F\u0631\u0651\u063A\u062A \u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A\u0629"],
  "settings.privacy.clearMemory.label": ["Agent auto-memory (this workspace)", "\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A\u0629 (\u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629)"],
  "settings.privacy.clearSessions.confirm": ["Delete ALL saved agent sessions on this device? This cannot be undone.", "\u062D\u0630\u0641 \u0643\u0644 \u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632\u061F \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639."],
  "settings.privacy.clearSessions.done": ["Deleted {{n}} sessions", "\u062D\u064F\u0630\u0641\u062A {{n}} \u062C\u0644\u0633\u0629"],
  "settings.privacy.clearSessions.label": ["Session history", "\u0633\u062C\u0644 \u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "settings.privacy.dataControls": ["Data controls", "\u0636\u0648\u0627\u0628\u0637 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"],
  "settings.privacy.dataControls.hint": ["Exports land in appData/exports. The export always strips provider API keys; every action above asks for confirmation first.", "\u0627\u0644\u0635\u0627\u062F\u0631\u0627\u062A \u062A\u0630\u0647\u0628 \u0625\u0644\u0649 appData/exports. \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u064A\u062D\u0630\u0641 \u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646 \u062F\u0627\u0626\u0645\u0627\u064B\u061B \u0643\u0644 \u0625\u062C\u0631\u0627\u0621 \u0623\u0639\u0644\u0627\u0647 \u064A\u0637\u0644\u0628 \u062A\u0623\u0643\u064A\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B."],
  "settings.privacy.export": ["Export", "\u062A\u0635\u062F\u064A\u0631"],
  "settings.privacy.export.done": ["Export saved to", "\u062D\u064F\u0641\u0638 \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u0641\u064A"],
  "settings.privacy.export.label": ["Export my data as a JSON zip", "\u062A\u0635\u062F\u064A\u0631 \u0628\u064A\u0627\u0646\u0627\u062A\u064A \u0643\u062D\u0632\u0645\u0629 JSON \u0645\u0636\u063A\u0648\u0637\u0629"],
  "settings.privacy.footer": ["Nothing here phones home. Every control on this page operates on files inside this user\u2019s app data directory.", "\u0644\u0627 \u0634\u064A\u0621 \u0647\u0646\u0627 \u064A\u062A\u0635\u0644 \u0628\u0627\u0644\u062E\u0627\u0631\u062C. \u0643\u0644 \u0639\u0646\u0635\u0631 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629 \u064A\u0639\u0645\u0644 \u0639\u0644\u0649 \u0645\u0644\u0641\u0627\u062A \u062F\u0627\u062E\u0644 \u0645\u062C\u0644\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645."],
  "settings.privacy.needWorkspace": ["Open a workspace first \u2014 auto-memory lives in the workspace.", "\u0627\u0641\u062A\u062D \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0623\u0648\u0644\u0627\u064B \u2014 \u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u062A\u0633\u0643\u0646 \u0627\u0644\u0645\u0633\u0627\u062D\u0629."],
  "settings.privacy.permissions": ["Permission rules", "\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "settings.privacy.permissions.autoApprove": ["Auto-approve file edits", "\u0642\u0628\u0648\u0644 \u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.privacy.permissions.blocked": ["Blocked commands (trail)", "\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0645\u062D\u062C\u0648\u0628\u0629 (\u0627\u0644\u0633\u062C\u0644)"],
  "settings.privacy.permissions.guard": ["Terminal guard", "\u062D\u0627\u0631\u0633 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.privacy.permissions.mode": ["Permission mode", "\u0646\u0645\u0637 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "settings.privacy.permissions.mode.hint": ["Cycle it from the status bar. Editor writes and shell commands ask in this mode.", "\u0628\u062F\u0651\u0644\u0647 \u0645\u0646 \u0634\u0631\u064A\u0637 \u0627\u0644\u062D\u0627\u0644\u0629. \u0643\u062A\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0631 \u0648\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u062A\u0637\u0644\u0628 \u0627\u0644\u062A\u0623\u0643\u064A\u062F \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0646\u0645\u0637."],
  "settings.privacy.secrets": ["Secret storage", "\u0645\u062E\u0632\u0646 \u0627\u0644\u0623\u0633\u0631\u0627\u0631"],
  "settings.privacy.secrets.backend": ["OS keystore backend", "\u062E\u0632\u0627\u0646\u0629 \u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0646\u0638\u0627\u0645"],
  "settings.privacy.secrets.count": ["Stored secrets", "\u0627\u0644\u0623\u0633\u0631\u0627\u0631 \u0627\u0644\u0645\u062E\u0632\u0646\u0629"],
  "settings.privacy.secrets.fallback": ["unavailable \u2014 plain: fallback", "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u2014 \u0646\u0635 \u0635\u0631\u064A\u062D \u0643\u0628\u062F\u064A\u0644"],
  "settings.privacy.secrets.hint": ["Provider API keys are encrypted with the OS keystore when available; otherwise they are stored with an explicit plain: marker.", "\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646 \u062A\u064F\u0634\u0641\u064E\u0651\u0631 \u0628\u062E\u0632\u0627\u0646\u0629 \u0627\u0644\u0646\u0638\u0627\u0645 \u0639\u0646\u062F \u062A\u0648\u0641\u0631\u0647\u0627\u061B \u0648\u0625\u0644\u0627 \u062A\u064F\u062E\u0632\u0646 \u0628\u0639\u0644\u0627\u0645\u0629 plain: \u0635\u0631\u064A\u062D\u0629."],
  "settings.privacy.securityPanel": ["Security panel", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0645\u0627\u0646"],
  "settings.privacy.telemetry.explainer": ["Usage counters (runs/tokens/cost) are computed locally and never uploaded. Diagnostics stay in appData/logs and are redacted for secrets before writing.", "\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 (\u062A\u0634\u063A\u064A\u0644\u0627\u062A/\u0631\u0645\u0648\u0632/\u062A\u0643\u0644\u0641\u0629) \u062A\u064F\u062D\u0633\u0628 \u0645\u062D\u0644\u064A\u0627\u064B \u0648\u0644\u0627 \u062A\u064F\u0631\u0641\u0639 \u0623\u0628\u062F\u0627\u064B. \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0634\u062E\u064A\u0635 \u062A\u0628\u0642\u0649 \u0641\u064A appData/logs \u0648\u062A\u064F\u0646\u0642\u064E\u0651\u0637 \u0645\u0646 \u0627\u0644\u0623\u0633\u0631\u0627\u0631 \u0642\u0628\u0644 \u0627\u0644\u0643\u062A\u0627\u0628\u0629."],
  "settings.privacy.telemetry.state": ["OFF \u2014 always", "\u0645\u0639\u0637\u0644 \u2014 \u062F\u0627\u0626\u0645\u0627\u064B"],
  "settings.privacy.terminalGuard": ["Terminal guard", "\u062D\u0627\u0631\u0633 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.privacy.terminalGuard.blocked": ["Blocked this trail", "\u0627\u0644\u0645\u062D\u062C\u0648\u0628 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0633\u062C\u0644"],
  "settings.privacy.terminalGuard.hint": ["Every line you run in the terminal is classified first. Dangerous commands are held until you approve them once.", "\u0643\u0644 \u0633\u0637\u0631 \u062A\u0634\u063A\u0651\u0644\u0647 \u0641\u064A \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u064A\u064F\u0635\u0646\u064E\u0651\u0641 \u0623\u0648\u0644\u0627\u064B. \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u064F\u062D\u062C\u0632 \u062D\u062A\u0649 \u062A\u0648\u0627\u0641\u0642\u0647\u0627 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629."],
  "settings.privacy.terminalGuard.label": ["Shell command screening", "\u0641\u0631\u0632 \u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.termFontSize.hint": ["10\u201318 px \u2014 applied to the integrated terminal", "10\u201318 \u0628\u0643\u0633\u0644 \u2014 \u062A\u064F\u0637\u0628\u0642 \u0639\u0644\u0649 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629"],
  "settings.terminal.guard": ["Command guard", "\u062D\u0627\u0631\u0633 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "settings.terminal.guard.hint": ["Every shell line is classified before it runs: dangerous commands are blocked (ON), flagged (WARN-ONLY) or passed through (OFF).", "\u0643\u0644 \u0633\u0637\u0631 \u064A\u064F\u0635\u0646\u064E\u0651\u0641 \u0642\u0628\u0644 \u0627\u0644\u062A\u0646\u0641\u064A\u0630: \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u064F\u062D\u062C\u0628 (\u0645\u0641\u0639\u0651\u0644) \u0623\u0648 \u062A\u064F\u0646\u0628\u064E\u0651\u0647 (\u062A\u062D\u0630\u064A\u0631 \u0641\u0642\u0637) \u0623\u0648 \u062A\u0645\u0631\u0651 (\u0645\u0639\u0637\u0644)."],
  "settings.terminal.guard.label": ["Command guard", "\u062D\u0627\u0631\u0633 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "settings.terminal.guard.off.hint": ["No screening \u2014 every command runs immediately.", "\u0628\u0644\u0627 \u0641\u0631\u0632 \u2014 \u0643\u0644 \u0623\u0645\u0631 \u064A\u0639\u0645\u0644 \u0641\u0648\u0631\u0627\u064B."],
  "settings.terminal.guard.on.hint": ["Dangerous commands are held until you approve them once.", "\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u064F\u062D\u062C\u0632 \u062D\u062A\u0649 \u062A\u0648\u0627\u0641\u0642\u0647\u0627 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629."],
  "settings.terminal.guard.warn.hint": ["Dangerous commands run, but a warning toast fires first.", "\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062E\u0637\u0631\u0629 \u062A\u0639\u0645\u0644 \u0644\u0643\u0646 \u064A\u0638\u0647\u0631 \u062A\u062D\u0630\u064A\u0631 \u0623\u0648\u0644\u0627\u064B."],
  "settings.nav.providers": ["Providers", "\u0627\u0644\u0645\u0632\u0648\u062F\u0648\u0646"],
  "settings.nav.privacySecurity": ["Privacy & Security", "\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629 \u0648\u0627\u0644\u0623\u0645\u0627\u0646"],
  "term.allowFail": ["Could not whitelist the command", "\u062A\u0639\u0630\u0651\u0631\u062A \u0627\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0644\u0623\u0645\u0631"],
  "term.allowOnce": ["ALLOW ONCE", "\u0633\u0645\u0627\u062D \u0645\u0631\u0629"],
  "term.allowed": ["Allowed once \u2014 re-run the command", "\u0633\u064F\u0645\u062D \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u2014 \u0623\u0639\u062F \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0623\u0645\u0631"],
  "term.blocked": ["BLOCKED BY GUARD", "\u062D\u062C\u0628\u0647 \u0627\u0644\u062D\u0627\u0631\u0633"],
  "term.blockedCount": ["Commands blocked by the guard this session", "\u0623\u0648\u0627\u0645\u0631 \u062D\u062C\u0628\u0647\u0627 \u0627\u0644\u062D\u0627\u0631\u0633 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "term.warn": ["Command flagged", "\u0623\u064F\u0634\u064A\u0631 \u0625\u0644\u0649 \u0623\u0645\u0631"],
  "usage.avgDay": ["Average cost per day", "\u0645\u062A\u0648\u0633\u0637 \u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u064A\u0648\u0645\u064A"],
  "usage.avgDayShort": ["AVG/DAY", "\u0645\u062A\u0648\u0633\u0637/\u064A\u0648\u0645"],
  "usage.model": ["Model", "\u0627\u0644\u0645\u0648\u062F\u064A\u0644"],
  "usage.projected": ["Projected monthly cost from the 14-day average", "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0634\u0647\u0631\u064A\u0629 \u0627\u0644\u0645\u062A\u0648\u0642\u0639\u0629 \u0645\u0646 \u0645\u062A\u0648\u0633\u0637 14 \u064A\u0648\u0645\u0627\u064B"],
  "usage.projectedShort": ["PROJ/MO", "\u062A\u0648\u0642\u0639/\u0634\u0647\u0631"],
  "usage.tokensIn": ["Input tokens", "\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062F\u062E\u0627\u0644"],
  "usage.tokensOut": ["Output tokens", "\u0631\u0645\u0648\u0632 \u0627\u0644\u0625\u062E\u0631\u0627\u062C"],
  "usage.windowRuns": ["Runs in the window", "\u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0641\u064A \u0627\u0644\u0646\u0627\u0641\u0630\u0629"],
  "wscc.activity": ["Activity", "\u0627\u0644\u0646\u0634\u0627\u0637"],
  "wscc.latency": ["Latency", "\u0632\u0645\u0646 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629"],
  "wscc.mcpStatus": ["MCP status", "\u062D\u0627\u0644\u0629 MCP"],
  "wscc.noActivity": ["No changes recorded yet \u2014 edits and sessions will appear here", "\u0644\u0627 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0645\u0633\u062C\u0644\u0629 \u0628\u0639\u062F \u2014 \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0648\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0633\u062A\u0638\u0647\u0631 \u0647\u0646\u0627"],
  "wscc.reviewCode": ["Review my code", "\u0631\u0627\u062C\u0639 \u0643\u0648\u062F\u064A"],
  "wscc.scheduled": ["Scheduled", "\u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "wscc.sessionRecap": ["Session recap", "\u0645\u0644\u062E\u0635 \u0627\u0644\u062C\u0644\u0633\u0629"]
};
var D_V23 = {
  // settings → appearance (Theme & Glass / Typography / Layout / Motion)
  "settings.appearance.glassGroup": ["Theme & Glass", "\u0627\u0644\u0633\u0645\u0629 \u0648\u0627\u0644\u0632\u062C\u0627\u062C"],
  "settings.appearance.glass": ["Glass intensity", "\u0642\u0648\u0629 \u0627\u0644\u0632\u062C\u0627\u062C"],
  "settings.appearance.glass.hint": [
    "Backdrop blur depth for panels, modals, menus and cards \u2014 Strong is the deepest frost",
    "\u0639\u0645\u0642 \u0636\u0628\u0627\u0628\u064A\u0629 \u0627\u0644\u062E\u0644\u0641\u064A\u0629 \u0644\u0644\u0648\u062D\u0627\u062A \u0648\u0627\u0644\u0646\u0648\u0627\u0641\u0630 \u0648\u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0648\u0627\u0644\u0628\u0637\u0627\u0642\u0627\u062A \u2014 \xAB\u0642\u0648\u064A\xBB \u0623\u0639\u0645\u0642 \u062A\u062C\u0645\u064A\u062F"
  ],
  "settings.appearance.glass.off": ["Off", "\u0625\u064A\u0642\u0627\u0641"],
  "settings.appearance.glass.soft": ["Soft", "\u0646\u0627\u0639\u0645"],
  "settings.appearance.glass.medium": ["Medium", "\u0645\u062A\u0648\u0633\u0637"],
  "settings.appearance.glass.strong": ["Strong", "\u0642\u0648\u064A"],
  "settings.appearance.ambient": ["Ambient glow", "\u062A\u0648\u0647\u0651\u062C \u0645\u062D\u064A\u0637"],
  "settings.appearance.ambient.hint": [
    "A slow aurora of light behind the window \u2014 glass surfaces pick it up as depth",
    "\u0634\u0641\u0642 \u0636\u0648\u0626\u064A \u0628\u0637\u064A\u0621 \u062E\u0644\u0641 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u2014 \u062A\u0644\u062A\u0642\u0637\u0647 \u0627\u0644\u0623\u0633\u0637\u062D \u0627\u0644\u0632\u062C\u0627\u062C\u064A\u0629 \u0643\u0639\u0645\u0642"
  ],
  "settings.appearance.accent": ["Accent tint", "\u0644\u0648\u0646 \u0627\u0644\u062A\u0645\u064A\u064A\u0632"],
  "settings.appearance.accent.hint": [
    "Hue the glass glow, focus rings and highlights are tinted with",
    "\u062F\u0631\u062C\u0629 \u0627\u0644\u0644\u0648\u0646 \u0627\u0644\u062A\u064A \u062A\u064F\u0635\u0628\u063A \u0628\u0647\u0627 \u0648\u0647\u062C\u0627\u062A \u0627\u0644\u0632\u062C\u0627\u062C \u0648\u062D\u0644\u0642\u0627\u062A \u0627\u0644\u062A\u0631\u0643\u064A\u0632 \u0648\u0627\u0644\u0625\u0628\u0631\u0627\u0632\u0627\u062A"
  ],
  "settings.appearance.typography": ["Typography", "\u0627\u0644\u062E\u0637\u0648\u0637"],
  "settings.appearance.layout": ["Layout & Density", "\u0627\u0644\u062A\u062E\u0637\u064A\u0637 \u0648\u0627\u0644\u0643\u062B\u0627\u0641\u0629"],
  "settings.appearance.chatWidth": ["Transcript width", "\u0639\u0631\u0636 \u0633\u062C\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "settings.appearance.chatWidth.hint": [
    "Measure of the chat transcript column \u2014 Cozy keeps an easy reading line",
    "\u0639\u0631\u0636 \u0639\u0645\u0648\u062F \u0633\u062C\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u2014 \xAB\u0645\u0631\u064A\u062D\xBB \u064A\u062D\u0641\u0638 \u0633\u0637\u0631 \u0642\u0631\u0627\u0621\u0629 \u0633\u0647\u0644"
  ],
  "settings.appearance.chatWidth.cozy": ["Cozy", "\u0645\u0631\u064A\u062D"],
  "settings.appearance.chatWidth.wide": ["Wide", "\u0648\u0627\u0633\u0639"],
  "settings.appearance.chatWidth.full": ["Full", "\u0643\u0627\u0645\u0644"],
  "settings.appearance.motion": ["Motion", "\u0627\u0644\u062D\u0631\u0643\u0629"],
  "settings.appearance.motionSpeed": ["Animation speed", "\u0633\u0631\u0639\u0629 \u0627\u0644\u062D\u0631\u0643\u0629"],
  "settings.appearance.motionSpeed.hint": [
    "Scales every transition and keyframe \u2014 0.5\xD7 brisk, 1\xD7 natural, 1.5\xD7 unhurried",
    "\u064A\u0636\u0628\u0637 \u0643\u0644 \u0627\u0644\u0627\u0646\u062A\u0642\u0627\u0644\u0627\u062A \u0648\u0627\u0644\u062D\u0631\u0643\u0627\u062A \u2014 \u0660\u066B\u0665\xD7 \u0633\u0631\u064A\u0639\u060C \u0661\xD7 \u0637\u0628\u064A\u0639\u064A\u060C \u0661\u066B\u0665\xD7 \u0645\u062A\u0623\u0646\u064D"
  ],
  // chat → live run pill / streaming
  "chat.run.running": ["Running", "\u064A\u0639\u0645\u0644"],
  "chat.run.thinking": ["Thinking\u2026", "\u064A\u0641\u0643\u0651\u0631\u2026"],
  "chat.run.read": ["Reading files\u2026", "\u064A\u0642\u0631\u0623 \u0627\u0644\u0645\u0644\u0641\u0627\u062A\u2026"],
  "chat.run.write": ["Writing\u2026", "\u064A\u0643\u062A\u0628\u2026"],
  "chat.run.writing": ["Writing\u2026", "\u064A\u0643\u062A\u0628\u2026"],
  "chat.run.writeFile": ["Writing {f}\u2026", "\u064A\u0643\u062A\u0628 {f}\u2026"],
  "chat.run.edit": ["Editing\u2026", "\u064A\u0639\u062F\u0651\u0644\u2026"],
  "chat.run.editFile": ["Editing {f}\u2026", "\u064A\u0639\u062F\u0651\u0644 {f}\u2026"],
  "chat.run.cmd": ["Running command\u2026", "\u064A\u0646\u0641\u0651\u0630 \u0623\u0645\u0631\u0627\u064B\u2026"],
  "chat.run.search": ["Searching code\u2026", "\u064A\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0643\u0648\u062F\u2026"],
  "chat.run.web": ["Fetching from the web\u2026", "\u064A\u062C\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u064A\u0628\u2026"],
  "chat.run.task": ["Delegating\u2026", "\u064A\u0641\u0648\u0651\u0636 \u0645\u0647\u0645\u0629\u2026"],
  "chat.run.todo": ["Updating the plan\u2026", "\u064A\u062D\u062F\u0651\u062B \u0627\u0644\u062E\u0637\u0629\u2026"],
  "chat.run.mcp": ["Calling {t}\u2026", "\u064A\u0646\u0627\u062F\u064A {t}\u2026"],
  "chat.run.tool": ["Running {t}\u2026", "\u064A\u0634\u063A\u0651\u0644 {t}\u2026"],
  "chat.run.waiting": ["Waiting for the model\u2026", "\u064A\u0646\u062A\u0638\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C\u2026"],
  "chat.run.deep": ["Deep in thought\u2026", "\u064A\u062A\u0623\u0645\u0644 \u0628\u0639\u0645\u0642\u2026"],
  "chat.run.interrupt": ["Esc to interrupt", "Esc \u0644\u0644\u0645\u0642\u0627\u0637\u0639\u0629"],
  // v11.11 (wave2-A1) — the ONE quiet working-state line: phase gerunds,
  // picked by src/lib/streamDisplay (pickGerund/rotateGerund). The static
  // working-word default is retired.
  "chat.gerund.thinking": ["Thinking", "\u064A\u0641\u0643\u0651\u0631"],
  "chat.gerund.planning": ["Planning", "\u064A\u062E\u0637\u0651\u0637"],
  "chat.gerund.building": ["Building", "\u064A\u0628\u0646\u064A"],
  "chat.gerund.exploring": ["Exploring", "\u064A\u0633\u062A\u0643\u0634\u0641"],
  "chat.gerund.verifying": ["Verifying", "\u064A\u062A\u062D\u0642\u0651\u0642"],
  "chat.run.approval": ["Waiting for approval", "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0645\u0648\u0627\u0641\u0642\u062A\u0643"],
  "chat.run.elapsed": ["Elapsed", "\u0627\u0644\u0645\u0646\u0642\u0636\u064A"],
  "chat.run.toolsShort": ["tools", "\u0623\u062F\u0627\u0629"],
  "chat.run.toolsTitle": ["Tool calls this run", "\u0627\u0633\u062A\u062F\u0639\u0627\u0621\u0627\u062A \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "chat.run.done": ["Done", "\u062A\u0645"],
  "chat.run.failed": ["Failed", "\u0641\u0634\u0644"],
  "chat.thinking.thoughtFor": ["Thought for {s}s", "\u0641\u0643\u0651\u0631 \u0644\u0645\u062F\u0629 {s} \u062B"],
  // chat → voice input + export
  "chat.voice.title": ["Voice input", "\u0625\u062F\u062E\u0627\u0644 \u0635\u0648\u062A\u064A"],
  "chat.voice.stop": ["Stop recording", "\u0623\u0648\u0642\u0641 \u0627\u0644\u062A\u0633\u062C\u064A\u0644"],
  "chat.voice.denied": ["Microphone access was denied", "\u0631\u064F\u0641\u0636 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646"],
  "chat.voice.failed": [
    "Voice input needs an OpenAI-compatible transcription endpoint (whisper). Check Settings \u2192 Providers.",
    "\u0627\u0644\u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0635\u0648\u062A\u064A \u064A\u062D\u062A\u0627\u062C \u0646\u0642\u0637\u0629 \u062A\u062D\u0648\u064A\u0644 \u0643\u0644\u0627\u0645 \u0645\u062A\u0648\u0627\u0641\u0642\u0629 \u0645\u0639 OpenAI (whisper). \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0627\u0644\u0645\u0632\u0648\u062F\u0648\u0646."
  ],
  "chat.voice.done": ["Transcript inserted", "\u0623\u064F\u062F\u0631\u062C \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0646\u0642\u0648\u0644"],
  "chat.export.html": ["Export session as HTML (share)", "\u0635\u062F\u0651\u0631 \u0627\u0644\u062C\u0644\u0633\u0629 HTML (\u0645\u0634\u0627\u0631\u0643\u0629)"],
  "chat.export.done": ["Session exported \u2014 {path}", "\u0635\u064F\u062F\u0651\u0631\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u2014 {path}"],
  "chat.export.canceled": ["Export canceled", "\u0623\u064F\u0644\u063A\u064A \u0627\u0644\u062A\u0635\u062F\u064A\u0631"],
  "dna.fb.forget": ["Forget this entry", "\u0627\u0646\u0633\u0650 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0635\u0631"],
  // plans / billing → free season
  "plans.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "plans.freeSeason.title": ["SADEEM is completely free right now", "\u0633\u062F\u064A\u0645 \u0645\u062C\u0627\u0646\u064A\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0627\u0644\u0622\u0646"],
  "plans.freeSeason.sub": [
    "Payments are paused \u2014 every Pro capability is unlocked for everyone. Pro & Team will return later.",
    "\u0627\u0644\u062F\u0641\u0639 \u0645\u062A\u0648\u0642\u0641 \u0645\u0624\u0642\u062A\u0627\u064B \u2014 \u0643\u0644 \u0642\u062F\u0631\u0627\u062A Pro \u0645\u0641\u062A\u0648\u062D\u0629 \u0644\u0644\u062C\u0645\u064A\u0639. \u0633\u062A\u0639\u0648\u062F \u062E\u0637\u0637 Pro \u0648Team \u0644\u0627\u062D\u0642\u0627\u064B."
  ],
  "plans.free.unlockedChip": ["EVERYTHING UNLOCKED", "\u0643\u0644 \u0634\u064A\u0621 \u0645\u0641\u062A\u0648\u062D"],
  "plans.free.note": [
    "Everything is included during the public season \u2014 device tools, parallel calls and all 16 specialist agents.",
    "\u0643\u0644 \u0634\u064A\u0621 \u0645\u0634\u0645\u0648\u0644 \u062E\u0644\u0627\u0644 \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0639\u0627\u0645 \u2014 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062C\u0647\u0627\u0632 \u0648\u0627\u0644\u0627\u0633\u062A\u062F\u0639\u0627\u0621\u0627\u062A \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A\u0629 \u0648\u0643\u0644 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u062A\u062E\u0635\u0635\u064A\u0646 \u0627\u0644\u0633\u062A\u0629 \u0639\u0634\u0631."
  ],
  "plans.paused.chip": ["PAUSED", "\u0645\u062A\u0648\u0642\u0641\u0629"],
  "plans.paused.btn": ["Not active right now", "\u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644\u0629 \u0627\u0644\u0622\u0646"],
  "plans.paused.btnTip": [
    "Payments are paused \u2014 this plan is not active right now. Everything it offers is already free.",
    "\u0627\u0644\u062F\u0641\u0639 \u0645\u062A\u0648\u0642\u0641 \u2014 \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0629 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644\u0629 \u062D\u0627\u0644\u064A\u0627\u064B. \u0643\u0644 \u0645\u0627 \u062A\u0642\u062F\u0645\u0647 \u0645\u062C\u0627\u0646\u064A \u0623\u0635\u0644\u0627\u064B."
  ],
  "plans.paused.later": ["back later", "\u062A\u0639\u0648\u062F \u0644\u0627\u062D\u0642\u0627\u064B"],
  "billing.status.freeSeason": ["FREE SEASON", "\u0645\u0648\u0633\u0645 \u0645\u062C\u0627\u0646\u064A"],
  "billing.freeSeason.limits": [
    "All Pro limits are granted \u2014 every capability is unlocked while payments are paused.",
    "\u0643\u0644 \u062D\u062F\u0648\u062F Pro \u0645\u0645\u0646\u0648\u062D\u0629 \u2014 \u0643\u0644 \u0627\u0644\u0642\u062F\u0631\u0627\u062A \u0645\u0641\u062A\u0648\u062D\u0629 \u0623\u062B\u0646\u0627\u0621 \u062A\u0648\u0642\u0641 \u0627\u0644\u062F\u0641\u0639."
  ],
  "billing.checkout.paused": [
    "Payments are paused \u2014 this plan is not active right now.",
    "\u0627\u0644\u062F\u0641\u0639 \u0645\u062A\u0648\u0642\u0641 \u2014 \u0647\u0630\u0647 \u0627\u0644\u062E\u0637\u0629 \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644\u0629 \u0627\u0644\u0622\u0646."
  ],
  "billing.coupon.hint.freeSeason": [
    "Coupon codes will apply at checkout when payments return.",
    "\u062A\u064F\u0637\u0628\u0642 \u0623\u0643\u0648\u0627\u062F \u0627\u0644\u0643\u0648\u0628\u0648\u0646\u0627\u062A \u0639\u0646\u062F \u0627\u0644\u062F\u0641\u0639 \u062D\u064A\u0646 \u064A\u0639\u0648\u062F."
  ]
};
Object.assign(D, D_V23);
Object.assign(D, D_V21);
var D_APPEARANCE_AUDIT = {
  // accent swatch names (were English-only fallbacks before)
  "settings.appearance.accent.sage": ["Sage", "\u0633\u064A\u062C (\u0623\u062E\u0636\u0631 \u0645\u0631\u064A\u0645\u064A\u0629)"],
  "settings.appearance.accent.teal": ["Teal", "\u062A\u0631\u0643\u0648\u0627\u0632\u064A"],
  "settings.appearance.accent.clay": ["Clay", "\u0637\u064A\u0646\u064A"],
  "settings.appearance.accent.amber": ["Amber", "\u0639\u0646\u0628\u0631\u064A"],
  // in-pane theme swatch cards
  "settings.appearance.theme.hint": [
    "Paints every surface \u2014 swatches show the real palette",
    "\u062A\u0644\u0648\u0651\u0646 \u0643\u0644 \u0627\u0644\u0623\u0633\u0637\u062D \u2014 \u0627\u0644\u0639\u064A\u0646\u0627\u062A \u062A\u0639\u0631\u0636 \u0627\u0644\u0644\u0648\u062D\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629"
  ],
  // live appearance preview strip
  "settings.appearance.preview": ["Appearance preview", "\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0645\u0638\u0647\u0631"],
  "settings.appearance.preview.live": ["LIVE", "\u0645\u0628\u0627\u0634\u0631"],
  // bottom reset button + toast
  "settings.appearance.reset": ["Reset appearance to defaults", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0638\u0647\u0631 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629"],
  "settings.appearance.reset.cta": ["Reset", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "settings.appearance.reset.hint": [
    "Restores glass, glow, accent, type, layout and motion",
    "\u064A\u0633\u062A\u0639\u064A\u062F \u0627\u0644\u0632\u062C\u0627\u062C \u0648\u0627\u0644\u062A\u0648\u0647\u062C \u0648\u0627\u0644\u0644\u0648\u0646 \u0627\u0644\u0645\u0645\u064A\u0651\u0632 \u0648\u0627\u0644\u062E\u0637\u0648\u0637 \u0648\u0627\u0644\u062A\u062E\u0637\u064A\u0637 \u0648\u0627\u0644\u062D\u0631\u0643\u0629"
  ],
  "settings.appearance.reset.done": [
    "Appearance restored to defaults",
    "\u0627\u0633\u062A\u064F\u0639\u064A\u062F\u062A \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0638\u0647\u0631 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629"
  ]
};
Object.assign(D, D_APPEARANCE_AUDIT);
var LIVE_FALLBACK_KEYS = /* @__PURE__ */ new Set([
  "mv.compaction",
  "mv.findings.count",
  "mv.unit.lines",
  "sb.led.state",
  "set.updates.feed.hint.v1131"
]);
function makeT(lang) {
  const idx = lang === "ar" ? 1 : 0;
  return (key, fallback, params) => {
    const e = D[key];
    let out = LIVE_FALLBACK_KEYS.has(key) && fallback !== void 0 ? fallback : e ? e[idx] || e[0] : fallback ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        out = out.split(`{${k}}`).join(String(v));
      }
    }
    return out;
  };
}
function useT() {
  const lang = useStore((s) => s.settings?.language ?? "en");
  return makeT(lang);
}
var D_A_UX = {
  // window controls
  "win.minimize": ["Minimize", "\u062A\u0635\u063A\u064A\u0631"],
  "win.maximize": ["Maximize", "\u062A\u0643\u0628\u064A\u0631"],
  "win.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  // relative time (sessions, welcome)
  "time.now": ["now", "\u0627\u0644\u0622\u0646"],
  "time.m": ["m", "\u062F"],
  "time.h": ["h", "\u0633"],
  "time.d": ["d", "\u064A\u0648\u0645"],
  "time.ago": ["{0} ago", "\u0642\u0628\u0644 {0}"],
  // tool call / result rows
  "tool.args": ["Arguments", "\u0627\u0644\u0648\u0633\u0627\u0626\u0637"],
  "tool.result": ["Result", "\u0627\u0644\u0646\u062A\u064A\u062C\u0629"],
  "tool.expand": ["Show output", "\u0627\u0639\u0631\u0636 \u0627\u0644\u0646\u0627\u062A\u062C"],
  "tool.collapse": ["Hide output", "\u0623\u062E\u0641\u0650 \u0627\u0644\u0646\u0627\u062A\u062C"],
  "tool.noOutput": ["(no output)", "(\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0627\u062A\u062C)"],
  "tool.copyArgs": ["Copy arguments", "\u0627\u0646\u0633\u062E \u0627\u0644\u0648\u0633\u0627\u0626\u0637"],
  // empty editor state
  "ed.empty.sub": ["Open a file from the tree, or ask the agent to start", "\u0627\u0641\u062A\u062D \u0645\u0644\u0641\u064B\u0627 \u0645\u0646 \u0627\u0644\u0634\u062C\u0631\u0629\u060C \u0623\u0648 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644 \u0623\u0646 \u064A\u0628\u062F\u0623"],
  "ed.empty.files": ["files", "\u0645\u0644\u0641"],
  "ed.empty.folders": ["folders", "\u0645\u062C\u0644\u062F"],
  "ed.empty.recent": ["Recent files", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "ed.empty.noRecent": ["Files you open will appear here", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u0641\u062A\u062D\u0647\u0627 \u0633\u062A\u0638\u0647\u0631 \u0647\u0646\u0627"],
  "ed.empty.shortcuts": ["Shortcuts", "\u0627\u0644\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A"],
  "ed.empty.kPalette": ["Command palette", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "ed.empty.kTerminal": ["Terminal", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "ed.empty.kSidebar": ["Toggle sidebar", "\u0625\u0638\u0647\u0627\u0631/\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0634\u0631\u064A\u0637 \u0627\u0644\u062C\u0627\u0646\u0628\u064A"],
  "ed.empty.kModel": ["Choose model", "\u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  // editor tabs
  "tab.closeOthers": ["Close others", "\u0623\u063A\u0644\u0642 \u0627\u0644\u0628\u0627\u0642\u064A"],
  // sessions panel grouping
  "sess.today": ["Today", "\u0627\u0644\u064A\u0648\u0645"],
  "sess.yesterday": ["Yesterday", "\u0623\u0645\u0633"],
  "sess.earlierWeek": ["Earlier this week", "\u0633\u0627\u0628\u0642\u064B\u0627 \u0647\u0630\u0627 \u0627\u0644\u0623\u0633\u0628\u0648\u0639"],
  "sess.earlier": ["Earlier", "\u0623\u0642\u062F\u0645"],
  "sess.empty": ["Empty", "\u0641\u0627\u0631\u063A\u0629"],
  "sess.open": ["Open", "\u0641\u062A\u062D"],
  // command palette
  "palette.empty": ["No matching command \u2014 try \u201Cterminal\u201D", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0623\u0645\u0631 \u0645\u0637\u0627\u0628\u0642 \u2014 \u062C\u0631\u0651\u0628 \xAB\u0627\u0644\u0637\u0631\u0641\u064A\u0629\xBB"],
  "pal.sec.workspace": ["Workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "pal.sec.modes": ["Modes", "\u0627\u0644\u0623\u0648\u0636\u0627\u0639"],
  "pal.sec.model": ["Model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "pal.sec.theme": ["Theme", "\u0627\u0644\u0633\u0645\u0629"],
  "pal.sec.view": ["View", "\u0627\u0644\u0639\u0631\u0636"],
  // composer
  "chat.hintMention": ["mention files", "\u0623\u0634\u0631 \u0625\u0644\u0649 \u0645\u0644\u0641\u0627\u062A"],
  "chat.hintCommands": ["commands", "\u0623\u0648\u0627\u0645\u0631"],
  "comp.model": ["Active model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062D\u0627\u0644\u064A"],
  "comp.mentions": ["files mentioned", "\u0645\u0644\u0641\u0627\u062A \u0645\u064F\u0634\u0627\u0631 \u0625\u0644\u064A\u0647\u0627"]
};
Object.assign(D, D_A_UX);
var D_BILLING = {
  // period toggle + pricing
  "plans.period.monthly": ["Monthly", "\u0634\u0647\u0631\u064A"],
  "plans.period.yearly": ["Yearly", "\u0633\u0646\u0648\u064A"],
  "plans.save2mo": ["2 months free", "\u0634\u0647\u0631\u0627\u0646 \u0645\u062C\u0627\u0646\u0627\u064B"],
  "plans.per.mo": ["/mo", "/\u0634\u0647\u0631\u064A\u0627\u064B"],
  "plans.per.usermo": ["/user/mo", "/\u0645\u0633\u062A\u062E\u062F\u0645/\u0634\u0647\u0631\u064A\u0627\u064B"],
  "plans.per.yr": ["/yr", "/\u0633\u0646\u0648\u064A\u0627\u064B"],
  "plans.per.useryr": ["/user/yr", "/\u0645\u0633\u062A\u062E\u062F\u0645/\u0633\u0646\u0648\u064A\u0627\u064B"],
  "plans.popular": ["POPULAR", "\u0627\u0644\u0623\u0643\u062B\u0631 \u0634\u064A\u0648\u0639\u0627\u064B"],
  // real feature lists
  "plans.free.f4": ["Checkpoints & rewind", "\u0646\u0642\u0627\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0648\u062A\u0631\u0627\u062C\u0639"],
  "plans.free.f5": ["MCP servers", "\u062E\u0648\u0627\u062F\u0645 MCP"],
  "plans.pro.everything": ["Everything in Free", "\u0643\u0644 \u0645\u0632\u0627\u064A\u0627 \u0627\u0644\u0645\u062C\u0627\u0646\u064A"],
  "plans.pro.subagents": ["16 specialist agents & plan mode", "16 \u0648\u0643\u064A\u0644\u0627\u064B \u0645\u062A\u062E\u0635\u0635\u0627\u064B \u0648\u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629"],
  "plans.pro.reasoning": ["Extended thinking & reasoning controls", "\u062A\u0641\u0643\u064A\u0631 \u0645\u0645\u062A\u062F \u0648\u062A\u062D\u0643\u0645 \u0641\u064A \u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644"],
  "plans.pro.localApi": ["Local API server", "\u062E\u0627\u062F\u0645 API \u0645\u062D\u0644\u064A"],
  "plans.pro.inline": ["Inline completions", "\u0625\u0643\u0645\u0627\u0644\u0627\u062A \u0641\u0648\u0631\u064A\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "plans.team.seatsPool": ["License seats pool", "\u0645\u062C\u0645\u0648\u0639\u0629 \u0645\u0642\u0627\u0639\u062F \u0644\u0644\u062A\u0631\u062E\u064A\u0635"],
  // trial
  "plans.trial.banner": ["Pro trial \u2014 {d} days left", "\u062A\u062C\u0631\u0628\u0629 \u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u2014 \u0628\u0642\u064A {d} \u064A\u0648\u0645\u0627\u064B"],
  "plans.trial.cta": ["Activate a key or upgrade to keep Pro features.", "\u0641\u0639\u0651\u0644 \u0645\u0641\u062A\u0627\u062D\u0627\u064B \u0623\u0648 \u0631\u0642\u0650\u0651 \u0644\u0644\u0627\u062D\u062A\u0641\u0627\u0638 \u0628\u0645\u064A\u0632\u0627\u062A \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629."],
  "plans.trial.activate": ["Activate a key", "\u062A\u0641\u0639\u064A\u0644 \u0645\u0641\u062A\u0627\u062D"],
  "plans.trial.offer": ["Try every Pro feature free for 14 days \u2014 no card needed.", "\u062C\u0631\u0651\u0628 \u0643\u0644 \u0645\u0632\u0627\u064A\u0627 \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u0645\u062C\u0627\u0646\u0627\u064B \u0644\u0645\u062F\u0629 14 \u064A\u0648\u0645\u0627\u064B \u2014 \u062F\u0648\u0646 \u0628\u0637\u0627\u0642\u0629."],
  "plans.trial.start": ["Start 14-day Pro trial", "\u0627\u0628\u062F\u0623 \u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 14 \u064A\u0648\u0645\u0627\u064B"],
  "plans.trial.started": ["Pro trial started \u2014 14 days on us", "\u0628\u062F\u0623\u062A \u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u2014 14 \u064A\u0648\u0645\u0627\u064B \u0639\u0644\u0649 \u062D\u0633\u0627\u0628\u0646\u0627"],
  "plans.trial.chip": ["PRO TRIAL", "\u062A\u062C\u0631\u0628\u0629 \u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629"],
  "plans.trial.expired": ["Your trial has ended \u2014 activate a key or upgrade to keep Pro features.", "\u0627\u0646\u062A\u0647\u062A \u062A\u062C\u0631\u0628\u062A\u0643 \u2014 \u0641\u0639\u0651\u0644 \u0645\u0641\u062A\u0627\u062D\u0627\u064B \u0623\u0648 \u0631\u0642\u0650\u0651 \u0644\u0644\u0627\u062D\u062A\u0641\u0627\u0638 \u0628\u0645\u064A\u0632\u0627\u062A \u0627\u0644\u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629."],
  // license panel
  "plans.license.title": ["Your license", "\u062A\u0631\u062E\u064A\u0635\u0643"],
  "plans.license.plan": ["Plan", "\u0627\u0644\u062E\u0637\u0629"],
  "plans.license.licensedTo": ["Licensed to", "\u0645\u0631\u062E\u064E\u0651\u0635 \u0644\u0640"],
  "plans.license.activated": ["Activated", "\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u062A\u0646\u0634\u064A\u0637"],
  "plans.license.expiry": ["Expiry", "\u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629"],
  "plans.license.perpetual": ["Perpetual", "\u062F\u0627\u0626\u0645"],
  "plans.license.expired": ["Expired", "\u0645\u0646\u062A\u0647\u064D"],
  "plans.license.seats": ["Seats", "\u0627\u0644\u0645\u0642\u0627\u0639\u062F"],
  "plans.license.source": ["Source", "\u0627\u0644\u0645\u0635\u062F\u0631"],
  "plans.license.deactivate": ["Deactivate", "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062A\u0646\u0634\u064A\u0637"],
  "plans.license.deactivated": ["License deactivated \u2014 back to the Free plan", "\u0623\u064F\u0644\u063A\u064A \u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u2014 \u0639\u062F\u062A\u064E \u0625\u0644\u0649 \u0627\u0644\u062E\u0637\u0629 \u0627\u0644\u0645\u062C\u0627\u0646\u064A\u0629"],
  "plans.license.deactivateFailed": ["Could not deactivate the license", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062A\u0631\u062E\u064A\u0635"],
  "plans.key.hint": ["Format: KDX-PRO-XXXXX-XXXX-XXX \u2014 legacy keys KDX-PRO-XXXX-XXXX-XXXX also work.", "\u0627\u0644\u0635\u064A\u063A\u0629: KDX-PRO-XXXXX-XXXX-XXX \u2014 \u0648\u062A\u064F\u0642\u0628\u0644 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0642\u062F\u064A\u0645\u0629 KDX-PRO-XXXX-XXXX-XXXX \u0623\u064A\u0636\u0627\u064B."],
  // FAQ
  "plans.faq.title": ["Frequently asked questions", "\u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0634\u0627\u0626\u0639\u0629"],
  "plans.faq.q1": ["Can I use my own API keys?", "\u0647\u0644 \u064A\u0645\u0643\u0646\u0646\u064A \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0641\u0627\u062A\u064A\u062D API \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u064A\u061F"],
  "plans.faq.a1": [
    "Yes \u2014 SADEEM is BYOK-first. Keys are stored encrypted on your device and requests go straight to the provider. Paid plans never change how your keys are stored or used.",
    "\u0646\u0639\u0645 \u2014 \u0633\u062F\u064A\u0645 \u064A\u0639\u0645\u0644 \u0628\u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0623\u0648\u0644\u0627\u064B. \u062A\u064F\u062E\u0632\u064E\u0651\u0646 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0645\u0634\u0641\u064E\u0651\u0631\u0629 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0648\u062A\u0630\u0647\u0628 \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0645\u0628\u0627\u0634\u0631\u0629 \u0625\u0644\u0649 \u0627\u0644\u0645\u0632\u0648\u0651\u062F. \u0627\u0644\u062E\u0637\u0637 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0629 \u0644\u0627 \u062A\u063A\u064A\u0651\u0631 \u0637\u0631\u064A\u0642\u0629 \u062A\u062E\u0632\u064A\u0646 \u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647\u0627."
  ],
  "plans.faq.q2": ["What counts as a run?", "\u0645\u0627 \u0627\u0644\u0630\u064A \u064A\u064F\u062D\u0633\u0628 \u062A\u0634\u063A\u064A\u0644\u0627\u064B\u061F"],
  "plans.faq.a2": [
    "One run = one task you send to the agent (a chat message, /init or /compact). Multi-step tool use inside that task is still a single run. Editor completions never count.",
    "\u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0648\u0627\u062D\u062F = \u0645\u0647\u0645\u0629 \u0648\u0627\u062D\u062F\u0629 \u062A\u0631\u0633\u0644\u0647\u0627 \u0625\u0644\u0649 \u0627\u0644\u0648\u0643\u064A\u0644 (\u0631\u0633\u0627\u0644\u0629 \u0645\u062D\u0627\u062F\u062B\u0629 \u0623\u0648 \u200E/init \u0623\u0648 \u200E/compact). \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u062A\u0639\u062F\u062F \u0644\u0644\u0623\u062F\u0648\u0627\u062A \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u0647\u0645\u0629 \u0646\u0641\u0633\u0647\u0627 \u064A\u0628\u0642\u0649 \u062A\u0634\u063A\u064A\u0644\u0627\u064B \u0648\u0627\u062D\u062F\u0627\u064B. \u0627\u0644\u0625\u0643\u0645\u0627\u0644\u0627\u062A \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u062D\u0631\u0631 \u0644\u0627 \u062A\u064F\u062D\u0633\u0628 \u0623\u0628\u062F\u0627\u064B."
  ],
  "plans.faq.q3": ["How do team seats work?", "\u0643\u064A\u0641 \u062A\u0639\u0645\u0644 \u0645\u0642\u0627\u0639\u062F \u0627\u0644\u0641\u0631\u064A\u0642\u061F"],
  "plans.faq.a3": [
    "A Team license includes a pool of seats \u2014 one per developer. Each developer activates the same key on their machine, and the seat count defines how many activations the license allows.",
    "\u064A\u062A\u0636\u0645\u0646 \u062A\u0631\u062E\u064A\u0635 \u0627\u0644\u0641\u0631\u064A\u0642 \u0645\u062C\u0645\u0648\u0639\u0629 \u0645\u0642\u0627\u0639\u062F \u2014 \u0645\u0642\u0639\u062F \u0644\u0643\u0644 \u0645\u0637\u0648\u0651\u0631. \u064A\u0641\u0639\u0651\u0644 \u0643\u0644 \u0645\u0637\u0648\u0651\u0631 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0646\u0641\u0633\u0647 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0647\u060C \u0648\u064A\u062D\u062F\u062F \u0639\u062F\u062F \u0627\u0644\u0645\u0642\u0627\u0639\u062F \u0639\u062F\u062F \u0627\u0644\u062A\u0646\u0634\u064A\u0637\u0627\u062A \u0627\u0644\u0645\u0633\u0645\u0648\u062D \u0628\u0647\u0627 \u0644\u0644\u062A\u0631\u062E\u064A\u0635."
  ],
  "plans.faq.q4": ["Can I get a refund?", "\u0647\u0644 \u064A\u0645\u0643\u0646\u0646\u064A \u0627\u0633\u062A\u0631\u062F\u0627\u062F \u0627\u0644\u0645\u0628\u0644\u063A\u061F"],
  "plans.faq.a4": [
    "Yes \u2014 monthly and yearly subscriptions can be refunded within 14 days of purchase. Contact support from the email on your license.",
    "\u0646\u0639\u0645 \u2014 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u0631\u062F\u0627\u062F \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643\u0627\u062A \u0627\u0644\u0634\u0647\u0631\u064A\u0629 \u0648\u0627\u0644\u0633\u0646\u0648\u064A\u0629 \u062E\u0644\u0627\u0644 14 \u064A\u0648\u0645\u0627\u064B \u0645\u0646 \u0627\u0644\u0634\u0631\u0627\u0621. \u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u062F\u0639\u0645 \u0645\u0646 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0645\u0633\u062C\u064E\u0651\u0644 \u0641\u064A \u062A\u0631\u062E\u064A\u0635\u0643."
  ],
  // settings → billing section
  "settings.billing.keyPh": ["KDX-\u2026", "KDX-\u2026"],
  "settings.billing.stripePh": ["https://buy.stripe.com/\u2026", "https://buy.stripe.com/\u2026"],
  "settings.billing.trialLeft": ["Pro trial \u2014 {d} days left", "\u062A\u062C\u0631\u0628\u0629 \u0627\u062D\u062A\u0631\u0627\u0641\u064A\u0629 \u2014 \u0628\u0642\u064A {d} \u064A\u0648\u0645\u0627\u064B"],
  "settings.billing.expired": ["Expired", "\u0645\u0646\u062A\u0647\u064D"],
  "settings.billing.expires": ["Expires", "\u062A\u0646\u062A\u0647\u064A \u0641\u064A"],
  "settings.billing.perpetual": ["Perpetual license", "\u062A\u0631\u062E\u064A\u0635 \u062F\u0627\u0626\u0645"],
  "settings.billing.seats": ["Seats", "\u0627\u0644\u0645\u0642\u0627\u0639\u062F"],
  "settings.billing.usageMonth": ["Usage this month", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631"],
  "settings.billing.usage.runs": ["Runs", "\u062A\u0634\u063A\u064A\u0644\u0627\u062A"],
  "settings.billing.usage.tokens": ["Tokens", "\u0631\u0645\u0648\u0632"],
  "settings.billing.usage.cost": ["Est. cost", "\u062A\u0643\u0644\u0641\u0629 \u062A\u0642\u062F\u064A\u0631\u064A\u0629"],
  "settings.billing.manage": ["Manage plan", "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u062E\u0637\u0629"],
  "settings.billing.noLink": ["Set your Stripe Payment Link below first.", "\u0627\u0636\u0628\u0637 \u0631\u0627\u0628\u0637 \u062F\u0641\u0639 Stripe \u0623\u062F\u0646\u0627\u0647 \u0623\u0648\u0644\u0627\u064B."],
  "settings.billing.endpoint": ["License endpoint (optional)", "\u0646\u0642\u0637\u0629 \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u062A\u0631\u0627\u062E\u064A\u0635 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)"],
  "settings.billing.endpoint.hint": [
    "During activation SADEEM POSTs {key} here and accepts JSON {plan, licensedTo?, email?, expiresAt?, seats?} in return.",
    "\u0639\u0646\u062F \u0627\u0644\u062A\u0646\u0634\u064A\u0637 \u064A\u0631\u0633\u0644 \u0633\u062F\u064A\u0645 \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0625\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0648\u064A\u0642\u0628\u0644 \u0631\u062F JSON \u0628\u0627\u0644\u062D\u0642\u0648\u0644 plan \u0648licensedTo \u0648email \u0648expiresAt \u0648seats."
  ],
  "settings.billing.endpointPh": ["https://licenses.example.com/surnia", "https://licenses.example.com/surnia"],
  "settings.billing.gen": ["Generate offline keys:", "\u062A\u0648\u0644\u064A\u062F \u0645\u0641\u0627\u062A\u064A\u062D \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644:"]
};
Object.assign(D, D_BILLING);
var D_API = {
  "apiserver.title": ["API server", "\u062E\u0627\u062F\u0645 API"],
  "apiserver.desc": ["Programmatic control API for scripts and CI \u2014 loopback only, bearer-token protected.", "\u0648\u0627\u062C\u0647\u0629 \u062A\u062D\u0643\u0645 \u0628\u0631\u0645\u062C\u064A\u0629 \u0644\u0644\u0633\u0643\u0631\u0628\u062A\u0627\u062A \u0648\u0623\u0646\u0638\u0645\u0629 CI \u2014 \u0639\u0644\u0649 \u0627\u0644\u0645\u0636\u064A\u0641 \u0627\u0644\u0645\u062D\u0644\u064A \u0641\u0642\u0637 \u0648\u0645\u062D\u0645\u064A\u0629 \u0628\u0631\u0645\u0632 Bearer."],
  "apiserver.running": ["Running", "\u064A\u0639\u0645\u0644"],
  "apiserver.stopped": ["Stopped", "\u0645\u062A\u0648\u0642\u0641"],
  "apiserver.requests": ["Requests", "\u0627\u0644\u0637\u0644\u0628\u0627\u062A"],
  "apiserver.enable": ["Enable API server", "\u062A\u0634\u063A\u064A\u0644 \u062E\u0627\u062F\u0645 API"],
  "apiserver.enableHint": ["Loopback HTTP server: list sessions, run the agent, stream events, one-shot AI", "\u062E\u0627\u062F\u0645 HTTP \u0645\u062D\u0644\u064A: \u0639\u0631\u0636 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0648\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u0628\u062B \u0627\u0644\u0623\u062D\u062F\u0627\u062B \u0648\u0625\u0643\u0645\u0627\u0644\u0627\u062A \u0628\u0646\u0641\u064A\u0632\u0629 \u0648\u0627\u062D\u062F\u0629"],
  "apiserver.port": ["Port", "\u0627\u0644\u0645\u0646\u0641\u0630"],
  "apiserver.portHint": ["1024\u201365535 \u2014 changing it restarts the server", "\u0645\u0646 1024 \u0625\u0644\u0649 65535 \u2014 \u062A\u063A\u064A\u064A\u0631\u0647 \u064A\u0639\u064A\u062F \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062E\u0627\u062F\u0645"],
  "apiserver.token": ["Bearer token", "\u0631\u0645\u0632 Bearer"],
  "apiserver.tokenHint": ["Sent as \u201CAuthorization: Bearer <token>\u201D (or ?token= for EventSource)", "\u064A\u064F\u0631\u0633\u0644 \u0641\u064A \u0627\u0644\u062A\u0631\u0648\u064A\u0633\u0629 Authorization: Bearer <token> (\u0623\u0648 ?token= \u0644\u0628\u062B \u0627\u0644\u0623\u062D\u062F\u0627\u062B)"],
  "apiserver.security": ["Bound to 127.0.0.1 only \u2014 never exposed to the network.", "\u0645\u0631\u062A\u0628\u0637 \u0628\u0627\u0644\u0639\u0646\u0648\u0627\u0646 127.0.0.1 \u0641\u0642\u0637 \u2014 \u0644\u0627 \u064A\u064F\u0643\u0634\u0641 \u0644\u0644\u0634\u0628\u0643\u0629 \u0623\u0628\u062F\u0627\u064B."],
  "apiserver.endpoints": ["Endpoints", "\u0646\u0642\u0627\u0637 \u0627\u0644\u0646\u0647\u0627\u064A\u0629"],
  "apiserver.method": ["Method", "\u0627\u0644\u0637\u0631\u064A\u0642\u0629"],
  "apiserver.path": ["Path", "\u0627\u0644\u0645\u0633\u0627\u0631"],
  "apiserver.purpose": ["Purpose", "\u0627\u0644\u0648\u0638\u064A\u0641\u0629"],
  "apiserver.curlTitle": ["Try it", "\u062C\u0631\u0651\u0628\u0647"],
  "apiserver.copy": ["Copy", "\u0646\u0633\u062E"],
  "apiserver.copied": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "apiserver.show": ["Show token", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0631\u0645\u0632"],
  "apiserver.hide": ["Hide token", "\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0631\u0645\u0632"],
  "apiserver.regenerate": ["Regenerate token", "\u0625\u0639\u0627\u062F\u0629 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0631\u0645\u0632"],
  "apiserver.error": ["API server error", "\u062E\u0637\u0623 \u0641\u064A \u062E\u0627\u062F\u0645 API"],
  "apiserver.ep.health": ["Liveness, version, workspace, request count", "\u0627\u0644\u062D\u064A\u0627\u0629 \u0648\u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0648\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0648\u0639\u062F\u062F \u0627\u0644\u0637\u0644\u0628\u0627\u062A"],
  "apiserver.ep.models": ["Configured models (static, from settings)", "\u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0645\u0636\u0628\u0648\u0637\u0629 (\u062B\u0627\u0628\u062A\u0629 \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A)"],
  "apiserver.ep.sessions": ["List sessions (newest first)", "\u0639\u0631\u0636 \u0627\u0644\u062C\u0644\u0633\u0627\u062A (\u0627\u0644\u0623\u062D\u062F\u062B \u0623\u0648\u0644\u0627\u064B)"],
  "apiserver.ep.sessionsNew": ["Create an empty session {title?}", "\u0625\u0646\u0634\u0627\u0621 \u062C\u0644\u0633\u0629 \u0641\u0627\u0631\u063A\u0629 {title?}"],
  "apiserver.ep.run": ["Run the agent {prompt, workspace?} \u2192 runId", "\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 {prompt, workspace?} \u2190 runId"],
  "apiserver.ep.abort": ["Abort a running agent {runId?}", "\u0625\u064A\u0642\u0627\u0641 \u062A\u0634\u063A\u064A\u0644 \u062C\u0627\u0631\u064D \u0644\u0644\u0648\u0643\u064A\u0644 {runId?}"],
  "apiserver.ep.events": ["SSE stream of agent events (?runId, ?token)", "\u0628\u062B SSE \u0644\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u0648\u0643\u064A\u0644 (?runId, ?token)"],
  "apiserver.ep.ai": ["One-shot completion {prompt, system?, maxTokens?, temperature?}", "\u0625\u0643\u0645\u0627\u0644 \u0628\u0646\u0641\u064A\u0632\u0629 \u0648\u0627\u062D\u062F\u0629 {prompt, system?, maxTokens?, temperature?}"]
};
Object.assign(D, D_API);
var D_ORCH = {
  "settings.appearance": ["Appearance", "\u0627\u0644\u0645\u0638\u0647\u0631"],
  "settings.models": ["AI models", "\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "settings.models.hint": [
    "Default model and reasoning controls. Providers are configured separately.",
    "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0648\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644. \u064A\u064F\u0636\u0628\u0637 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0648\u0646 \u0641\u064A \u0642\u0633\u0645 \u0645\u0646\u0641\u0635\u0644."
  ],
  "settings.models.provider": ["Provider", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F"],
  "settings.models.model": ["Model id", "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.models.reasoning": ["Reasoning depth", "\u0639\u0645\u0642 \u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644"],
  "settings.models.reasoning.hint": [
    "Extended thinking (Anthropic) / reasoning effort (OpenAI o-series, GPT-5). Higher = deeper, slower, costlier.",
    "\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0645\u0648\u0633\u0651\u0639 (Anthropic) \u0623\u0648 \u062C\u0647\u062F \u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644 (o-series \u0648GPT-5). \u0627\u0644\u0623\u0639\u0644\u0649 \u0623\u0639\u0645\u0642 \u0648\u0623\u0628\u0637\u0623 \u0648\u0623\u063A\u0644\u0649."
  ],
  "settings.models.reasoning.off": ["Off \u2014 fastest", "\u0645\u0637\u0641\u0623 \u2014 \u0627\u0644\u0623\u0633\u0631\u0639"],
  "settings.models.reasoning.low": ["Low \u2014 quick reasoning", "\u0645\u0646\u062E\u0641\u0636 \u2014 \u0627\u0633\u062A\u062F\u0644\u0627\u0644 \u0633\u0631\u064A\u0639"],
  "settings.models.reasoning.medium": ["Medium \u2014 balanced", "\u0645\u062A\u0648\u0633\u0637 \u2014 \u0645\u062A\u0648\u0627\u0632\u0646"],
  "settings.models.reasoning.high": ["High \u2014 hardest problems", "\u0639\u0627\u0644\u064D \u2014 \u0623\u0635\u0639\u0628 \u0627\u0644\u0645\u0633\u0627\u0626\u0644"],
  "settings.models.maxTokens": ["Max output tokens", "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0645\u062E\u0631\u062C\u0627\u062A \u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A"],
  "settings.models.maxTokens.hint": ["Empty = provider default", "\u0641\u0627\u0631\u063A = \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0644\u0644\u0645\u0632\u0648\u0651\u062F"],
  "settings.models.temperature": ["Temperature", "\u0627\u0644\u062D\u0631\u0627\u0631\u0629"],
  "settings.models.temperature.hint": [
    "0 = deterministic, 1 = creative. Empty = provider default.",
    "\u0660 = \u062D\u062A\u0645\u064A\u060C \u0661 = \u0625\u0628\u062F\u0627\u0639\u064A. \u0641\u0627\u0631\u063A = \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0644\u0644\u0645\u0632\u0648\u0651\u062F."
  ],
  "settings.privacy": ["Privacy & data", "\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"],
  "settings.privacy.note": [
    "SADEEM talks only to the AI providers you configure. There is no SADEEM telemetry server.",
    "\u064A\u062A\u0648\u0627\u0635\u0644 \u0633\u062F\u064A\u0645 \u0641\u0642\u0637 \u0645\u0639 \u0645\u0632\u0648\u0651\u062F\u064A \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0627\u0644\u0630\u064A\u0646 \u062A\u0636\u0628\u0637\u0647\u0645. \u0644\u0627 \u064A\u0648\u062C\u062F \u062E\u0627\u062F\u0645 \u062A\u062A\u0628\u0651\u0639 \u062A\u0627\u0628\u0639 \u0644\u0633\u062F\u064A\u0645."
  ],
  "settings.usageData": ["Local usage data", "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u062D\u0644\u064A\u0629"],
  "settings.usageData.hint": [
    "Runs/tokens/cost history used for limits and the usage panel. Never leaves this device.",
    "\u0633\u062C\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0648\u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A \u0648\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0644\u0644\u062D\u062F\u0648\u062F \u0648\u0644\u0648\u062D\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645. \u0644\u0627 \u064A\u062A\u0631\u0643 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0623\u0628\u062F\u0627\u064B."
  ],
  "settings.usageData.clear": ["Clear", "\u0645\u0633\u062D"],
  "settings.usageData.cleared": ["Usage data cleared", "\u0645\u064F\u0633\u062D\u062A \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "settings.autoApproveEdits.hint": [
    "Agent edits are applied without confirmation",
    "\u062A\u064F\u0637\u0628\u064E\u0651\u0642 \u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644 \u062F\u0648\u0646 \u062A\u0623\u0643\u064A\u062F"
  ],
  "settings.checkpoints.hint": [
    "Snapshots let you restore any file the agent changed",
    "\u0644\u0642\u0637\u0627\u062A \u062A\u062A\u064A\u062D \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0623\u064A \u0645\u0644\u0641 \u0639\u062F\u0651\u0644\u0647 \u0627\u0644\u0648\u0643\u064A\u0644"
  ]
};
Object.assign(D, D_ORCH);
var D_WAVE13 = {
  // keyboard shortcuts overlay
  "shortcuts.title": ["Keyboard shortcuts", "\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "shortcuts.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "shortcuts.nav": ["Navigation", "\u0627\u0644\u062A\u0646\u0642\u0644"],
  "shortcuts.files": ["Files & editor", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u0627\u0644\u0645\u062D\u0631\u0631"],
  "shortcuts.agent": ["Agent & chat", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "shortcuts.view": ["View & panels", "\u0627\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u0644\u0648\u062D\u0627\u062A"],
  // global search
  "search.title": ["Search in files", "\u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "search.placeholder": ["Search text across the workspace\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0643\u0644 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644\u2026"],
  "search.filter": ["File filter (glob)", "\u0645\u0631\u0634\u0651\u062D \u0627\u0644\u0645\u0644\u0641\u0627\u062A (glob)"],
  "search.results": ["{n} results in {f} files", "{n} \u0646\u062A\u064A\u062C\u0629 \u0641\u064A {f} \u0645\u0644\u0641"],
  "search.empty": ["No results", "\u0644\u0627 \u0646\u062A\u0627\u0626\u062C"],
  "search.hint": ["Press Enter to search \xB7 Click a result to open it", "\u0627\u0636\u063A\u0637 Enter \u0644\u0644\u0628\u062D\u062B \xB7 \u0627\u0646\u0642\u0631 \u0646\u062A\u064A\u062C\u0629 \u0644\u0641\u062A\u062D\u0647\u0627"],
  // statusbar / perf
  "status.mcp": ["MCP tools", "\u0623\u062F\u0648\u0627\u062A MCP"],
  "status.perf": ["Performance", "\u0627\u0644\u0623\u062F\u0627\u0621"],
  "status.preview": ["Preview", "\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  // MCP panel v1.3
  "mcp.presets": ["One-click servers", "\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0628\u0636\u063A\u0637\u0629 \u0648\u0627\u062D\u062F\u0629"],
  "mcp.add": ["Add server", "\u0623\u0636\u0641 \u0633\u064A\u0631\u0641\u0631"],
  "mcp.addFromPreset": ["Add", "\u0625\u0636\u0627\u0641\u0629"],
  "mcp.transport": ["Transport", "\u0646\u0642\u0644"],
  "mcp.transport.stdio": ["Local process (stdio)", "\u0639\u0645\u0644\u064A\u0629 \u0645\u062D\u0644\u064A\u0629 (stdio)"],
  "mcp.transport.http": ["HTTP (remote)", "HTTP (\u0628\u0639\u064A\u062F)"],
  "mcp.transport.sse": ["SSE (remote)", "SSE (\u0628\u0639\u064A\u062F)"],
  "mcp.url": ["Server URL", "\u0631\u0627\u0628\u0637 \u0627\u0644\u0633\u064A\u0631\u0641\u0631"],
  "mcp.headers": ["Headers (JSON)", "\u062A\u0631\u0648\u064A\u0633\u0627\u062A (JSON)"],
  "mcp.timeout": ["Timeout (ms)", "\u0627\u0644\u0645\u0647\u0644\u0629 (\u0645\u0644\u0651\u064A)"],
  "mcp.autoReconnect": ["Auto-reconnect", "\u0625\u0639\u0627\u062F\u0629 \u0627\u062A\u0635\u0627\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0629"],
  "mcp.health": ["Health", "\u0627\u0644\u062D\u0627\u0644\u0629"],
  "mcp.state.connected": ["Connected", "\u0645\u062A\u0635\u0644"],
  "mcp.state.connecting": ["Connecting\u2026", "\u064A\u062A\u0635\u0644\u2026"],
  "mcp.state.disconnected": ["Disconnected", "\u063A\u064A\u0631 \u0645\u062A\u0635\u0644"],
  "mcp.state.disabled": ["Disabled", "\u0645\u0639\u0637\u0651\u0644"],
  "mcp.state.error": ["Error", "\u062E\u0637\u0623"],
  "mcp.latency": ["{ms} ms", "{ms} \u0645\u0644\u0651\u064A"],
  "mcp.tools": ["{n} tools", "{n} \u0623\u062F\u0627\u0629"],
  "mcp.resources": ["Resources", "\u0627\u0644\u0645\u0648\u0627\u0631\u062F"],
  "mcp.prompts": ["Prompts", "\u0627\u0644\u0642\u0648\u0627\u0644\u0628"],
  "mcp.refresh": ["Reconnect all", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u062A\u0635\u0627\u0644"],
  "mcp.connect": ["Connect", "\u0627\u062A\u0635\u0627\u0644"],
  "mcp.test": ["Test", "\u0627\u062E\u062A\u0628\u0627\u0631"],
  "mcp.envHint": ["Fill the required environment variables", "\u0627\u0645\u0644\u0623 \u0645\u062A\u063A\u064A\u0631\u0627\u062A \u0627\u0644\u0628\u064A\u0626\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629"],
  "mcp.docs": ["Docs", "\u0627\u0644\u062F\u0644\u064A\u0644"],
  "mcp.empty": ["No MCP servers yet \u2014 add one from the presets below.", "\u0644\u0627 \u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0628\u0639\u062F \u2014 \u0623\u0636\u0641 \u0648\u0627\u062D\u062F\u0627\u064B \u0645\u0646 \u0627\u0644\u0642\u0648\u0627\u0644\u0628 \u0623\u062F\u0646\u0627\u0647."],
  "mcp.total": ["{n} tools from {s} servers", "{n} \u0623\u062F\u0627\u0629 \u0645\u0646 {s} \u0633\u064A\u0631\u0641\u0631\u0627\u062A"],
  // billing v1.3
  "billing.title": ["Subscription", "\u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643"],
  "billing.status.trialing": ["Pro trial \u2014 {n} days left", "\u062A\u062C\u0631\u0628\u0629 \u0628\u0631\u0648 \u2014 {n} \u064A\u0648\u0645 \u0645\u062A\u0628\u0642\u064D"],
  "billing.status.active": ["Active", "\u0646\u0634\u0637"],
  "billing.status.canceled": ["Canceled", "\u0645\u0644\u063A\u0649"],
  "billing.status.past_due": ["Payment due", "\u062F\u0641\u0639\u0629 \u0645\u0639\u0644\u0651\u0642\u0629"],
  "billing.renewsAt": ["Renews {date}", "\u064A\u062A\u062C\u062F\u062F {date}"],
  "billing.seats": ["{n} seats", "{n} \u0645\u0642\u0627\u0639\u062F"],
  "billing.currentPlan": ["Current plan", "\u062E\u0637\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "billing.upgrade": ["Upgrade", "\u062A\u0631\u0642\u064A\u0629"],
  "billing.choose": ["Choose", "\u0627\u062E\u062A\u064A\u0627\u0631"],
  "billing.coupon": ["Coupon code", "\u0643\u0648\u062F \u062E\u0635\u0645"],
  "billing.coupon.apply": ["Apply", "\u062A\u0637\u0628\u064A\u0642"],
  "billing.coupon.ok": ["Coupon applied \u2014 {p}% off", "\u0637\u064F\u0628\u0651\u0642 \u0627\u0644\u062E\u0635\u0645 \u2014 {p}%"],
  "billing.coupon.invalid": ["Invalid or expired code", "\u0643\u0648\u062F \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0646\u062A\u0647\u064D"],
  "billing.paymentLink": ["Payment link (Stripe)", "\u0631\u0627\u0628\u0637 \u0627\u0644\u062F\u0641\u0639 (Stripe)"],
  "billing.paymentLink.hint": ["Paste your Stripe payment link \u2014 Upgrade buttons open it.", "\u0623\u0644\u0635\u0642 \u0631\u0627\u0628\u0637 \u0627\u0644\u062F\u0641\u0639 \u0645\u0646 Stripe \u2014 \u0623\u0632\u0631\u0627\u0631 \u0627\u0644\u062A\u0631\u0642\u064A\u0629 \u062A\u0641\u062A\u062D\u0647."],
  "billing.save": ["Save", "\u062D\u0641\u0638"],
  "billing.checkout.open": ["Secure checkout opened in your browser", "\u0641\u062A\u062D \u0627\u0644\u062F\u0641\u0639 \u0627\u0644\u0622\u0645\u0646 \u0641\u064A \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  "billing.usageHistory": ["Usage history", "\u0633\u062C\u0644 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "billing.month": ["Month", "\u0627\u0644\u0634\u0647\u0631"],
  "billing.limits": ["Plan limits", "\u062D\u062F\u0648\u062F \u0627\u0644\u062E\u0637\u0629"],
  "billing.gate.device": ["Device-control tools require Pro.", "\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u062C\u0647\u0627\u0632 \u062A\u062A\u0637\u0644\u0628 \u0628\u0631\u0648."],
  "billing.gate.parallel": ["Parallel tool calls require Pro.", "\u0627\u0633\u062A\u062F\u0639\u0627\u0621 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A \u064A\u062A\u0637\u0644\u0628 \u0628\u0631\u0648."],
  "billing.gate.subagent": ["Subagents require Pro.", "\u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u0648\u0646 \u064A\u062A\u0637\u0644\u0628\u0648\u0646 \u0628\u0631\u0648."],
  "billing.gate.mcp": ["More MCP servers require an upgrade.", "\u0639\u062F\u062F \u0623\u0643\u0628\u0631 \u0645\u0646 \u0633\u064A\u0631\u0641\u0631\u0627\u062A MCP \u064A\u062A\u0637\u0644\u0628 \u062A\u0631\u0642\u064A\u0629."],
  "billing.gate.run": ["Daily run limit reached \u2014 upgrade or wait for tomorrow.", "\u0628\u0644\u063A\u062A \u062D\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u064A\u0648\u0645\u064A \u2014 \u0631\u0642\u0651 \u0623\u0648 \u0627\u0646\u062A\u0638\u0631 \u0627\u0644\u063A\u062F."],
  // preview v1.3
  "preview.deviceFrame": ["Device frame", "\u0625\u0637\u0627\u0631 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "preview.console": ["Console", "\u0648\u062D\u062F\u0629 \u0627\u0644\u062A\u062D\u0643\u0645"],
  "preview.autoRefresh": ["Auto-refresh on save", "\u062A\u062D\u062F\u064A\u062B \u062A\u0644\u0642\u0627\u0626\u064A \u0639\u0646\u062F \u0627\u0644\u062D\u0641\u0638"],
  "preview.zoom": ["Zoom", "\u0627\u0644\u062A\u0643\u0628\u064A\u0631"],
  "preview.openExternal": ["Open in browser", "\u0627\u0641\u062A\u062D \u0641\u064A \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  "preview.history": ["History", "\u0627\u0644\u0633\u062C\u0644"],
  "preview.empty.title": ["Nothing to preview yet", "\u0644\u0627 \u0634\u064A\u0621 \u0644\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0628\u0639\u062F"],
  "preview.empty.hint": ["Build an app with the agent, or serve any folder / open any URL.", "\u0627\u0628\u0646\u0650 \u062A\u0637\u0628\u064A\u0642\u0627\u064B \u0645\u0639 \u0627\u0644\u0648\u0643\u064A\u0644\u060C \u0623\u0648 \u0642\u062F\u0651\u0645 \u0623\u064A \u0645\u062C\u0644\u062F / \u0627\u0641\u062A\u062D \u0623\u064A \u0631\u0627\u0628\u0637."],
  "preview.static": ["Static", "\u062B\u0627\u0628\u062A\u0629"],
  "preview.dev": ["Dev server", "\u0633\u064A\u0631\u0641\u0631 \u062A\u0637\u0648\u064A\u0631"],
  "preview.autoDetected": ["Detected: {script}", "\u062A\u0645 \u0627\u0643\u062A\u0634\u0627\u0641: {script}"],
  "preview.stop": ["Stop", "\u0625\u064A\u0642\u0627\u0641"],
  "preview.start": ["Start", "\u062A\u0634\u063A\u064A\u0644"],
  "preview.dir": ["Serve folder", "\u062A\u0642\u062F\u064A\u0645 \u0645\u062C\u0644\u062F"],
  "preview.console.empty": ["Console output appears here", "\u0645\u062E\u0631\u062C\u0627\u062A \u0648\u062D\u062F\u0629 \u0627\u0644\u062A\u062D\u0643\u0645 \u062A\u0638\u0647\u0631 \u0647\u0646\u0627"],
  "preview.clear": ["Clear", "\u0645\u0633\u062D"],
  // chat v1.3
  "chat.copy": ["Copy", "\u0646\u0633\u062E"],
  "chat.copied": ["Copied", "\u0646\u064F\u0633\u062E"],
  "chat.retry": ["Retry", "\u0625\u0639\u0627\u062F\u0629"],
  "chat.thinking": ["Thinking", "\u064A\u0641\u0643\u0651\u0631"],
  "chat.thinking.copy": ["Copy reasoning", "\u0627\u0646\u0633\u062E \u0627\u0644\u062A\u0641\u0643\u064A\u0631"],
  "chat.thinking.copied": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "chat.thinking.show": ["Show reasoning", "\u0623\u0638\u0647\u0631 \u0627\u0644\u062A\u0641\u0643\u064A\u0631"],
  "chat.thinking.hide": ["Hide reasoning", "\u0623\u062E\u0641\u0650 \u0627\u0644\u062A\u0641\u0643\u064A\u0631"],
  "chat.thinking.live": ["Jump to live", "\u0625\u0644\u0649 \u0622\u062E\u0631 \u0627\u0644\u0633\u0637\u0631"],
  "chat.tokens": ["{in} in \xB7 {out} out", "{in} \u062F\u062E\u0648\u0644 \xB7 {out} \u062E\u0631\u0648\u062C"],
  "chat.pasteImage": ["Paste an image or drop files here", "\u0623\u0644\u0635\u0642 \u0635\u0648\u0631\u0629 \u0623\u0648 \u0623\u0641\u0644\u062A \u0645\u0644\u0641\u0627\u062A \u0647\u0646\u0627"],
  "chat.drop": ["Drop files to attach", "\u0623\u0641\u0644\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0644\u0644\u0625\u0631\u0641\u0627\u0642"],
  "chat.mention": ["Type @ to mention a file", "\u0627\u0643\u062A\u0628 @ \u0644\u0630\u0643\u0631 \u0645\u0644\u0641"],
  // settings v1.3
  "settings.nav.general": ["General", "\u0639\u0627\u0645"],
  "settings.nav.appearance": ["Appearance", "\u0627\u0644\u0645\u0638\u0647\u0631"],
  "settings.nav.editor": ["Editor", "\u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.nav.terminal": ["Terminal", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.nav.agent": ["Agent", "\u0627\u0644\u0648\u0643\u064A\u0644"],
  "settings.nav.models": ["Models", "\u0627\u0644\u0646\u0645\u0627\u0630\u062C"],
  "settings.nav.preview": ["Preview", "\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "settings.nav.mcp": ["MCP servers", "\u0633\u064A\u0631\u0641\u0631\u0627\u062A MCP"],
  "settings.nav.billing": ["Billing", "\u0627\u0644\u0641\u0648\u062A\u0631\u0629"],
  "settings.nav.notifications": ["Notifications", "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A"],
  "settings.nav.privacy": ["Privacy", "\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629"],
  "settings.nav.advanced": ["Advanced", "\u0645\u062A\u0642\u062F\u0645"],
  "settings.search": ["Search settings\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A\u2026"],
  "settings.reset": ["Reset to defaults", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A"],
  "settings.saved": ["Saved", "\u062D\u064F\u0641\u0638"],
  "settings.agent.maxTurns": ["Max turns per run", "\u0623\u0642\u0635\u0649 \u062F\u0648\u0631\u0627\u062A \u0644\u0643\u0644 \u062A\u0634\u063A\u064A\u0644"],
  "settings.agent.promptCaching": ["Prompt caching", "\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u064A\u0627\u0642 \u0645\u0624\u0642\u062A\u0627\u064B"],
  "settings.agent.promptCaching.hint": ["Caches the long system prompt on Anthropic \u2014 faster and ~90% cheaper on repeat turns.", "\u064A\u062E\u0632\u0651\u0646 \u0633\u064A\u0627\u0642 \u0627\u0644\u0646\u0638\u0627\u0645 \u0639\u0644\u0649 Anthropic \u2014 \u0623\u0633\u0631\u0639 \u0648\u0623\u0631\u062E\u0635 ~90% \u0641\u064A \u0627\u0644\u062F\u0648\u0631\u0627\u062A \u0627\u0644\u0645\u062A\u0643\u0631\u0631\u0629."],
  "settings.agent.parallel": ["Parallel tool calls", "\u0623\u062F\u0648\u0627\u062A \u0645\u062A\u0648\u0627\u0632\u064A\u0629"],
  "settings.agent.parallel.hint": ["Run independent tool calls at the same time (Pro).", "\u0646\u0641\u0651\u0630 \u0627\u0633\u062A\u062F\u0639\u0627\u0621\u0627\u062A \u0645\u0633\u062A\u0642\u0644\u0629 \u0641\u064A \u0648\u0642\u062A \u0648\u0627\u062D\u062F (\u0628\u0631\u0648)."],
  "settings.agent.maxRetries": ["Retries on rate limit", "\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0627\u062A \u0639\u0646\u062F \u0636\u063A\u0637 \u0627\u0644\u0645\u0632\u0648\u0651\u062F"],
  "settings.agent.autoCompact": ["Auto-compact long sessions", "\u0636\u063A\u0637 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0637\u0648\u064A\u0644\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.preview.autoDetect": ["Auto-detect dev servers", "\u0627\u0643\u062A\u0634\u0627\u0641 \u062A\u0644\u0642\u0627\u0626\u064A \u0644\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0627\u0644\u062A\u0637\u0648\u064A\u0631"],
  "settings.preview.deviceFrame": ["Device frame by default", "\u0625\u0637\u0627\u0631 \u0627\u0644\u062C\u0647\u0627\u0632 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0627\u064B"],
  "settings.preview.console": ["Show console panel", "\u0625\u0638\u0647\u0627\u0631 \u0644\u0648\u062D\u0629 \u0648\u062D\u062F\u0629 \u0627\u0644\u062A\u062D\u0643\u0645"],
  "settings.ui.reduceMotion": ["Reduce motion & animations", "\u062A\u0642\u0644\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0629 \u0648\u0627\u0644\u0627\u0646\u062A\u0642\u0627\u0644\u0627\u062A"],
  "settings.ui.compact": ["Compact density", "\u0643\u062B\u0627\u0641\u0629 \u0645\u0636\u063A\u0648\u0637\u0629"],
  // preview v1.3 extras (agent A)
  "preview.targets": ["Detected targets", "\u0627\u0644\u0645\u0635\u0627\u062F\u0631 \u0627\u0644\u0645\u0643\u062A\u0634\u0641\u0629"],
  "preview.noTargets": [
    "No targets found \u2014 build the project, add an index.html, or open a URL.",
    "\u0644\u0627 \u0645\u0635\u0627\u062F\u0631 \u2014 \u0627\u0628\u0646\u0650 \u0627\u0644\u0645\u0634\u0631\u0648\u0639\u060C \u0623\u0648 \u0623\u0636\u0641 index.html\u060C \u0623\u0648 \u0627\u0641\u062A\u062D \u0631\u0627\u0628\u0637\u0627\u064B."
  ],
  "preview.openUrl": ["Open a URL", "\u0627\u0641\u062A\u062D \u0631\u0627\u0628\u0637\u0627\u064B"],
  // v11.10 — honest preview error card (WHY nothing is showing)
  "preview.err.title": ["Preview could not start", "\u062A\u0639\u0630\u0651\u0631 \u0628\u062F\u0621 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "preview.err.noWorkspace": [
    "Open a workspace folder first \u2014 the preview serves YOUR project.",
    "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0623\u0648\u0644\u0627\u064B \u2014 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062A\u0639\u0631\u0636 \u0645\u0634\u0631\u0648\u0639\u0643 \u0623\u0646\u062A."
  ],
  "preview.err.noPackage": [
    "No package.json here \u2014 this is not a Node project. Use \u201CServe folder\u201D for plain HTML, or add a dev script.",
    '\u0644\u0627 \u064A\u0648\u062C\u062F package.json \u0647\u0646\u0627 \u2014 \u0647\u0630\u0627 \u0644\u064A\u0633 \u0645\u0634\u0631\u0648\u0639 Node. \u0627\u0633\u062A\u062E\u062F\u0645 "\u0642\u062F\u0651\u0645 \u0645\u062C\u0644\u062F\u0627\u064B" \u0644\u0645\u0644\u0641\u0627\u062A HTML \u0627\u0644\u0639\u0627\u062F\u064A\u0629\u060C \u0623\u0648 \u0623\u0636\u0641 \u0633\u0643\u0631\u0628\u062A \u062A\u0637\u0648\u064A\u0631.'
  ],
  "preview.err.noDevScript": [
    "package.json has no dev/start/serve script \u2014 add one, or use \u201CServe folder\u201D for static output.",
    '\u0645\u0644\u0641 package.json \u0628\u0644\u0627 \u0633\u0643\u0631\u0628\u062A dev/start/serve \u2014 \u0623\u0636\u0641 \u0648\u0627\u062D\u062F\u0627\u064B\u060C \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0645 "\u0642\u062F\u0651\u0645 \u0645\u062C\u0644\u062F\u0627\u064B" \u0644\u0644\u0625\u062E\u0631\u0627\u062C \u0627\u0644\u062B\u0627\u0628\u062A.'
  ],
  "preview.err.noPython": [
    "No Python entry found (manage.py / app.py / main.py / server.py) \u2014 use \u201CServe folder\u201D for plain HTML.",
    '\u0644\u0627 \u0645\u062F\u062E\u0644\u0629 Python (manage.py / app.py / main.py / server.py) \u2014 \u0627\u0633\u062A\u062E\u062F\u0645 "\u0642\u062F\u0651\u0645 \u0645\u062C\u0644\u062F\u0627\u064B" \u0644\u0645\u0644\u0641\u0627\u062A HTML \u0627\u0644\u0639\u0627\u062F\u064A\u0629.'
  ],
  "preview.err.noCustom": [
    "No custom preview command set \u2014 add one in Settings \u2192 Live Preview.",
    "\u0644\u0627 \u0623\u0645\u0631 \u0645\u0639\u0627\u064A\u0646\u0629 \u0645\u062E\u0635\u0635 \u0645\u0636\u0628\u0648\u0637 \u2014 \u0623\u0636\u0641 \u0648\u0627\u062D\u062F\u0627\u064B \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2192 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0651\u0629."
  ],
  "preview.err.startFailed": [
    "The dev server failed to start \u2014 check its output in the log drawer, fix the error, and try again.",
    "\u0641\u0634\u0644 \u0628\u062F\u0621 \u062E\u0627\u062F\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631 \u2014 \u0631\u0627\u062C\u0639 \u0645\u062E\u0631\u062C\u0627\u062A\u0647 \u0641\u064A \u062F\u0631\u062C \u0627\u0644\u0633\u062C\u0644\u060C \u0623\u0635\u0644\u062D \u0627\u0644\u062E\u0637\u0623\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."
  ],
  "preview.redetect": ["Re-detect", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0643\u0634\u0641"],
  // mcp v1.3 extras (agent B)
  "mcp.confirmDelete": ["Delete this server?", "\u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0633\u064A\u0631\u0641\u0631\u061F"],
  "mcp.env": ["Environment variable", "\u0645\u062A\u063A\u064A\u0631 \u0628\u064A\u0626\u0629"],
  "mcp.binary": ["Binary content", "\u0645\u062D\u062A\u0648\u0649 \u062B\u0646\u0627\u0626\u064A"],
  "mcp.emptyResource": ["(empty)", "(\u0641\u0627\u0631\u063A)"],
  "mcp.calls": ["{n} calls", "{n} \u0627\u0633\u062A\u062F\u0639\u0627\u0621"],
  "mcp.lastChecked": ["Checked {time}", "\u0641\u064F\u062D\u0635 {time}"],
  "mcp.err.name": ["Name is required", "\u0627\u0644\u0627\u0633\u0645 \u0645\u0637\u0644\u0648\u0628"],
  "mcp.err.command": ["Command is required for stdio servers", "\u0627\u0644\u0623\u0645\u0631 \u0645\u0637\u0644\u0648\u0628 \u0644\u0633\u064A\u0631\u0641\u0631\u0627\u062A stdio"],
  "mcp.err.url": ["A valid http(s) URL is required", "\u0631\u0627\u0628\u0637 http(s) \u0635\u0627\u0644\u062D \u0645\u0637\u0644\u0648\u0628"],
  "mcp.err.headers": ["Headers must be valid JSON", "\u0627\u0644\u062A\u0631\u0648\u064A\u0633\u0627\u062A \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 JSON \u0635\u0627\u0644\u062D"],
  "mcp.err.timeout": ["Timeout must be \u2265 1000 ms", "\u0627\u0644\u0645\u0647\u0644\u0629 \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 \u2265 \u0661\u0660\u0660\u0660 \u0645\u0644\u0651\u064A"],
  "mcp.err.save": ["Could not save the server", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u0633\u064A\u0631\u0641\u0631"]
};
Object.assign(D, D_WAVE13);
var D_WAVE13B = {
  // billing
  "billing.checkout.failed": ["Could not open checkout", "\u062A\u0639\u0630\u0651\u0631 \u0641\u062A\u062D \u0627\u0644\u062F\u0641\u0639"],
  "billing.started": ["Subscription started", "\u0628\u062F\u0623 \u0627\u0644\u0627\u0634\u062A\u0631\u0627\u0643"],
  "billing.noUsage": ["No usage recorded yet", "\u0644\u0627 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0633\u062C\u0651\u0644 \u0628\u0639\u062F"],
  "billing.loadFailed": ["Could not load billing data", "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0641\u0648\u062A\u0631\u0629"],
  "billing.paymentLink.invalid": ["Enter a valid http(s) URL", "\u0623\u062F\u062E\u0644 \u0631\u0627\u0628\u0637 http(s) \u0635\u0627\u0644\u062D"],
  "billing.coupon.hint": ["Try KODEX20", "\u062C\u0631\u0651\u0628 KODEX20"],
  "billing.limits.dailyRuns": ["Daily agent runs", "\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u064A\u0648\u0645\u064A\u0629"],
  "billing.limits.monthlyTokens": ["Monthly tokens", "\u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A \u0627\u0644\u0634\u0647\u0631\u064A\u0629"],
  "billing.limits.maxMcpServers": ["MCP servers", "\u0633\u064A\u0631\u0641\u0631\u0627\u062A MCP"],
  "billing.limits.deviceTools": ["Device tools", "\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062C\u0647\u0627\u0632"],
  "billing.limits.parallelCalls": ["Parallel tool calls", "\u0623\u062F\u0648\u0627\u062A \u0645\u062A\u0648\u0627\u0632\u064A\u0629"],
  "billing.limits.subagents": ["Subagents", "\u0648\u0643\u0644\u0627\u0621 \u0641\u0631\u0639\u064A\u0648\u0646"],
  "billing.limits.unlimited": ["Unlimited", "\u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F"],
  "billing.refresh": ["Refresh plan", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062E\u0637\u0629"],
  // auth welcome
  "auth.welcome.trial": ["Pro trial started", "\u0628\u062F\u0623\u062A \u062A\u062C\u0631\u0628\u0629 \u0628\u0631\u0648"],
  "auth.welcome.team": ["Team plan \u2014 welcome aboard", "\u062E\u0637\u0629 \u0627\u0644\u0641\u0631\u064A\u0642 \u2014 \u0623\u0647\u0644\u0627\u064B \u0628\u0643"],
  "auth.welcome.free": ["Welcome to SADEEM", "\u0623\u0647\u0644\u0627\u064B \u0628\u0643 \u0641\u064A \u0633\u062F\u064A\u0645"],
  "auth.welcome.trialNote": [
    "Every Pro capability is unlocked for {n} days.",
    "\u0643\u0644 \u0642\u062F\u0631\u0627\u062A \u0628\u0631\u0648 \u0645\u0641\u062A\u0648\u062D\u0629 \u0644\u0645\u062F\u0629 {n} \u064A\u0648\u0645\u0627\u064B."
  ],
  "auth.plan.pick": ["Pick a plan", "\u0627\u062E\u062A\u0631 \u062E\u0637\u0629"],
  "auth.plan.free.sub": ["Core agent, your own keys", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A \u0628\u0645\u0641\u0627\u062A\u064A\u062D\u0643"],
  "auth.plan.pro.sub": ["14-day Pro trial", "\u062A\u062C\u0631\u0628\u0629 \u0628\u0631\u0648 \u0661\u0664 \u064A\u0648\u0645\u0627\u064B"],
  "auth.plan.team.sub": ["5 seats, central billing", "\u0665 \u0645\u0642\u0627\u0639\u062F \u0648\u0641\u0648\u062A\u0631\u0629 \u0645\u0648\u062D\u062F\u0629"],
  // rail / search / shortcuts
  "rail.search": ["Search in files", "\u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "rail.shortcuts": ["Keyboard shortcuts", "\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "search.clear": ["Clear", "\u0645\u0633\u062D"],
  "search.caseSensitive": ["Match case", "\u0645\u0637\u0627\u0628\u0642\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0623\u062D\u0631\u0641"],
  "search.run": ["Search", "\u0627\u0628\u062D\u062B"],
  "search.noWorkspace": ["Open a folder to search in it", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0644\u0644\u0628\u062D\u062B \u062F\u0627\u062E\u0644\u0647"],
  "search.capped": ["Showing the first {n} results", "\u0623\u0648\u0644 {n} \u0646\u062A\u064A\u062C\u0629 \u0641\u0642\u0637"],
  "sc.palette": ["Command palette", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "sc.paletteAlso": ["Command palette (also)", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 (\u0623\u064A\u0636\u0627\u064B)"],
  "sc.inlineEdit": ["Inline AI edit in editor", "\u062A\u062D\u0631\u064A\u0631 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "sc.send": ["Send message", "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0631\u0633\u0627\u0644\u0629"],
  "sc.newline": ["New line", "\u0633\u0637\u0631 \u062C\u062F\u064A\u062F"],
  "sc.suggestions": ["Ghost suggestions", "\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0634\u0628\u062D\u064A\u0629"],
  "sc.esc": ["Close / cancel", "\u0625\u063A\u0644\u0627\u0642 / \u0625\u0644\u063A\u0627\u0621"],
  "sc.footerHint": ["Shortcuts use Ctrl on Windows/Linux and \u2318 on macOS", "\u0627\u0644\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u062A\u0633\u062A\u062E\u062F\u0645 Ctrl \u0639\u0644\u0649 \u0648\u064A\u0646\u062F\u0648\u0632/\u0644\u064A\u0646\u0643\u0633 \u0648 \u2318 \u0639\u0644\u0649 \u0645\u0627\u0643"],
  "pal.sec.settings": ["Settings", "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "pal.toggleSearch": ["Toggle global search", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0628\u062D\u062B \u0627\u0644\u0634\u0627\u0645\u0644"],
  "pal.shortcuts": ["Keyboard shortcuts", "\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "pal.servePreview": ["Serve workspace in preview", "\u062A\u0642\u062F\u064A\u0645 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0641\u064A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "pal.openPreviewUrl": ["Open preview URL in browser", "\u0641\u062A\u062D \u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0641\u064A \u0627\u0644\u0645\u062A\u0635\u0641\u062D"],
  // git / usage / statusbar
  "git.stageAll": ["Stage all", "\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0643\u0644"],
  "git.unstageAll": ["Unstage all", "\u0625\u062E\u0631\u0627\u062C \u0627\u0644\u0643\u0644"],
  "usage.uptime": ["Uptime", "\u0645\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sb.changed": ["{n} changed", "{n} \u0645\u062A\u063A\u064A\u0631\u0627\u062A"],
  "sb.changedShort": ["changes", "\u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  // chat / editor / diff / tools
  "chat.starter.explain": ["Explain this codebase", "\u0627\u0634\u0631\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "chat.starter.tests": ["Add tests to the selected file", "\u0623\u0636\u0641 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u062D\u062F\u062F"],
  "chat.starter.app": ["Build a small web app and preview it", "\u0627\u0628\u0646\u0650 \u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0628 \u0635\u063A\u064A\u0631 \u0648\u0639\u0627\u064A\u0646\u0647"],
  "chat.starter.assistant": ["What is on my screen right now?", "\u0645\u0627 \u0627\u0644\u0630\u064A \u064A\u0638\u0647\u0631 \u0639\u0644\u0649 \u0634\u0627\u0634\u062A\u064A \u0627\u0644\u0622\u0646\u061F"],
  "chat.starter.doc": ["Draft a one-page project report (PDF)", "\u0623\u0639\u062F\u0651 \u062A\u0642\u0631\u064A\u0631 \u0645\u0634\u0631\u0648\u0639 \u0645\u0646 \u0635\u0641\u062D\u0629 \u0648\u0627\u062D\u062F\u0629 (PDF)"],
  "chat.starterHint": ["Start with a suggestion or type your own task", "\u0627\u0628\u062F\u0623 \u0628\u0627\u0642\u062A\u0631\u0627\u062D \u0623\u0648 \u0627\u0643\u062A\u0628 \u0645\u0647\u0645\u062A\u0643"],
  "chat.jumpLatest": ["Jump to latest", "\u0627\u0646\u062A\u0642\u0644 \u0644\u0644\u0623\u062D\u062F\u062B"],
  "chat.imageTooBig": ["Image too large (max 5 MB)", "\u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064A\u0631\u0629 (\u0627\u0644\u062D\u062F \u0665 \u0645\u064A\u063A\u0627)"],
  "chat.imagesFull": ["Maximum 5 images", "\u0627\u0644\u062D\u062F \u0665 \u0635\u0648\u0631"],
  "ed.dirty": ["Unsaved changes", "\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u062D\u0641\u0648\u0638\u0629"],
  "ed.lines": ["{n} lines", "{n} \u0633\u0637\u0631\u0627\u064B"],
  "ed.scrollStart": ["Scroll to start", "\u0627\u0646\u062A\u0642\u0644 \u0644\u0644\u0628\u062F\u0627\u064A\u0629"],
  "ed.scrollEnd": ["Scroll to end", "\u0627\u0646\u062A\u0642\u0644 \u0644\u0644\u0646\u0647\u0627\u064A\u0629"],
  "editor.minimap": ["Minimap", "\u0627\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0645\u0635\u063A\u0631\u0629"],
  "diff.copyPath": ["Copy path", "\u0646\u0633\u062E \u0627\u0644\u0645\u0633\u0627\u0631"],
  "diff.copyPatch": ["Copy patch", "\u0646\u0633\u062E \u0627\u0644\u0631\u0642\u0639\u0629"],
  "tool.showMore": ["Show all", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0643\u0644"],
  "tool.showLess": ["Show less", "\u0625\u0638\u0647\u0627\u0631 \u0623\u0642\u0644"],
  "palette.togglePreview": ["Toggle live preview", "\u0625\u0638\u0647\u0627\u0631/\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0629"]
};
Object.assign(D, D_WAVE13B);
var D_WAVE13C = {
  "settings.language.hint": ["Interface language \u2014 restart not required", "\u0644\u063A\u0629 \u0627\u0644\u0648\u0627\u062C\u0647\u0629 \u2014 \u0628\u062F\u0648\u0646 \u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644"],
  "settings.general.desc": ["Language, theme, permissions and workspace history", "\u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u0645\u0638\u0647\u0631 \u0648\u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A \u0648\u0633\u062C\u0644 \u0645\u0633\u0627\u062D\u0627\u062A \u0627\u0644\u0639\u0645\u0644"],
  "settings.general.onboarding": ["Welcome tour", "\u0627\u0644\u062C\u0648\u0644\u0629 \u0627\u0644\u062A\u0631\u062D\u064A\u0628\u064A\u0629"],
  "settings.general.onboarding.hint": ["Replay the guided introduction", "\u0625\u0639\u0627\u062F\u0629 \u0639\u0631\u0636 \u0627\u0644\u062A\u0639\u0631\u064A\u0641 \u0627\u0644\u0645\u0648\u062C\u0651\u0647"],
  "settings.general.onboarding.run": ["Run tour", "\u0634\u063A\u0651\u0644 \u0627\u0644\u062C\u0648\u0644\u0629"],
  "settings.general.onboarding.armed": ["Tour will show on next launch", "\u0633\u062A\u0638\u0647\u0631 \u0627\u0644\u062C\u0648\u0644\u0629 \u0639\u0646\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A"],
  "settings.general.recent": ["Recent workspaces", "\u0645\u0633\u0627\u062D\u0627\u062A \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "settings.general.recent.empty": ["No recent workspaces", "\u0644\u0627 \u0645\u0633\u0627\u062D\u0627\u062A \u0639\u0645\u0644 \u0623\u062E\u064A\u0631\u0629"],
  "settings.general.recent.open": ["Open", "\u0641\u062A\u062D"],
  "settings.general.recent.clear": ["Clear list", "\u0645\u0633\u062D \u0627\u0644\u0642\u0627\u0626\u0645\u0629"],
  "settings.appearance.desc": ["Typography, density and motion", "\u0627\u0644\u062E\u0637\u0648\u0637 \u0648\u0627\u0644\u0643\u062B\u0627\u0641\u0629 \u0648\u0627\u0644\u062D\u0631\u0643\u0629"],
  "settings.appearance.livePreview": ["Preview", "\u0645\u0639\u0627\u064A\u0646\u0629"],
  "settings.ui.reduceMotion.hint": ["Disables non-essential animations across the app", "\u064A\u0639\u0637\u0651\u0644 \u0627\u0644\u062D\u0631\u0643\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0641\u064A \u0643\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "settings.ui.compact.hint": ["Tighter spacing and smaller paddings", "\u062A\u0628\u0627\u0639\u062F \u0623\u0636\u064A\u0642 \u0648\u0647\u0648\u0627\u0645\u0634 \u0623\u0635\u063A\u0631"],
  "settings.editor.desc": ["Editing behaviour and inline AI", "\u0633\u0644\u0648\u0643 \u0627\u0644\u062A\u062D\u0631\u064A\u0631 \u0648\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0645\u0636\u0645\u0651\u0646"],
  "settings.editor.chrome": ["Editor chrome", "\u0647\u064A\u0643\u0644 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.editor.minimap.note": ["Minimap toggles live in the editor toolbar", "\u0632\u0631 \u0627\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0645\u0635\u063A\u0631\u0629 \u0641\u064A \u0634\u0631\u064A\u0637 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.editor.wordWrap.note": ["Word wrap follows the editor toolbar setting", "\u0627\u0644\u062A\u0641\u0627\u0641 \u0627\u0644\u0623\u0633\u0637\u0631 \u064A\u062A\u0628\u0639 \u0625\u0639\u062F\u0627\u062F \u0634\u0631\u064A\u0637 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.editor.indent.note": ["Indentation is detected per file", "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0628\u0627\u062F\u0626\u0629 \u062A\u064F\u0643\u062A\u0634\u0641 \u0644\u0643\u0644 \u0645\u0644\u0641"],
  "settings.terminal.desc": ["Embedded terminal preferences", "\u062A\u0641\u0636\u064A\u0644\u0627\u062A \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629"],
  "settings.terminal.environment": ["Environment", "\u0627\u0644\u0628\u064A\u0626\u0629"],
  "settings.terminal.shell.note": ["Default shell of your platform", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0629 \u0644\u0646\u0638\u0627\u0645\u0643"],
  "settings.agent.desc": ["Engine loop, caching and context limits", "\u062D\u0644\u0642\u0629 \u0627\u0644\u0645\u062D\u0631\u0643 \u0648\u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0624\u0642\u062A \u0648\u062D\u062F\u0648\u062F \u0627\u0644\u0633\u064A\u0627\u0642"],
  "settings.agent.loop": ["Agent loop", "\u062D\u0644\u0642\u0629 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "settings.agent.efficiency": ["Efficiency", "\u0627\u0644\u0643\u0641\u0627\u0621\u0629"],
  "settings.agent.context": ["Context management", "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "settings.agent.maxTurns.hint": ["Tool-call rounds before the agent stops", "\u0639\u062F\u062F \u062F\u0648\u0631\u0627\u062A \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0642\u0628\u0644 \u062A\u0648\u0642\u0641 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "settings.agent.maxRetries.hint": ["Automatic retries on rate limits (429) and provider errors", "\u0645\u062D\u0627\u0648\u0644\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0629 \u0639\u0646\u062F \u0636\u063A\u0637 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0648\u0623\u062E\u0637\u0627\u0626\u0647"],
  "settings.agent.autoCompact.hint": ["Summarize the transcript when it grows too long", "\u062A\u0644\u062E\u064A\u0635 \u0627\u0644\u0633\u062C\u0644 \u0639\u0646\u062F \u0637\u0648\u0644 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "settings.agent.compactThreshold": ["Compact threshold (chars)", "\u062D\u062F \u0627\u0644\u0636\u063A\u0637 (\u062D\u0631\u0648\u0641)"],
  "settings.agent.longTasks": ["Long tasks (hours-long runs)", "\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0637\u0648\u064A\u0644\u0629 (\u062A\u0645\u062A\u062F \u0644\u0633\u0627\u0639\u0627\u062A)"],
  "settings.agent.continueAuto": ["Auto-continue long tasks", "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0637\u0648\u064A\u0644\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.agent.continueAuto.hint": [
    "When the step budget runs out mid-task the engine starts a fresh round and keeps working until done",
    "\u0639\u0646\u062F \u0646\u0641\u0627\u062F \u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0627\u062A \u064A\u0641\u062A\u062D \u0627\u0644\u0645\u062D\u0631\u0643 \u062C\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629 \u0648\u064A\u0648\u0627\u0635\u0644 \u0627\u0644\u0639\u0645\u0644 \u062D\u062A\u0649 \u0627\u0644\u0625\u0646\u062C\u0627\u0632"
  ],
  "settings.agent.maxContinueRounds": ["Max continuation rounds", "\u0623\u0642\u0635\u0649 \u0639\u062F\u062F \u062C\u0648\u0644\u0627\u062A \u0645\u062A\u0627\u0628\u0639\u0629"],
  "settings.agent.maxContinueRounds.hint": [
    "Each round = a full step budget. 30 rounds \xD7 40 steps is enough for hours of autonomous work",
    "\u0643\u0644 \u062C\u0648\u0644\u0629 = \u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u062E\u0637\u0648\u0627\u062A \u0643\u0627\u0645\u0644\u0629. \u0663\u0660 \u062C\u0648\u0644\u0629 \xD7 \u0664\u0660 \u062E\u0637\u0648\u0629 \u062A\u0643\u0641\u064A \u0644\u0633\u0627\u0639\u0627\u062A \u0645\u0646 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0630\u0627\u062A\u064A"
  ],
  "settings.agent.effort": ["Deep thinking effort", "\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0639\u0645\u064A\u0642"],
  "settings.agent.effort.hint": [
    "Doubles the step budget and adds a thinking-first directive for intricate work",
    "\u064A\u0636\u0627\u0639\u0641 \u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0627\u062A \u0648\u064A\u0636\u064A\u0641 \u062A\u0648\u062C\u064A\u0647 \xAB\u0641\u0643\u0651\u0631 \u0623\u0648\u0644\u0627\u064B\xBB \u0644\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0645\u0639\u0642\u062F\u0629"
  ],
  "settings.agent.verifyCommand": ["Verify command (after edits)", "\u0623\u0645\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 (\u0628\u0639\u062F \u0627\u0644\u062A\u0639\u062F\u064A\u0644)"],
  "settings.agent.verifyCommand.hint": [
    "e.g. \u201Cnpm run typecheck\u201D \u2014 runs automatically after edit runs; failures trigger one fix round",
    "\u0645\u062B\u0644 \xABnpm run typecheck\xBB \u2014 \u064A\u0639\u0645\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0639\u062F \u062C\u0648\u0644\u0627\u062A \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u060C \u0648\u0639\u0646\u062F \u0627\u0644\u0641\u0634\u0644 \u062A\u0628\u062F\u0623 \u062C\u0648\u0644\u0629 \u0625\u0635\u0644\u0627\u062D \u0648\u0627\u062D\u062F\u0629"
  ],
  "settings.models.desc": ["Providers, keys and model tuning", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0648\u0646 \u0648\u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0648\u0636\u0628\u0637 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.models.active": ["Active model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637"],
  "settings.models.config": ["Model parameters", "\u0645\u0639\u0627\u0645\u0644\u0627\u062A \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.models.auto": ["Auto", "\u062A\u0644\u0642\u0627\u0626\u064A"],
  "settings.models.keyless": ["No key needed", "\u0628\u062F\u0648\u0646 \u0645\u0641\u062A\u0627\u062D"],
  "settings.models.noKeyNeeded": ["This provider runs without an API key", "\u0647\u0630\u0627 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u064A\u0639\u0645\u0644 \u0628\u062F\u0648\u0646 \u0645\u0641\u062A\u0627\u062D"],
  "settings.models.showKey": ["Show key", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0645\u0641\u062A\u0627\u062D"],
  "settings.models.hideKey": ["Hide key", "\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u0645\u0641\u062A\u0627\u062D"],
  "settings.models.loadModels": ["Load live models", "\u062C\u0644\u0628 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062D\u064A\u0629"],
  "settings.models.searchPh": ["Filter models\u2026", "\u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0646\u0645\u0627\u0630\u062C\u2026"],
  "settings.models.live": ["Live list", "\u0642\u0627\u0626\u0645\u0629 \u062D\u064A\u0629"],
  "settings.models.preset": ["Curated presets", "\u0642\u0648\u0627\u0626\u0645 \u0645\u062E\u062A\u0627\u0631\u0629"],
  "settings.models.none": ["No models matched", "\u0644\u0627 \u0646\u0645\u0627\u0630\u062C \u0645\u0637\u0627\u0628\u0642\u0629"],
  "settings.models.selectHint": ["Click a model to select it", "\u0627\u0646\u0642\u0631 \u0646\u0645\u0648\u0630\u062C\u0627\u064B \u0644\u0627\u062E\u062A\u064A\u0627\u0631\u0647"],
  "settings.models.fetched": ["Fetched", "\u062C\u064F\u0644\u0628\u062A"],
  "settings.preview.desc": ["Universal live preview defaults", "\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0627\u062A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0629 \u0627\u0644\u0634\u0627\u0645\u0644\u0629"],
  "settings.preview.behaviour": ["Behaviour", "\u0627\u0644\u0633\u0644\u0648\u0643"],
  "settings.preview.autoDetect.hint": ["Detect dev servers and built output automatically", "\u0627\u0643\u062A\u0634\u0627\u0641 \u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0627\u0644\u062A\u0637\u0648\u064A\u0631 \u0648\u0627\u0644\u0645\u062E\u0631\u062C\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.preview.autoRefresh": ["Auto-refresh", "\u062A\u062D\u062F\u064A\u062B \u062A\u0644\u0642\u0627\u0626\u064A"],
  "settings.preview.autoRefresh.hint": ["Reload when watched files change", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u062D\u0645\u064A\u0644 \u0639\u0646\u062F \u062A\u063A\u064A\u0651\u0631 \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "settings.preview.deviceFrame.hint": ["Show a phone/tablet frame around the preview", "\u0625\u0637\u0627\u0631 \u0647\u0627\u062A\u0641/\u0644\u0648\u062D\u064A \u062D\u0648\u0644 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "settings.preview.console.hint": ["Capture webview console output", "\u0627\u0644\u062A\u0642\u0627\u0637 \u0645\u062E\u0631\u062C\u0627\u062A \u0648\u062D\u062F\u0629 \u0627\u0644\u062A\u062D\u0643\u0645"],
  "settings.preview.zoom": ["Default zoom", "\u0627\u0644\u062A\u0643\u0628\u064A\u0631 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A"],
  "settings.preview.zoom.hint": ["50\u2013150%", "\u0665\u0660\u2013\u0661\u0665\u0660\u066A"],
  "settings.mcp.desc": ["Model Context Protocol servers", "\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0628\u0631\u0648\u062A\u0648\u0643\u0648\u0644 \u0633\u064A\u0627\u0642 \u0627\u0644\u0646\u0645\u0627\u0630\u062C"],
  "settings.mcp.configured": ["Configured", "\u0645\u064F\u0639\u062F\u0651\u0629"],
  "settings.mcp.connected": ["Connected", "\u0645\u062A\u0635\u0644\u0629"],
  "settings.mcp.totalTools": ["Total tools", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "settings.mcp.open": ["Open MCP panel", "\u0627\u0641\u062A\u062D \u0644\u0648\u062D\u0629 MCP"],
  "settings.mcp.refresh": ["Refresh", "\u062A\u062D\u062F\u064A\u062B"],
  "settings.mcp.note": ["Servers are probed over stdio, HTTP or SSE", "\u062A\u064F\u0641\u062D\u0635 \u0627\u0644\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0639\u0628\u0631 stdio \u0623\u0648 HTTP \u0623\u0648 SSE"],
  "settings.nav.apiServer": ["API server", "\u062E\u0627\u062F\u0645 API"],
  "settings.search.empty": ["No settings match", "\u0644\u0627 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629"],
  "settings.search.emptyHint": ["Try a different word", "\u062C\u0631\u0651\u0628 \u0643\u0644\u0645\u0629 \u0623\u062E\u0631\u0649"],
  "settings.notifications.desc": ["Desktop alerts and tray behaviour", "\u062A\u0646\u0628\u064A\u0647\u0627\u062A \u0633\u0637\u062D \u0627\u0644\u0645\u0643\u062A\u0628 \u0648\u0633\u0644\u0648\u0643 \u0627\u0644\u0639\u0644\u0628\u0629"],
  "settings.privacy.desc": ["Local-first data policy", "\u0633\u064A\u0627\u0633\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u062D\u0644\u064A\u0629 \u0623\u0648\u0644\u0627\u064B"],
  "settings.privacy.telemetry": ["No telemetry. Your code and keys never leave this device.", "\u0628\u0644\u0627 \u062A\u062A\u0628\u0651\u0639. \u0643\u0648\u062F\u0643 \u0648\u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0644\u0627 \u064A\u062A\u0631\u0643\u0627\u0646 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632."],
  "settings.advanced.desc": ["Power-user options and data management", "\u062E\u064A\u0627\u0631\u0627\u062A \u0645\u062A\u0642\u062F\u0645\u0629 \u0648\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"],
  "settings.advanced.env": ["Environment variables", "\u0645\u062A\u063A\u064A\u0631\u0627\u062A \u0627\u0644\u0628\u064A\u0626\u0629"],
  "settings.advanced.env.home": ["Overrides the SADEEM home directory (~/.surnia by default)", "\u064A\u062A\u062C\u0627\u0648\u0632 \u0645\u062C\u0644\u062F \u0633\u062F\u064A\u0645 \u0627\u0644\u0631\u0626\u064A\u0633\u064A (~/.surnia \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0627\u064B)"],
  "settings.advanced.env.gpu": ["Set to 1 to re-enable GPU rendering", "\u0627\u0636\u0628\u0637\u0647 1 \u0644\u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0645\u0639\u0627\u0644\u062C \u0627\u0644\u0631\u0633\u0648\u0645\u064A\u0627\u062A"],
  "settings.advanced.env.smoke": ["Headless smoke-test mode (CI)", "\u0648\u0636\u0639 \u0627\u062E\u062A\u0628\u0627\u0631 \u0635\u0627\u0645\u062A (CI)"],
  "settings.advanced.env.hint": ["Restart the app after changing these", "\u0623\u0639\u062F \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0628\u0639\u062F \u062A\u063A\u064A\u064A\u0631\u0647\u0627"],
  "settings.advanced.usageStats": ["Usage statistics", "\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "settings.advanced.totalRuns": ["Total runs", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A"],
  "settings.advanced.totalTokens": ["Total tokens", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A"],
  "settings.advanced.totalCost": ["Total cost", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062A\u0643\u0644\u0641\u0629"],
  "settings.advanced.days": ["days tracked", "\u064A\u0648\u0645\u0627\u064B \u0645\u0633\u062C\u0644\u0627\u064B"],
  "settings.advanced.goApiServer": ["Manage API server", "\u0625\u062F\u0627\u0631\u0629 \u062E\u0627\u062F\u0645 API"],
  "settings.advanced.danger": ["Danger zone", "\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u062E\u0637\u0631"],
  "settings.advanced.clearUsage.hint": ["Deletes the local runs/tokens/cost history", "\u064A\u062D\u0630\u0641 \u0633\u062C\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0648\u0627\u0644\u062A\u0643\u0627\u0644\u064A\u0641 \u0627\u0644\u0645\u062D\u0644\u064A"],
  "settings.advanced.confirm": ["Click again to confirm", "\u0627\u0646\u0642\u0631 \u0645\u062C\u062F\u062F\u0627\u064B \u0644\u0644\u062A\u0623\u0643\u064A\u062F"],
  "settings.advanced.resetAll": ["Reset all settings", "\u0625\u0639\u0627\u062F\u0629 \u0643\u0644 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "settings.advanced.resetAll.hint": ["Restores defaults except language, theme, onboarding and billing", "\u064A\u0639\u064A\u062F \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0645\u0627 \u0639\u062F\u0627 \u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u0645\u0638\u0647\u0631 \u0648\u0627\u0644\u062A\u0631\u062D\u064A\u0628 \u0648\u0627\u0644\u0641\u0648\u062A\u0631\u0629"],
  "settings.advanced.resetAll.done": ["All settings restored", "\u0627\u0633\u062A\u064F\u0639\u064A\u062F\u062A \u0643\u0644 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"]
};
Object.assign(D, D_WAVE13C);
var D_UI_POLISH = {
  // editor status line cursor position
  "ln-col": ["Ln {n}, Col {c}", "\u0633\u0637\u0631 {n}\u060C \u0639\u0645\u0648\u062F {c}"],
  // terminal banner
  "terminal-banner": ["SADEEM terminal", "\u0637\u0631\u0641\u064A\u0629 \u0633\u062F\u064A\u0645"],
  // inline-edit widget presets (bilingual instructions for the model)
  "inline-explain": ["Explain what this code does, concisely.", "\u0627\u0634\u0631\u062D \u0645\u0627 \u064A\u0641\u0639\u0644\u0647 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0628\u0625\u064A\u062C\u0627\u0632."],
  "inline-fix": [
    "Fix the bugs and problems in this code. Output only the corrected code.",
    "\u0623\u0635\u0644\u062D \u0627\u0644\u0623\u062E\u0637\u0627\u0621 \u0648\u0627\u0644\u0645\u0634\u0627\u0643\u0644 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F. \u0627\u0639\u0631\u0636 \u0627\u0644\u0643\u0648\u062F \u0627\u0644\u0645\u0635\u062D\u064E\u0651\u062D \u0641\u0642\u0637."
  ],
  "inline-add-tests": ["Write focused unit tests for this code.", "\u0627\u0643\u062A\u0628 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0648\u062D\u062F\u0629 \u0645\u0631\u0643\u0651\u0632\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F."],
  "inline-refactor": [
    "Refactor this code for clarity and quality. Output only the refactored code.",
    "\u0623\u0639\u062F \u0647\u064A\u0643\u0644\u0629 \u0647\u0630\u0627 \u0627\u0644\u0643\u0648\u062F \u0644\u0644\u0648\u0636\u0648\u062D \u0648\u0627\u0644\u062C\u0648\u062F\u0629. \u0627\u0639\u0631\u0636 \u0627\u0644\u0643\u0648\u062F \u0628\u0639\u062F \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0647\u064A\u0643\u0644\u0629 \u0641\u0642\u0637."
  ],
  // usage panel live badge
  "live-badge": ["live", "\u0645\u0628\u0627\u0634\u0631"],
  // preview / workspace notices (consumed via notify by the orchestrator)
  "starting-dev": ["Starting dev server\u2026", "\u0628\u062F\u0621 \u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u062A\u0637\u0648\u064A\u0631\u2026"],
  "preview-failed": ["Preview failed", "\u0641\u0634\u0644\u062A \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "open-workspace-first": ["Open a workspace first", "\u0627\u0641\u062A\u062D \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0623\u0648\u0644\u0627\u064B"],
  // resizable chat panel handle
  "chat.resizePanel": ["Resize chat panel", "\u062A\u063A\u064A\u064A\u0631 \u062D\u062C\u0645 \u0644\u0648\u062D\u0629 \u0627\u0644\u062F\u0631\u062F\u0634\u0629"],
  "chat.resizeHint": ["Drag to resize \xB7 double-click to reset", "\u0627\u0633\u062D\u0628 \u0644\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u062D\u062C\u0645 \xB7 \u0646\u0642\u0631\u0629 \u0645\u0632\u062F\u0648\u062C\u0629 \u0644\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  // editor tab strip
  "ed.tabs": ["Open editors", "\u0627\u0644\u0645\u062D\u0631\u0631\u0627\u062A \u0627\u0644\u0645\u0641\u062A\u0648\u062D\u0629"],
  // toasts
  "toast.dismiss": ["Dismiss", "\u062A\u062C\u0627\u0647\u0644"],
  "toast.region": ["Notifications", "\u0627\u0644\u062A\u0646\u0628\u064A\u0647\u0627\u062A"]
};
var D_AGENT_D = {
  // ---------- workspace command center (WorkspacePanel redesign) ----------
  "wscc.clean": ["clean working tree", "\u0634\u062C\u0631\u0629 \u0639\u0645\u0644 \u0646\u0638\u064A\u0641\u0629"],
  "wscc.dirty": ["{n} uncommitted", "{n} \u063A\u064A\u0631 \u0645\u0648\u062F\u0639\u0629"],
  "wscc.files": ["Files", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "wscc.sessionsCount": ["Sessions", "\u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "wscc.tokens": ["Tokens", "\u0627\u0644\u0631\u0645\u0648\u0632"],
  "wscc.lastActivity": ["Last activity", "\u0622\u062E\u0631 \u0646\u0634\u0627\u0637"],
  "wscc.never": ["never", "\u0623\u0628\u062F\u0627\u064B"],
  "wscc.fileTypes": ["File types", "\u0623\u0646\u0648\u0627\u0639 \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "wscc.noFiles": ["No files indexed yet", "\u0644\u0627 \u0645\u0644\u0641\u0627\u062A \u0645\u0641\u0647\u0631\u0633\u0629 \u0628\u0639\u062F"],
  "wscc.other": ["other", "\u0623\u062E\u0631\u0649"],
  "wscc.recent": ["Recent sessions", "\u0623\u062D\u062F\u062B \u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "wscc.noSessions": ["No sessions in this workspace yet", "\u0644\u0627 \u062C\u0644\u0633\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629 \u0628\u0639\u062F"],
  "wscc.quick": ["Quick actions", "\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0633\u0631\u064A\u0639\u0629"],
  "wscc.newSession": ["New session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "wscc.terminal": ["Terminal", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "wscc.preview": ["Preview", "\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "wscc.initMemory": ["Init memory", "\u062A\u0647\u064A\u0626\u0629 \u0627\u0644\u0630\u0627\u0643\u0631\u0629"],
  "wscc.review": ["Review changes", "\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  "wscc.memory": ["Project memory", "\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "wscc.memoryEmpty": ["No MEMORY.md yet \u2014 run /init to generate one", "\u0644\u0627 \u064A\u0648\u062C\u062F MEMORY.md \u2014 \u0634\u063A\u0651\u0644 /init \u0644\u0625\u0646\u0634\u0627\u0626\u0647"],
  "wscc.memoryFailed": ["Could not save MEMORY.md", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 MEMORY.md"],
  "wscc.worktrees": ["Worktrees", "\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "wscc.worktreeNew": ["New worktree", "\u0634\u062C\u0631\u0629 \u0639\u0645\u0644 \u062C\u062F\u064A\u062F\u0629"],
  "wscc.worktreeEmpty": ["No worktrees \u2014 create one to run agents in parallel", "\u0644\u0627 \u0623\u0634\u062C\u0627\u0631 \u0639\u0645\u0644 \u2014 \u0623\u0646\u0634\u0626 \u0648\u0627\u062D\u062F\u0629 \u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0628\u0627\u0644\u062A\u0648\u0627\u0632\u064A"],
  "wscc.worktreeMerge": ["Merge", "\u062F\u0645\u062C"],
  "wscc.worktreeRemove": ["Remove", "\u0625\u0632\u0627\u0644\u0629"],
  "wscc.worktreeConfirmRemove": ["Remove this worktree?", "\u0625\u0632\u0627\u0644\u0629 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647\u061F"],
  "wscc.worktreeConfirmMerge": ["Merge this worktree into the current branch?", "\u062F\u0645\u062C \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647 \u0641\u064A \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062D\u0627\u0644\u064A\u061F"],
  "wscc.worktreeCreated": ["Worktree created", "\u0623\u064F\u0646\u0634\u0626\u062A \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "wscc.worktreeMerged": ["Worktree merged", "\u062A\u0645 \u0627\u0644\u062F\u0645\u062C"],
  "wscc.worktreeRemoved": ["Worktree removed", "\u0623\u064F\u0632\u064A\u0644\u062A \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "wscc.worktreeFailed": ["Worktree operation failed", "\u0641\u0634\u0644\u062A \u0639\u0645\u0644\u064A\u0629 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "wscc.createdRel": ["created {0}", "\u0623\u064F\u0646\u0634\u0626\u062A {0}"],
  // ---------- chat agent-v2 ----------
  "goal.title": ["Goal", "\u0627\u0644\u0647\u062F\u0641"],
  "goal.clear": ["Clear goal", "\u0645\u0633\u062D \u0627\u0644\u0647\u062F\u0641"],
  "chat.queue": ["Queue", "\u0648\u0636\u0639 \u0628\u0627\u0644\u0637\u0627\u0628\u0648\u0631"],
  "chat.queued": ["{n} queued", "{n} \u0628\u0627\u0644\u0637\u0627\u0628\u0648\u0631"],
  "chat.queuedHint": ["The agent is busy \u2014 your message runs when it finishes", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u0634\u063A\u0648\u0644 \u2014 \u0633\u062A\u064F\u0646\u0641\u064E\u0651\u0630 \u0631\u0633\u0627\u0644\u062A\u0643 \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0626\u0647"],
  "chat.queuedFail": ["Could not queue the message", "\u062A\u0639\u0630\u0651\u0631 \u0648\u0636\u0639 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0628\u0627\u0644\u0637\u0627\u0628\u0648\u0631"],
  // ---------- slash commands (v2) ----------
  "palette.goal": ["/goal \u2014 set & track an agent goal", "/goal \u2014 \u062A\u0639\u064A\u064A\u0646 \u0647\u062F\u0641 \u0644\u0644\u0648\u0643\u064A\u0644 \u0648\u0645\u062A\u0627\u0628\u0639\u062A\u0647"],
  "palette.review": ["/review \u2014 AI review of pending changes", "/review \u2014 \u0645\u0631\u0627\u062C\u0639\u0629 \u0630\u0643\u064A\u0629 \u0644\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0627\u0644\u0645\u0639\u0644\u0651\u0642\u0629"],
  "palette.schedule": ["/schedule \u2014 scheduled agent jobs", "/schedule \u2014 \u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629 \u0644\u0644\u0648\u0643\u064A\u0644"],
  "palette.fork": ["/fork \u2014 fork this session", "/fork \u2014 \u062A\u0634\u0639\u064A\u0628 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "palette.export": ["/export \u2014 download session as Markdown", "/export \u2014 \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u062C\u0644\u0633\u0629 \u0643\u0640 Markdown"],
  "palette.commit": ["/commit \u2014 AI-suggested commit message", "/commit \u2014 \u0627\u0642\u062A\u0631\u0627\u062D \u0631\u0633\u0627\u0644\u0629 \u0625\u064A\u062F\u0627\u0639 \u0628\u0627\u0644\u0630\u0643\u0627\u0621"],
  // ---------- sessions panel ----------
  "sess.tabSessions": ["Sessions", "\u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "sess.tabSchedule": ["Scheduled", "\u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "sess.fork": ["Fork session", "\u062A\u0634\u0639\u064A\u0628 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "sess.export": ["Export as Markdown", "\u062A\u0635\u062F\u064A\u0631 \u0643\u0640 Markdown"],
  "sess.forked": ["Session forked", "\u062A\u0645 \u062A\u0634\u0639\u064A\u0628 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "sess.exported": ["Session exported", "\u062A\u0645 \u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "sess.running": ["running", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sess.done": ["done", "\u0645\u0646\u062A\u0647\u064A\u0629"],
  // ---------- schedule panel ----------
  "sched.title": ["Scheduled jobs", "\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "sched.add": ["Add job", "\u0623\u0636\u0641 \u0645\u0647\u0645\u0629"],
  "sched.addTitle": ["New scheduled job", "\u0645\u0647\u0645\u0629 \u0645\u062C\u062F\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "sched.name": ["Job name", "\u0627\u0633\u0645 \u0627\u0644\u0645\u0647\u0645\u0629"],
  "sched.namePh": ["Daily standup digest\u2026", "\u0645\u0644\u062E\u0635 \u064A\u0648\u0645\u064A\u2026"],
  "sched.prompt": ["Prompt", "\u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "sched.promptPh": ["What should the agent do on each run?", "\u0645\u0627\u0630\u0627 \u064A\u0641\u0639\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0641\u064A \u0643\u0644 \u062A\u0634\u063A\u064A\u0644\u061F"],
  "sched.cron": ["Cron schedule", "\u062C\u062F\u0648\u0644\u0629 cron"],
  "sched.cronPh": ["@daily or 0 9 * * 1-5", "@daily \u0623\u0648 0 9 * * 1-5"],
  "sched.cronHint": ["5-field cron or @hourly @daily @weekly", "cron \u0628\u062E\u0645\u0633\u0629 \u062D\u0642\u0648\u0644 \u0623\u0648 @hourly @daily @weekly"],
  "sched.workspace": ["Workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "sched.empty": ["No scheduled jobs yet \u2014 automate reviews, digests or maintenance", "\u0644\u0627 \u0645\u0647\u0627\u0645 \u0645\u062C\u062F\u0648\u0644\u0629 \u2014 \u0623\u062A\u0645\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0627\u062A \u0648\u0627\u0644\u0645\u0644\u062E\u0635\u0627\u062A \u0648\u0627\u0644\u0635\u064A\u0627\u0646\u0629"],
  "sched.runNow": ["Run now", "\u0634\u063A\u0651\u0644 \u0627\u0644\u0622\u0646"],
  "sched.lastRun": ["Last run", "\u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644"],
  "sched.required": ["Name, prompt and cron are required", "\u0627\u0644\u0627\u0633\u0645 \u0648\u0627\u0644\u062A\u0648\u062C\u064A\u0647 \u0648\u0627\u0644\u062C\u062F\u0648\u0644\u0629 \u0645\u0637\u0644\u0648\u0628\u0629"],
  "sched.created": ["Job created", "\u0623\u064F\u0646\u0634\u0626\u062A \u0627\u0644\u0645\u0647\u0645\u0629"],
  "sched.confirmRemove": ["Delete this job?", "\u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0645\u0647\u0645\u0629\u061F"],
  "sched.statusOk": ["last run succeeded", "\u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644 \u0646\u062C\u062D"],
  "sched.statusError": ["last run failed", "\u0641\u0634\u0644 \u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644"],
  "sched.statusRunning": ["running now", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sched.openChat": ["Open the session transcript", "\u0627\u0641\u062A\u062D \u0633\u062C\u0644 \u0627\u0644\u062C\u0644\u0633\u0629"],
  // ---------- usage panel ----------
  "usage.14day": ["Last 14 days", "\u0622\u062E\u0631 \u0661\u0664 \u064A\u0648\u0645\u0627\u064B"],
  "usage.byModel": ["Top models", "\u0623\u0643\u062B\u0631 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0627\u064B"],
  "usage.modelsEmpty": ["No model usage yet", "\u0644\u0627 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0644\u0644\u0646\u0645\u0627\u0630\u062C \u0628\u0639\u062F"],
  // ---------- git panel ----------
  "git.aiCommitFailed": ["Could not generate a message", "\u062A\u0639\u0630\u0651\u0631 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0631\u0633\u0627\u0644\u0629"],
  "git.suggested": ["AI suggestion filled in \u2014 review and commit", "\u0639\u064F\u0628\u0651\u0626 \u0627\u0642\u062A\u0631\u0627\u062D \u0627\u0644\u0630\u0643\u0627\u0621 \u2014 \u0631\u0627\u062C\u0639\u0647 \u062B\u0645 \u0623\u0648\u062F\u0650\u0639"],
  // ---------- status bar ----------
  "sb.sessionCost": ["Session cost", "\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062C\u0644\u0633\u0629"],
  // ---------- SURVEYOR v4 additions (design-shell) ----------
  "ui.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "tb.breadcrumb": ["Open workspace panel", "\u0627\u0641\u062A\u062D \u0644\u0648\u062D\u0629 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "rail.security": ["Security", "\u0627\u0644\u0623\u0645\u0627\u0646"],
  "welcome.quick.title": ["Quick start", "\u0628\u062F\u0627\u064A\u0629 \u0633\u0631\u064A\u0639\u0629"],
  "welcome.openRecent": ["Open recent", "\u0641\u062A\u062D \u0627\u0644\u0623\u062D\u062F\u062B"],
  "welcome.local": ["SADEEM \u2014 runs locally on your machine", "\u0633\u062F\u064A\u0645 \u2014 \u064A\u0639\u0645\u0644 \u0645\u062D\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643"],
  "welcome.cap.multi": ["Multi-provider", "\u0645\u062A\u0639\u062F\u062F \u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646"],
  "welcome.cap.mcp": ["MCP", "MCP"],
  "welcome.cap.worktrees": ["Worktrees", "\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "welcome.cap.worktrees.desc": [
    "Isolated git worktrees for parallel agent branches",
    "\u0623\u0634\u062C\u0627\u0631 \u0639\u0645\u0644 \u0645\u0639\u0632\u0648\u0644\u0629 \u0644\u0641\u0631\u0648\u0639 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A\u0629"
  ],
  "welcome.cap.local": ["Local-first", "\u0645\u062D\u0644\u064A \u0623\u0648\u0644\u0627\u064B"],
  "auth.or": ["or", "\u0623\u0648"],
  "onboard.step.lang": ["Language", "\u0627\u0644\u0644\u063A\u0629"],
  "onboard.step.appearance": ["Appearance", "\u0627\u0644\u0645\u0638\u0647\u0631"],
  "onboard.step.profile": ["Profile", "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A"],
  "onboard.step.trust": ["Workspace trust", "\u0627\u0644\u062B\u0642\u0629 \u0628\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "pal.commands": ["commands", "\u0623\u0645\u0631 \u0645\u062A\u0627\u062D"]
};
Object.assign(D, D_AGENT_D);
Object.assign(D, D_UI_POLISH);
var D_V22 = {
  // rail + surfaces
  "rail.dna": ["DNA", "\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645"],
  "dna.title": ["DNA map", "\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645"],
  "dna.tagline": ["How SADEEM adapts to you", "\u0643\u064A\u0641 \u064A\u062A\u0643\u064A\u0651\u0641 \u0633\u062F\u064A\u0645 \u0645\u0639\u0643"],
  // empty state + how it works
  "dna.emptyTitle": ["SADEEM learns how you work\u2026", "\u0633\u062F\u064A\u0645 \u064A\u062A\u0639\u0644\u0651\u0645 \u0623\u0633\u0644\u0648\u0628 \u0639\u0645\u0644\u0643\u2026"],
  "dna.emptySub": [
    "As you collaborate, it distills durable patterns, preferences and corrections into a local profile \u2014 and future runs start with it.",
    "\u0623\u062B\u0646\u0627\u0621 \u062A\u0639\u0627\u0648\u0646\u0643 \u064A\u0633\u062A\u062E\u0644\u0635 \u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0648\u062A\u0641\u0636\u064A\u0644\u0627\u062A\u0643 \u0648\u062A\u0635\u062D\u064A\u062D\u0627\u062A\u0643 \u0641\u064A \u0645\u0644\u0641 \u0645\u062D\u0644\u064A \u2014 \u0648\u062A\u0628\u062F\u0623 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0642\u0627\u062F\u0645\u0629 \u0628\u0647\u0630\u0627 \u0627\u0644\u0641\u0647\u0645."
  ],
  "dna.howTitle": ["How it works", "\u0643\u064A\u0641 \u064A\u0639\u0645\u0644"],
  "dna.how1": ["Observes \u2014 watches your sessions, edits and commands", "\u064A\u0644\u0627\u062D\u0638 \u2014 \u064A\u0631\u0627\u0642\u0628 \u062C\u0644\u0633\u0627\u062A\u0643 \u0648\u062A\u0639\u062F\u064A\u0644\u0627\u062A\u0643 \u0648\u0623\u0648\u0627\u0645\u0631\u0643"],
  "dna.how2": ["Distills \u2014 keeps durable patterns in dna.json, on this device only", "\u064A\u0633\u062A\u062E\u0644\u0635 \u2014 \u064A\u062D\u0641\u0638 \u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0641\u064A dna.json \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0641\u0642\u0637"],
  "dna.how3": ["Adapts \u2014 future runs start with your preferences baked in", "\u064A\u062A\u0643\u064A\u0651\u0641 \u2014 \u062A\u0628\u062F\u0623 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0642\u0627\u062F\u0645\u0629 \u0628\u062A\u0641\u0636\u064A\u0644\u0627\u062A\u0643 \u0645\u0636\u0645\u0651\u0631\u0629"],
  // growth strip
  "dna.growth": ["Growth", "\u0627\u0644\u0646\u0645\u0648"],
  "dna.loading": ["Reading dna.json\u2026", "\u064A\u0642\u0631\u0623 dna.json\u2026"],
  "dna.tile.sessions": ["Sessions", "\u062C\u0644\u0633\u0627\u062A"],
  "dna.tile.facts": ["Facts", "\u062D\u0642\u0627\u0626\u0642"],
  "dna.tile.patterns": ["Patterns", "\u0623\u0646\u0645\u0627\u0637"],
  "dna.updatedAt": ["Last update", "\u0622\u062E\u0631 \u062A\u062D\u062F\u064A\u062B"],
  "dna.never": ["never", "\u0623\u0628\u062F\u0627\u064B"],
  // profile card
  "dna.profile": ["Profile", "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A"],
  "dna.profile.tip": ["Chips teach SADEEM who you are \u2014 X removes a fact", "\u0627\u0644\u0631\u0642\u0627\u0626\u0642 \u062A\u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645 \u0645\u0646 \u0623\u0646\u062A \u2014 X \u062A\u0632\u064A\u0644 \u062D\u0642\u064A\u0642\u0629"],
  "dna.profileEmpty": [
    "No profile facts yet \u2014 add chips below, or let SADEEM observe you",
    "\u0644\u0627 \u062D\u0642\u0627\u0626\u0642 \u0634\u062E\u0635\u064A\u0629 \u0628\u0639\u062F \u2014 \u0623\u0636\u0641\u0647\u0627 \u064A\u062F\u0648\u064A\u0627\u064B \u0623\u0648 \u062F\u0639 \u0633\u062F\u064A\u0645 \u064A\u0644\u0627\u062D\u0638\u0643"
  ],
  "dna.name": ["Name", "\u0627\u0644\u0627\u0633\u0645"],
  "dna.role": ["Role", "\u0627\u0644\u062F\u0648\u0631"],
  "dna.expertise": ["Expertise", "\u0627\u0644\u062A\u062E\u0635\u0635"],
  "dna.languages": ["Languages", "\u0627\u0644\u0644\u063A\u0627\u062A"],
  "dna.likes": ["Likes", "\u0627\u0644\u0645\u0641\u0636\u0651\u0644\u0629"],
  "dna.dislikes": ["Dislikes", "\u063A\u064A\u0631 \u0627\u0644\u0645\u0641\u0636\u0651\u0644\u0629"],
  "dna.styleNotes": ["Style notes", "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u0623\u0633\u0644\u0648\u0628"],
  "dna.addNamePh": ["Your name\u2026", "\u0627\u0633\u0645\u0643\u2026"],
  "dna.addRolePh": ["Your role\u2026", "\u062F\u0648\u0631\u0643\u2026"],
  "dna.addExpertisePh": ["Add expertise\u2026", "\u0623\u0636\u0641 \u062A\u062E\u0635\u0635\u0627\u064B\u2026"],
  "dna.addLangsPh": ["Add language\u2026", "\u0623\u0636\u0641 \u0644\u063A\u0629\u2026"],
  "dna.addLikesPh": ["Add a preference\u2026", "\u0623\u0636\u0641 \u062A\u0641\u0636\u064A\u0644\u0627\u064B\u2026"],
  "dna.addDislikesPh": ["Add something to avoid\u2026", "\u0623\u0636\u0641 \u0645\u0627 \u064A\u0646\u0628\u063A\u064A \u062A\u062C\u0646\u0651\u0628\u0647\u2026"],
  "dna.addStylePh": ["Add a style note\u2026", "\u0623\u0636\u0641 \u0645\u0644\u0627\u062D\u0638\u0629 \u0623\u0633\u0644\u0648\u0628\u2026"],
  "dna.addTip": ["Press Enter to add", "\u0627\u0636\u063A\u0637 Enter \u0644\u0644\u0625\u0636\u0627\u0641\u0629"],
  "dna.remove": ["Remove", "\u0625\u0632\u0627\u0644\u0629"],
  "dna.removePattern": ["Forget this pattern", "\u0627\u0646\u0633\u064A \u0647\u0630\u0627 \u0627\u0644\u0646\u0645\u0637"],
  // patterns list
  "dna.patterns": ["Learned patterns", "\u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u0645\u062A\u0639\u0644\u064E\u0651\u0645\u0629"],
  "dna.patterns.tip": ["High confidence = seen repeatedly", "\u0627\u0644\u062B\u0642\u0629 \u0627\u0644\u0639\u0627\u0644\u064A\u0629 = \u0631\u064F\u0635\u062F \u0645\u0631\u0627\u0631\u0627\u064B"],
  "dna.patternCount": ["{n} patterns", "{n} \u0623\u0646\u0645\u0627\u0637"],
  "dna.patternEmpty": [
    "No patterns yet \u2014 repeated commands and workflows appear here",
    "\u0644\u0627 \u0623\u0646\u0645\u0627\u0637 \u0628\u0639\u062F \u2014 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0648\u0633\u064A\u0631 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062A\u0643\u0631\u0631 \u062A\u0638\u0647\u0631 \u0647\u0646\u0627"
  ],
  "dna.confidence": ["Confidence", "\u0627\u0644\u062B\u0642\u0629"],
  "dna.lastSeen": ["Last seen", "\u0622\u062E\u0631 \u0631\u0635\u062F"],
  "dna.countTip": ["Seen {n} times", "\u0631\u064F\u0635\u062F {n} \u0645\u0631\u0629"],
  "dna.kind.command": ["Command pattern", "\u0646\u0645\u0637 \u0623\u0645\u0631"],
  "dna.kind.workflow": ["Workflow pattern", "\u0646\u0645\u0637 \u0633\u064A\u0631 \u0639\u0645\u0644"],
  "dna.kind.style": ["Style pattern", "\u0646\u0645\u0637 \u0623\u0633\u0644\u0648\u0628"],
  "dna.kind.correction": ["Correction pattern", "\u0646\u0645\u0637 \u062A\u0635\u062D\u064A\u062D"],
  // feedback timeline
  "dna.feedback": ["Feedback timeline", "\u0633\u062C\u0644 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A"],
  "dna.feedback.tip": ["Your thumbs and the engine corrections, newest first", "\u0625\u0634\u0627\u062F\u0627\u062A\u0643 \u0648\u062A\u0635\u062D\u064A\u062D\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0643\u060C \u0627\u0644\u0623\u062D\u062F\u062B \u0623\u0648\u0644\u0627\u064B"],
  "dna.fbCount": ["{n} entries", "{n} \u0645\u062F\u062E\u0644\u0629"],
  "dna.fbEmpty": [
    "No feedback yet \u2014 rate answers with the thumbs in the chat",
    "\u0644\u0627 \u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0628\u0639\u062F \u2014 \u0642\u064A\u0651\u0645 \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0628\u0627\u0644\u0623\u0632\u0631\u0627\u0631 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"
  ],
  "dna.fb.praise": ["Praise", "\u0625\u0634\u0627\u062F\u0629"],
  "dna.fb.correction": ["Correction", "\u062A\u0635\u062D\u064A\u062D"],
  "dna.fb.preference": ["Preference", "\u062A\u0641\u0636\u064A\u0644"],
  "dna.fb.contextTip": ["Context", "\u0627\u0644\u0633\u064A\u0627\u0642"],
  // privacy bar
  "dna.privacy.title": ["Local & private", "\u0645\u062D\u0644\u064A \u0648\u062E\u0627\u0635"],
  "dna.privacy": [
    "Everything is stored locally in dna.json \u2014 never sent to providers except as short prompt context.",
    "\u0643\u0644 \u0634\u064A\u0621 \u064A\u064F\u062D\u0641\u0638 \u0645\u062D\u0644\u064A\u0627\u064B \u0641\u064A dna.json \u2014 \u0644\u0627 \u064A\u064F\u0631\u0633\u0644 \u0625\u0644\u0649 \u0627\u0644\u0645\u0632\u0648\u062F\u064A\u0646 \u0625\u0644\u0627 \u0643\u0633\u064A\u0627\u0642 \u0645\u0648\u062C\u0632 \u0636\u0645\u0646 \u0627\u0644\u062A\u0648\u062C\u064A\u0647."
  ],
  "dna.forgetWs": ["Forget workspace", "\u0627\u0646\u0633\u0650 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "dna.forget.tip": ["Clears the workspace layer only", "\u064A\u0645\u0633\u062D \u0637\u0628\u0642\u0629 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0641\u0642\u0637"],
  "dna.forgetAll": ["Forget all", "\u0627\u0646\u0633\u0650 \u0627\u0644\u0643\u0644"],
  "dna.forgetAll.tip": ["Clears the global profile + every workspace layer", "\u064A\u0645\u0633\u062D \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0639\u0627\u0645 + \u0643\u0644 \u0637\u0628\u0642\u0627\u062A \u0627\u0644\u0645\u0633\u0627\u062D\u0627\u062A"],
  "dna.forgetConfirmWs": [
    "Forget what SADEEM learned in this workspace?",
    "\u0647\u0644 \u062A\u0646\u0633\u064A \u0645\u0627 \u062A\u0639\u0644\u0651\u0645\u0647 \u0633\u062F\u064A\u0645 \u0641\u064A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647\u061F"
  ],
  "dna.forgetConfirmAll": [
    "Forget ALL learned DNA (global profile + every workspace)?",
    "\u0647\u0644 \u062A\u0646\u0633\u064A \u0643\u0644 \u0645\u0627 \u062A\u0639\u0644\u0651\u0645\u0647 \u0633\u062F\u064A\u0645 (\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0639\u0627\u0645 + \u0643\u0644 \u0645\u0633\u0627\u062D\u0627\u062A \u0627\u0644\u0639\u0645\u0644)\u061F"
  ],
  "dna.forgotWs": ["Workspace DNA forgotten", "\u0646\u064F\u0633\u064A\u062A \u0630\u0627\u0643\u0631\u0629 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629"],
  "dna.forgotAll": ["All DNA forgotten", "\u0646\u064F\u0633\u064A\u062A \u0643\u0644 \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645"],
  // skills-trust consent card
  "dna.trust.title": ["Workspace skills need your trust", "\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0628\u062D\u0627\u062C\u0629 \u0625\u0644\u0649 \u0645\u0648\u0627\u0641\u0642\u062A\u0643"],
  "dna.trust.body": [
    "This workspace ships skills that SADEEM has not trusted yet. Trust them to allow use in sessions.",
    "\u062A\u062A\u0636\u0645\u0646 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647 \u0645\u0647\u0627\u0631\u0627\u062A \u0644\u0645 \u064A\u0648\u062B\u0642 \u0628\u0647\u0627 \u0633\u062F\u064A\u0645 \u0628\u0639\u062F. \u0627\u0645\u0646\u062D\u0647\u0627 \u0627\u0644\u062B\u0642\u0629 \u0644\u0644\u0633\u0645\u0627\u062D \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647\u0627 \u0641\u064A \u0627\u0644\u062C\u0644\u0633\u0627\u062A."
  ],
  "dna.trust.btn": ["Trust workspace skills", "\u0648\u062B\u0642 \u0628\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  // message feedback
  "dna.fb.up": ["Helpful \u2014 teach SADEEM to keep this", "\u0645\u0641\u064A\u062F\u0629 \u2014 \u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645 \u0627\u0644\u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u0647\u0643\u0630\u0627"],
  "dna.fb.down": ["Not helpful \u2014 tell SADEEM what to change", "\u063A\u064A\u0631 \u0645\u0641\u064A\u062F\u0629 \u2014 \u0623\u062E\u0628\u0631 \u0633\u062F\u064A\u0645 \u0628\u0645\u0627 \u064A\u0646\u0628\u063A\u064A \u062A\u063A\u064A\u064A\u0631\u0647"],
  "dna.fb.notePh": ["Optional note \u2014 what should SADEEM adjust?", "\u0645\u0644\u0627\u062D\u0638\u0629 \u0627\u062E\u062A\u064A\u0627\u0631\u064A\u0629 \u2014 \u0645\u0627\u0630\u0627 \u064A\u0646\u0628\u063A\u064A \u0644\u0633\u062F\u064A\u0645 \u0623\u0646 \u064A\u0639\u062F\u0651\u0644\u061F"],
  "dna.fb.defaultPraise": ["Good answer \u2014 keep this approach", "\u0625\u062C\u0627\u0628\u0629 \u062C\u064A\u062F\u0629 \u2014 \u062D\u0627\u0641\u0638 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0623\u0633\u0644\u0648\u0628"],
  "dna.fb.defaultCorrection": ["Off track \u2014 adjust future answers", "\u062E\u0627\u0631\u062C \u0627\u0644\u0645\u0633\u0627\u0631 \u2014 \u0639\u062F\u0651\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0627\u062A \u0627\u0644\u0642\u0627\u062F\u0645\u0629"],
  "dna.fb.sent": ["DNA updated \u2014 SADEEM adapts to your feedback", "\u062D\u064F\u062F\u0651\u062B\u062A \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645 \u2014 \u0633\u062F\u064A\u0645 \u064A\u062A\u0643\u064A\u0651\u0641 \u0645\u0639 \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643"],
  "dna.fb.failed": ["Could not record the feedback", "\u062A\u0639\u0630\u0651\u0631 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0629"],
  // status bar chip
  "sb.dna": ["DNA", "DNA"],
  "sb.dnaTip": [
    "SADEEM DNA \u2014 {n} learned patterns \xB7 open the map",
    "\u0630\u0627\u0643\u0631\u0629 \u0633\u062F\u064A\u0645 \u2014 {n} \u0646\u0645\u0637\u0627\u064B \u0645\u062A\u0639\u0644\u064E\u0651\u0645\u0627\u064B \xB7 \u0627\u0641\u062A\u062D \u0627\u0644\u062E\u0631\u064A\u0637\u0629"
  ],
  // suggestion chip
  "dna.sug.title": ["Repeated workflow spotted", "\u064A\u0628\u062F\u0648 \u0623\u0646\u0643 \u062A\u0643\u0631\u0651\u0631 \u0646\u0641\u0633 \u0633\u064A\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "dna.sug.body": [
    "SADEEM noticed you repeat: \u201C{t}\u201D \u2014 turn it into a skill?",
    "\u0644\u0627\u062D\u0638 \u0633\u062F\u064A\u0645 \u0623\u0646\u0643 \u062A\u0643\u0631\u0651\u0631: \xAB{t}\xBB \u2014 \u0647\u0644 \u062A\u062D\u0648\u0651\u0644\u0647 \u0625\u0644\u0649 \u0645\u0647\u0627\u0631\u0629\u061F"
  ],
  "dna.sug.create": ["Turn into skill", "\u062D\u0648\u0651\u0644\u0647\u0627 \u0625\u0644\u0649 \u0645\u0647\u0627\u0631\u0629"],
  "dna.sug.dismiss": ["Dismiss", "\u062A\u062C\u0627\u0647\u0644"],
  "dna.sug.hint": [
    "A skill is a reusable SKILL.md playbook \u2014 review the draft before relying on it",
    "\u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u0645\u0644\u0641 SKILL.md \u0642\u0627\u0628\u0644 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u2014 \u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0633\u0648\u062F\u0629 \u0642\u0628\u0644 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0639\u0644\u064A\u0647\u0627"
  ],
  "dna.sug.skillMsg": [
    "Create a skill from this repeated workflow: {t}",
    "\u0623\u0646\u0634\u0626 \u0645\u0647\u0627\u0631\u0629 \u0645\u0646 \u0633\u064A\u0631 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062A\u0643\u0631\u0631 \u0647\u0630\u0627: {t}"
  ],
  // welcome + workspace + palette
  "welcome.dna": ["What has SADEEM learned?", "\u0645\u0627\u0630\u0627 \u062A\u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645\u061F"],
  "wscc.dnaMap": ["What has SADEEM learned?", "\u0645\u0627\u0630\u0627 \u062A\u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645\u061F"],
  "set.group.updates": ["Updates", "\u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A"],
  "set.group.updates.desc": ["Check for releases, feed URL, auto-check and install.", "\u0641\u062D\u0635 \u0627\u0644\u0625\u0635\u062F\u0627\u0631\u0627\u062A \u0648\u062E\u0644\u0627\u0635\u0629 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u0648\u0627\u0644\u062A\u062B\u0628\u064A\u062A."],
  "set.updates.title": ["Updates", "\u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A"],
  "set.updates.desc": ["Check for new releases against your own feed and download when you want \u2014 nothing installs without your click.", "\u0627\u0641\u062D\u0635 \u0627\u0644\u0625\u0635\u062F\u0627\u0631\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0645\u0646 \u062E\u0644\u0627\u0635\u062A\u0643 \u0627\u0644\u062E\u0627\u0635\u0629\u060C \u0648\u0646\u0632\u0651\u0644\u0647\u0627 \u062D\u064A\u0646 \u062A\u0631\u064A\u062F \u2014 \u0644\u0627 \u0634\u064A\u0621 \u064A\u064F\u062B\u0628\u064E\u0651\u062A \u062F\u0648\u0646 \u0645\u0648\u0627\u0641\u0642\u062A\u0643."],
  "wscc.newProjectTpl": ["New project", "\u0645\u0634\u0631\u0648\u0639 \u062C\u062F\u064A\u062F"],
  "wscc.schedJobs": ["Scheduled jobs", "\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "wscc.mcpEmpty": ["No MCP servers yet \u2014 connect one to extend the agent.", "\u0644\u0627 \u062E\u0648\u0627\u062F\u0645 MCP \u0628\u0639\u062F \u2014 \u0627\u0631\u0628\u0637 \u062E\u0627\u062F\u0645\u0627\u064B \u0644\u062A\u0648\u0633\u064A\u0639 \u0642\u062F\u0631\u0627\u062A \u0627\u0644\u0648\u0643\u064A\u0644."],
  "wscc.mcpAdd": ["Add MCP server", "\u0625\u0636\u0627\u0641\u0629 \u062E\u0627\u062F\u0645 MCP"],
  "wscc.schedEmpty": ["No scheduled jobs yet \u2014 put agent work on a cron.", "\u0644\u0627 \u0645\u0647\u0627\u0645 \u0645\u062C\u062F\u0648\u0644\u0629 \u0628\u0639\u062F \u2014 \u0636\u0639 \u0639\u0645\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0639\u0644\u0649 \u062C\u062F\u0648\u0644 \u0632\u0645\u0646\u064A."],
  "wscc.schedNew": ["New scheduled job", "\u0645\u0647\u0645\u0629 \u0645\u062C\u062F\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "palette.dnaMap": ["Open DNA map", "\u0627\u0641\u062A\u062D \u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645"],
  "palette.dnaForget": ["Forget DNA (workspace)", "\u0627\u0646\u0633\u0650 \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645 (\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644)"],
  "palette.dnaLearned": ["What has SADEEM learned?", "\u0645\u0627\u0630\u0627 \u062A\u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645\u061F"]
};
Object.assign(D, D_V22);
var D_V5 = {
  "palette.theme.soft": ["Theme: Soft", "\u0627\u0644\u0633\u0645\u0629: \u0646\u0627\u0639\u0645"],
  "settings.theme.soft": ["Carbon (secondary)", "\u0643\u0631\u0628\u0648\u0646\u064A (\u062C\u0627\u0646\u0628\u064A)"],
  "rail.skills": ["Skills", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  "skills.searchPh": ["Search skills\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A\u2026"],
  "skills.new": ["New skill", "\u0645\u0647\u0627\u0631\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "skills.import": ["Import skill folder", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0645\u062C\u0644\u062F \u0645\u0647\u0627\u0631\u0629"],
  "skills.imported": ["Skill imported", "\u0627\u0633\u062A\u064F\u0648\u0631\u062F\u062A \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.importFailed": [
    "Could not import \u2014 the folder must contain a SKILL.md file.",
    "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u2014 \u064A\u062C\u0628 \u0623\u0646 \u064A\u062D\u062A\u0648\u064A \u0627\u0644\u0645\u062C\u0644\u062F \u0639\u0644\u0649 \u0645\u0644\u0641 SKILL.md."
  ],
  "skills.fork": ["Copy to edit", "\u0627\u0646\u0633\u062E \u0644\u0644\u062A\u0639\u062F\u064A\u0644"],
  "skills.forked": ["Copied to your global library for editing", "\u0646\u064F\u0633\u062E\u062A \u0625\u0644\u0649 \u0645\u0643\u062A\u0628\u062A\u0643 \u0627\u0644\u0639\u0627\u0644\u0645\u064A\u0629 \u0644\u0644\u062A\u0639\u062F\u064A\u0644"],
  "skills.delete": ["Delete", "\u062D\u0630\u0641"],
  "skills.deleted": ["Skill deleted", "\u062D\u064F\u0630\u0641\u062A \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.deleteFailed": ["Could not delete this skill.", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0645\u0647\u0627\u0631\u0629."],
  "skills.save": ["Save skill", "\u062D\u0641\u0638 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.saved": ["Skill saved", "\u062D\u064F\u0641\u0638\u062A \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.namePh": ["Skill name \u2014 e.g. Deploy checklist", "\u0627\u0633\u0645 \u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u2014 \u0645\u062B\u0627\u0644: \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0646\u0634\u0631"],
  "skills.descPh": ["One-line description used for matching", "\u0648\u0635\u0641 \u0645\u0646 \u0633\u0637\u0631 \u0648\u0627\u062D\u062F \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0644\u0644\u0645\u0637\u0627\u0628\u0642\u0629"],
  "skills.bodyPh": [
    "Markdown instructions the agent follows when the skill is used\u2026",
    "\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0645\u0627\u0631\u0643\u062F\u0627\u0648\u0646 \u064A\u062A\u0628\u0639\u0647\u0627 \u0627\u0644\u0648\u0643\u064A\u0644 \u0639\u0646\u062F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0647\u0627\u0631\u0629\u2026"
  ],
  "skills.scope.workspace": ["This workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "skills.scope.global": ["All projects (global)", "\u0643\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 (\u0639\u0627\u0644\u0645\u064A)"],
  "skills.scope.builtin": ["Built-in library", "\u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629"],
  "skills.empty": [
    'No skills match. Create one, or ask the agent: "save this procedure as a skill".',
    '\u0644\u0627 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629. \u0623\u0646\u0634\u0626 \u0648\u0627\u062D\u062F\u0629\u060C \u0623\u0648 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644: "\u0627\u062D\u0641\u0638 \u0647\u0630\u0647 \u0627\u0644\u0637\u0631\u064A\u0642\u0629 \u0643\u0645\u0647\u0627\u0631\u0629".'
  ],
  "skills.hint": [
    "Skills are plain markdown folders on disk. The agent loads them with use_skill and can save new ones with create_skill.",
    "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u062C\u0644\u062F\u0627\u062A \u0645\u0627\u0631\u0643\u062F\u0627\u0648\u0646 \u0628\u0633\u064A\u0637\u0629 \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635. \u064A\u062D\u0645\u0651\u0644\u0647\u0627 \u0627\u0644\u0648\u0643\u064A\u0644 \u0628\u0640 use_skill \u0648\u064A\u0633\u062A\u0637\u064A\u0639 \u062D\u0641\u0638 \u0645\u0647\u0627\u0631\u0627\u062A \u062C\u062F\u064A\u062F\u0629 \u0628\u0640 create_skill."
  ],
  "skills.notFound": ["Skill not found.", "\u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629."],
  "skills.back": ["Back", "\u0631\u062C\u0648\u0639"],
  "rail.artifacts": ["Proof Center", "\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "artifacts.subtitle": [
    "Every claim below is extracted from this session transcript.",
    "\u0643\u0644 \u0628\u0646\u062F \u0623\u062F\u0646\u0627\u0647 \u0645\u0633\u062A\u062E\u0631\u062C \u0645\u0646 \u0633\u062C\u0644 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A."
  ],
  "artifacts.nothingYet": [
    "No proof yet \u2014 ask the agent to build something.",
    "\u0644\u0627 \u0623\u062F\u0644\u0629 \u0628\u0639\u062F \u2014 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644 \u0623\u0646 \u064A\u0628\u0646\u064A \u0634\u064A\u0626\u0627\u064B."
  ],
  "artifacts.edits": ["file edits", "\u062A\u0639\u062F\u064A\u0644 \u0645\u0644\u0641\u0627\u062A"],
  "artifacts.commands": ["commands", "\u0623\u0648\u0627\u0645\u0631"],
  "artifacts.docs": ["documents", "\u0645\u0633\u062A\u0646\u062F\u0627\u062A"],
  "artifacts.shots": ["screenshots", "\u0644\u0642\u0637\u0627\u062A \u062A\u062D\u0642\u0642"],
  "artifacts.checklist": ["Task checklist", "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0645\u0647\u0627\u0645"],
  "artifacts.files": ["Files touched", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0639\u062F\u064E\u0651\u0644\u0629"],
  "artifacts.walkthrough": ["Final walkthrough", "\u062C\u0648\u0644\u0629 \u0627\u0644\u062E\u062A\u0627\u0645"],
  "artifacts.export": ["Export shareable proof page (HTML)", "\u062A\u0635\u062F\u064A\u0631 \u0635\u0641\u062D\u0629 \u0623\u062F\u0644\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629 (HTML)"],
  "artifacts.exported": ["Proof page saved", "\u062D\u064F\u0641\u0638\u062A \u0635\u0641\u062D\u0629 \u0627\u0644\u0623\u062F\u0644\u0629"],
  "artifacts.needWs": [
    "Open a workspace first \u2014 the proof page is saved into it.",
    "\u0627\u0641\u062A\u062D \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0623\u0648\u0644\u0627\u064B \u2014 \u062A\u064F\u062D\u0641\u0638 \u0635\u0641\u062D\u0629 \u0627\u0644\u0623\u062F\u0644\u0629 \u062F\u0627\u062E\u0644\u0647\u0627."
  ],
  "settings.nav.memory": ["Skills & Memory", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0630\u0627\u0643\u0631\u0629"],
  "sm.skills.title": ["Skills library", "\u0645\u0643\u062A\u0628\u0629 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  "sm.skills.manage": ["Manage skills", "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  "sm.skills.manageHint": [
    "Browse, create, import and fork skills \u2014 workspace, global and built-in scopes.",
    "\u062A\u0635\u0641\u062D \u0648\u0623\u0646\u0634\u0626 \u0648\u0627\u0633\u062A\u0648\u0631\u062F \u0648\u0627\u0646\u0633\u062E \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u2014 \u0646\u0637\u0627\u0642\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u0639\u0627\u0644\u0645\u064A \u0648\u0627\u0644\u0645\u062F\u0645\u062C."
  ],
  "sm.skills.open": ["Open", "\u0641\u062A\u062D"],
  "sm.skills.trust": ["Trust this workspace's skills", "\u0627\u0644\u062B\u0642\u0629 \u0628\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "sm.skills.trustDesc": [
    "Workspace skills are instructions from the project folder \u2014 review them, then enable.",
    "\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0645\u0646 \u0645\u062C\u0644\u062F \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u2014 \u0631\u0627\u062C\u0639\u0647\u0627 \u062B\u0645 \u0641\u0639\u0651\u0644\u0647\u0627."
  ],
  "sm.skills.trustBtn": ["Trust", "\u0645\u0646\u062D \u0627\u0644\u062B\u0642\u0629"],
  "sm.skills.note": [
    "Skills you give the agent are loaded BEFORE work with use_skill and followed, never ignored. New ones can be saved with create_skill. Skills are plain markdown folders on disk \u2014 yours to edit and share.",
    "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u0639\u0637\u064A\u0647\u0627 \u0644\u0644\u0648\u0643\u064A\u0644 \u062A\u064F\u062D\u0645\u0651\u0644 \u0642\u0628\u0644 \u0627\u0644\u0639\u0645\u0644 \u0628\u0640 use_skill \u0648\u064A\u064F\u0644\u062A\u0632\u0645 \u0628\u0647\u0627 \u0648\u0644\u0627 \u062A\u062A\u062C\u0627\u0647\u0644. \u064A\u0645\u0643\u0646 \u062D\u0641\u0638 \u0645\u0647\u0627\u0631\u0627\u062A \u062C\u062F\u064A\u062F\u0629 \u0628\u0640 create_skill. \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u062C\u0644\u062F\u0627\u062A \u0645\u0627\u0631\u0643\u062F\u0627\u0648\u0646 \u0628\u0633\u064A\u0637\u0629 \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635 \u2014 \u0644\u0643 \u062A\u0639\u062F\u064A\u0644\u0647\u0627 \u0648\u0645\u0634\u0627\u0631\u0643\u062A\u0647\u0627."
  ],
  // v11.36 — per-skill More-actions menu.
  "skills.more": ["More actions", "\u0645\u0632\u064A\u062F \u0645\u0646 \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A"],
  "skills.action.inspect": ["Inspect skill", "\u0641\u062D\u0635 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.action.edit": ["Edit skill", "\u062A\u062D\u0631\u064A\u0631 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.action.duplicate": ["Duplicate skill", "\u0646\u0633\u062E \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.duplicated": ["Skill duplicated", "\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.duplicateFailed": ["Could not read this skill to duplicate it.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u0644\u0646\u0633\u062E\u0647\u0627."],
  "skills.name": ["Skill name", "\u0627\u0633\u0645 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  // v11.36 — child session (jلسة جوا الجلسة), library, flows, usage, wiki, schedule.
  "sad.parentSession": ["MAIN SESSION", "\u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629"],
  "sad.childSession": ["CHILD SESSION", "\u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0641\u0631\u0639\u064A\u0629"],
  "sad.toolCalls": ["TOOL CALLS", "\u0627\u0633\u062A\u062F\u0639\u064A\u0627\u062A \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "sad.noToolCalls": ["(no tool calls recorded)", "(\u0644\u0645 \u064A\u064F\u0633\u062C\u0651\u064E\u0644 \u0623\u064A \u0627\u0633\u062A\u062F\u0639\u0627\u0621 \u0623\u062F\u0627\u0629)"],
  "flows.ranNotRecorded": ["Run finished but could not be recorded", "\u0627\u0646\u062A\u0647\u0649 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u062A\u0639\u0630\u0651\u0631 \u062A\u0633\u062C\u064A\u0644\u0647 \u0641\u064A \u0645\u062E\u0632\u0646 \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A"],
  "lib.noMatch": ["No matching items", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0646\u0627\u0635\u0631 \u0645\u0637\u0627\u0628\u0642\u0629"],
  "lib.filter.clear": ["Clear filter", "\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062A\u0635\u0641\u064A\u0629"],
  "wiki.source.docs": ["from repo docs", "\u0645\u0646 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639"],
  "wiki.source.docs.title": ["Read from this repo's real Markdown files", "\u0645\u0642\u0631\u0648\u0621 \u0645\u0646 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629"],
  "usage.provenance": ["Pricing & token provenance", "\u0645\u0635\u062F\u0631 \u0627\u0644\u0623\u0633\u0639\u0627\u0631 \u0648\u0627\u0644\u062A\u0648\u0643\u0646"],
  "usage.provSource": ["Price source", "\u0645\u0635\u062F\u0631 \u0627\u0644\u0633\u0639\u0631"],
  "usage.provModel": ["Active model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637"],
  "usage.provId": ["Exact catalog row that supplied the price", "\u0635\u0641 \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C \u0627\u0644\u062F\u0642\u064A\u0642 \u0627\u0644\u0630\u064A \u0648\u0641\u0651\u0631 \u0627\u0644\u0633\u0639\u0631"],
  "usage.provMatch": ["How the model id matched the catalog", "\u0643\u064A\u0641 \u0637\u0627\u0628\u0642 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C"],
  "usage.provTokens": ["Token counts are provider-exact unless marked \u2248", "\u0639\u062F\u062F \u0627\u0644\u062A\u0648\u0643\u0646 \u062F\u0642\u064A\u0642 \u0645\u0646 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0625\u0644\u0627 \u0625\u0630\u0627 \u0648\u064F\u0633\u0645 \u0628\u0640 \u2248"],
  "usage.provUnknown": ["This model has no catalog price in either source \u2014 costs are shown as unknown, never invented.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0633\u0639\u0631 \u0644\u0647\u0630\u0627 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0641\u064A \u0623\u064A \u0645\u0635\u062F\u0631 \u2014 \u062A\u064F\u0639\u0631\u0636 \u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0643\u0645\u062C\u0647\u0648\u0644\u0629 \u0648\u0644\u0627 \u062A\u064F\u062E\u062A\u0644\u0642."],
  "usage.catalogCross": ["catalog cross-check", "\u062A\u062F\u0642\u064A\u0642 \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C"],
  "usage.logSource": ["source: this device's recorded usage log (UTC day)", "\u0627\u0644\u0645\u0635\u062F\u0631: \u0633\u062C\u0644 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0645\u0633\u062C\u0651\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 (\u064A\u0648\u0645 UTC)"],
  "sch.badCron": ["Cron is invalid \u2014 no next run can be computed", "\u0627\u0644\u062A\u0639\u0628\u064A\u0631 \u0627\u0644\u0632\u0645\u0646\u064A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u2014 \u0644\u0627 \u064A\u0645\u0643\u0646 \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u062A\u0627\u0644\u064A"],
  "sch.clock.live": ["CLOCK OBSERVED \u2014 a job fired since this page opened", "\u0627\u0644\u0633\u0627\u0639\u0629 \u0645\u0631\u0635\u0648\u062F\u0629 \u2014 \u0646\u064F\u0641\u0651\u0630\u062A \u0645\u0647\u0645\u0629 \u0645\u0646\u0630 \u0641\u062A\u062D \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629"],
  "sch.clock.off": ["SCHEDULER UNAVAILABLE \u2014 no bridge in this build", "\u0627\u0644\u0645\u062C\u062F\u0648\u0644 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u2014 \u0644\u0627 \u064A\u0648\u062C\u062F \u062C\u0633\u0631 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0628\u0646\u0627\u0621"],
  "sch.clock.unverified": ["CLOCK UNVERIFIED \u2014 no run observed yet; Run now / webhook are the direct triggers", "\u0627\u0644\u0633\u0627\u0639\u0629 \u063A\u064A\u0631 \u0645\u062A\u062D\u0642\u0651\u0642 \u0645\u0646\u0647\u0627 \u2014 \u0644\u0645 \u062A\u064F\u0631\u0635\u062F \u0645\u0647\u0645\u0629 \u0628\u0639\u062F\u061B \xAB\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0622\u0646\xBB / webbook \u0647\u0645\u0627 \u0627\u0644\u0645\u062D\u0641\u0651\u0632\u0627\u0646 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0627\u0646"],
  "sched.noWorkspaceRun": ["No workspace \u2014 run would report an honest error", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u2014 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0633\u064A\u0639\u0637\u064A \u062E\u0637\u0623\u064B \u0635\u0627\u062F\u0642\u0627\u064B"],
  // v11.37 — collected attach menu + effort slider on the chat.
  "chat.attach.menu": ["Add", "\u0625\u0636\u0627\u0641\u0629"],
  "chat.attach.document": ["Attach document", "\u0625\u0631\u0641\u0627\u0642 \u0645\u0633\u062A\u0646\u062F"],
  "chat.effort": ["Effort", "\u0627\u0644\u062C\u0647\u062F"],
  "chat.effort.standard": ["standard", "\u0642\u064A\u0627\u0633\u064A"],
  "chat.effort.deep": ["deep", "\u0639\u0645\u064A\u0642"],
  "chat.effort.hint": ["Deeper thinking \u2014 more steps and careful reasoning", "\u062A\u0641\u0643\u064A\u0631 \u0623\u0639\u0645\u0642 \u2014 \u062E\u0637\u0648\u0627\u062A \u0623\u0643\u062B\u0631 \u0648\u062A\u0641\u0643\u064A\u0631 \u0623\u062F\u0642"],
  // v11.38 — fleet handoffs (flows, git, prompts, schedule, plugins, skills, wiki).
  "flows.gate.session": ["No active session \u2014 start a chat before running a flow", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062C\u0644\u0633\u0629 \u0646\u0634\u0637\u0629 \u2014 \u0627\u0628\u062F\u0623 \u0645\u062D\u0627\u062F\u062B\u0629 \u0642\u0628\u0644 \u062A\u0634\u063A\u064A\u0644 \u0645\u0633\u0627\u0631"],
  "flows.gate.workspace": ["No workspace \u2014 open a project before running a flow", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u2014 \u0627\u0641\u062A\u062D \u0645\u0634\u0631\u0648\u0639\u0627\u064B \u0642\u0628\u0644 \u062A\u0634\u063A\u064A\u0644 \u0645\u0633\u0627\u0631"],
  "flows.replay.again": ["Replay this exact prompt", "\u0623\u0639\u062F \u062A\u0634\u063A\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u062D\u0631\u0641\u064A"],
  "flows.replay.done": ["Stored prompt replayed \u2014 run recorded", "\u0623\u064F\u0639\u064A\u062F \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u062D\u0641\u0648\u0638 \u2014 \u0633\u064F\u062C\u0651\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "flows.run.noTurn": ["The prompt was sent but no run started", "\u0623\u064F\u0631\u0633\u0644 \u0627\u0644\u0637\u0644\u0628 \u0644\u0643\u0646 \u0644\u0645 \u062A\u0628\u062F\u0623 \u062F\u0648\u0631\u0629 \u062A\u0634\u063A\u064A\u0644"],
  "flows.run.timeout": ["The run did not settle in time", "\u0644\u0645 \u062A\u0646\u062A\u0647\u0650 \u0627\u0644\u062F\u0648\u0631\u0629 \u0641\u064A \u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0645\u062D\u062F\u062F"],
  "git.branchCreate": ["Create", "\u0625\u0646\u0634\u0627\u0621"],
  "git.branchCreated": ["Branch created", "\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0641\u0631\u0639"],
  "git.branchCurrent": ["Current branch", "\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062D\u0627\u0644\u064A"],
  "git.branchNew": ["New branch name", "\u0627\u0633\u0645 \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062C\u062F\u064A\u062F"],
  "git.branchSwitch": ["Switch to branch", "\u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0627\u0644\u0641\u0631\u0639"],
  "git.branchSwitchConfirm": ["You have uncommitted changes. Switch branch anyway?", "\u0644\u062F\u064A\u0643 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u062D\u0641\u0648\u0638\u0629. \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0639\u0644\u0649 \u0623\u064A \u062D\u0627\u0644\u061F"],
  "git.branchSwitchOnCreate": ["Also switch to the new branch after creating it", "\u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062C\u062F\u064A\u062F \u0628\u0639\u062F \u0625\u0646\u0634\u0627\u0626\u0647 \u0623\u064A\u0636\u0627\u064B"],
  "git.branchSwitched": ["Switched to branch", "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0627\u0644\u0641\u0631\u0639"],
  "git.branches": ["Branches", "\u0627\u0644\u0641\u0631\u0648\u0639"],
  "git.branchesEmpty": ["No branches yet \u2014 make your first commit.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0641\u0631\u0648\u0639 \u0628\u0639\u062F \u2014 \u0623\u0646\u0634\u0626 \u0623\u0648\u0644 \u0627\u0644\u062A\u0632\u0627\u0645."],
  "git.conflict.detail": ["{n} unmerged file(s). Open each one, fix the conflict markers, then stage it.", "{n} \u0645\u0644\u0641\u0627\u062A \u063A\u064A\u0631 \u0645\u062F\u0645\u062C\u0629. \u0627\u0641\u062A\u062D \u0643\u0644 \u0645\u0646\u0647\u0627\u060C \u0623\u0635\u0644\u062D \u0639\u0644\u0627\u0645\u0627\u062A \u0627\u0644\u062A\u0639\u0627\u0631\u0636\u060C \u062B\u0645 \u0623\u0636\u0641\u0647\u0627."],
  "git.conflict.title": ["Merge conflict \u2014 resolve before committing", "\u062A\u0639\u0627\u0631\u0636 \u062F\u0645\u062C \u2014 \u062D\u0644\u0651\u0647 \u0642\u0628\u0644 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645"],
  "git.detached": ["Detached HEAD \u2014 you are not on a branch", "HEAD \u0645\u0646\u0641\u0635\u0644 \u2014 \u0623\u0646\u062A \u0644\u0633\u062A \u0639\u0644\u0649 \u0641\u0631\u0639"],
  "git.detachedShort": ["detached", "\u0645\u0646\u0641\u0635\u0644"],
  "git.identityMissing": ['No git identity is configured \u2014 the first commit will use a local "Surnia" identity. Set user.name/user.email to use your own.', "\u0644\u0627 \u0647\u0648\u064A\u0629 git \u0645\u0636\u0628\u0648\u0637\u0629 \u2014 \u0623\u0648\u0644 \u0627\u0644\u062A\u0632\u0627\u0645 \u0633\u064A\u0633\u062A\u062E\u062F\u0645 \u0647\u0648\u064A\u0629 \u0645\u062D\u0644\u064A\u0629. \u0627\u0636\u0628\u0637 user.name/user.email \u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0647\u0648\u064A\u062A\u0643."],
  "prompts.firstHint": ["Give the agent a saved prompt to follow", "\u0623\u0639\u0637\u0650 \u0627\u0644\u0648\u0643\u064A\u0644 \u0645 prompted \u0645\u062D\u0641\u0648\u0638\u0627\u064B \u0644\u064A\u062A\u0628\u0639\u0647"],
  "prompts.useWithAI": ["Use with AI (followed instruction)", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0639 \u0627\u0644\u0630\u0643\u0627\u0621 (\u062A\u0648\u062C\u064A\u0647 \u0645\u0644\u0632\u0645)"],
  "prompts.useWithAI.done": ["Inserted as an AI-followed instruction", "\u0623\u064F\u062F\u0631\u062C \u0643\u062A\u0648\u062C\u064A\u0647 \u064A\u062A\u0628\u0639\u0647 \u0627\u0644\u0630\u0643\u0627\u0621"],
  "sch.clock.liveEvt": ["CLOCK OBSERVED \u2014 last real fire {0} ({1})", "\u0627\u0644\u0633\u0627\u0639\u0629 \u0645\u0631\u0635\u0648\u062F\u0629 \u2014 \u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644 \u062D\u0642\u064A\u0642\u064A {0} ({1})"],
  "sch.webhook.down": ["LISTENER DOWN", "\u0627\u0644\u0645\u0633\u062A\u0645\u0639 \u0645\u062A\u0648\u0642\u0641"],
  "sched.cancel": ["Cancel this run", "\u0625\u0644\u063A\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "settings.plugins.active": ["Active contributions", "\u0627\u0644\u0645\u0633\u0627\u0647\u0645\u0627\u062A \u0627\u0644\u0646\u0634\u0637\u0629"],
  "settings.plugins.refresh": ["Refresh plugin state", "\u062A\u062D\u062F\u064A\u062B \u062D\u0627\u0644\u0629 \u0627\u0644\u0628\u0644\u0648\u062C\u064A\u0646\u0632"],
  "skills.useShort": ["USE", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  "skills.useWithAI": ["Use with AI \u2014 queue use_skill for this skill", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0639 \u0627\u0644\u0630\u0643\u0627\u0621 \u2014 \u062C\u062F\u0651\u0631 use_skill \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0647\u0627\u0631\u0629"],
  "skills.useWithAI.queued": ["Skill queued \u2014 type your task and send. The agent loads it first.", "\u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u0645\u064F\u062F\u0631\u062C\u0629 \u2014 \u0627\u0643\u062A\u0628 \u0645\u0647\u0645\u062A\u0643 \u0648\u0623\u0631\u0633\u0644\u0647\u0627. \u0627\u0644\u0648\u0643\u064A\u0644 \u064A\u062D\u0645\u0651\u0644\u0647\u0627 \u0623\u0648\u0644\u0627\u064B."],
  "wiki.source.generated": ["AI-generated", "\u0645\u0648\u0644\u0651\u062F\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A"],
  "wiki.source.generated.title": ["Written by the model from this repo's real files", "\u0645\u0648\u0644\u0651\u062F\u0629 \u0628\u0645\u0633\u0627\u0639\u062F\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0645\u0646 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639"],
  "sm.memory.title": ["Memory", "\u0627\u0644\u0630\u0627\u0643\u0631\u0629"],
  "sm.memory.auto": ["Auto-learning", "\u0627\u0644\u062A\u0639\u0644\u0645 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A"],
  "sm.memory.autoHint": [
    "After each run, distill durable project facts into MEMORY.md and user patterns into DNA.",
    "\u0628\u0639\u062F \u0643\u0644 \u062A\u0634\u063A\u064A\u0644\u060C \u062A\u064F\u0633\u062A\u062E\u0644\u0635 \u062D\u0642\u0627\u0626\u0642 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u062F\u0627\u0626\u0645\u0629 \u0625\u0644\u0649 MEMORY.md \u0648\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 \u0625\u0644\u0649 DNA."
  ],
  "sm.memory.global": ["Global memory", "\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0639\u0627\u0644\u0645\u064A\u0629"],
  "sm.memory.globalDesc": [
    "Text injected into every agent run, in every project.",
    "\u0646\u0635 \u064A\u064F\u062D\u0642\u0646 \u0641\u064A \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u0644\u0644\u0648\u0643\u064A\u0644 \u0648\u0641\u064A \u0643\u0644 \u0645\u0634\u0631\u0648\u0639."
  ]
};
Object.assign(D, D_V5);
var D_V24 = {
  // rail + panel
  "rail.flows": ["Flows", "\u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A"],
  "flows.title": ["Flows", "\u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A \u0627\u0644\u0630\u0643\u064A\u0629"],
  "flows.desc": [
    "Your repeated requests, one click away. SADEEM notices what you ask for again and again and turns it into a one-click flow.",
    "\u0637\u0644\u0628\u0627\u062A\u0643 \u0627\u0644\u0645\u062A\u0643\u0631\u0631\u0629 \u0639\u0644\u0649 \u0628\u064F\u0639\u062F \u0646\u0642\u0631\u0629 \u0648\u0627\u062D\u062F\u0629. \u062A\u0644\u0627\u062D\u0638 \u0633\u062F\u064A\u0645 \u0645\u0627 \u062A\u0637\u0644\u0628\u0647 \u0645\u0631\u0627\u0631\u0627\u064B \u0648\u062A\u062D\u0648\u0651\u0644\u0647 \u0625\u0644\u0649 \u0645\u0633\u0627\u0631 \u064A\u0646\u0641\u064E\u0651\u0630 \u0628\u0636\u063A\u0637\u0629."
  ],
  "flows.empty.title": ["No flows yet", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0633\u0627\u0631\u0627\u062A \u0628\u0639\u062F"],
  "flows.empty.body": [
    "Repeat a request 3 times (or save one manually) and it becomes a one-click flow.",
    "\u0643\u0631\u0651\u0631 \u0623\u064A \u0637\u0644\u0628 3 \u0645\u0631\u0627\u062A (\u0623\u0648 \u0627\u062D\u0641\u0638\u0647 \u064A\u062F\u0648\u064A\u0627\u064B) \u0648\u064A\u062A\u062D\u0648\u0644 \u0625\u0644\u0649 \u0645\u0633\u0627\u0631 \u064A\u064F\u0646\u0641\u064E\u0651\u0630 \u0628\u0636\u063A\u0637\u0629 \u0648\u0627\u062D\u062F\u0629."
  ],
  "flows.new": ["New flow", "\u0645\u0633\u0627\u0631 \u062C\u062F\u064A\u062F"],
  "flows.run": ["Run", "\u062A\u0634\u063A\u064A\u0644"],
  "flows.edit": ["Edit", "\u062A\u0639\u062F\u064A\u0644"],
  "flows.delete": ["Delete", "\u062D\u0630\u0641"],
  "flows.confirmDelete": ["Delete this flow?", "\u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u0627\u0631\u061F"],
  "flows.name": ["Name", "\u0627\u0644\u0627\u0633\u0645"],
  "flows.namePh": ["e.g. Daily deploy check", "\u0645\u062B\u0627\u0644: \u0641\u062D\u0635 \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u064A\u0648\u0645\u064A"],
  "flows.prompt": ["Prompt", "\u0627\u0644\u0637\u0644\u0628"],
  "flows.promptPh": ["What should SADEEM do when this flow runs?", "\u0645\u0627\u0630\u0627 \u062A\u0641\u0639\u0644 \u0633\u062F\u064A\u0645 \u0639\u0646\u062F \u062A\u0634\u063A\u064A\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0633\u0627\u0631\u061F"],
  "flows.save": ["Save flow", "\u062D\u0641\u0638 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.cancel": ["Cancel", "\u0625\u0644\u063A\u0627\u0621"],
  "flows.scope": ["Scope", "\u0627\u0644\u0646\u0637\u0627\u0642"],
  "flows.scope.global": ["All projects", "\u0643\u0644 \u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639"],
  "flows.scope.workspace": ["This project only", "\u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0641\u0642\u0637"],
  "flows.runs": ["runs", "\u062A\u0634\u063A\u064A\u0644"],
  "flows.lastRun": ["Last run", "\u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644"],
  "flows.never": ["never", "\u0623\u0628\u062F\u0627\u064B"],
  "flows.suggest.title": ["Turn this into a flow?", "\u062A\u062D\u0648\u064A\u0644 \u0647\u0630\u0627 \u0625\u0644\u0649 \u0645\u0633\u0627\u0631\u061F"],
  "flows.suggest.body": [
    "You have asked for this several times. Save it as a one-click flow?",
    "\u0637\u0644\u0628\u062A \u0647\u0630\u0627 \u0639\u062F\u0629 \u0645\u0631\u0627\u062A. \u062D\u0641\u0638\u0647 \u0643\u0645\u0633\u0627\u0631 \u0628\u0636\u063A\u0637\u0629 \u0648\u0627\u062D\u062F\u0629\u061F"
  ],
  "flows.suggest.save": ["Save as flow", "\u062D\u0641\u0638 \u0643\u0645\u0633\u0627\u0631"],
  "flows.suggest.later": ["Not now", "\u0644\u064A\u0633 \u0627\u0644\u0622\u0646"],
  "flows.saved": ["Flow saved \u2014 run it from the Flows panel or the command palette", "\u062D\u064F\u0641\u0638 \u0627\u0644\u0645\u0633\u0627\u0631 \u2014 \u0634\u063A\u0651\u0644\u0647 \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A \u0623\u0648 \u0645\u0646 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "flows.updated": ["Flow updated", "\u062D\u062F\u064F\u062B \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.deleted": ["Flow deleted", "\u062D\u064F\u0630\u0641 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.ranToast": ["Flow started", "\u0628\u062F\u0623 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.duplicate": ["A flow with this name already exists", "\u064A\u0648\u062C\u062F \u0645\u0633\u0627\u0631 \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u0628\u0627\u0644\u0641\u0639\u0644"],
  "palette.flows": ["Open Flows", "\u0627\u0641\u062A\u062D \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A"],
  "slash.flows.desc": ["Manage one-click flows", "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A \u0641\u0648\u0631\u064A\u0629 \u0627\u0644\u062A\u0646\u0641\u064A\u0630"],
  // git AI generation
  "git.aiCommit": ["AI commit message", "\u0631\u0633\u0627\u0644\u0629 commit \u0628\u0627\u0644\u0630\u0643\u0627\u0621"],
  "git.aiPR": ["AI PR description", "\u0648\u0635\u0641 PR \u0628\u0627\u0644\u0630\u0643\u0627\u0621"],
  "git.aiWorking": ["Writing\u2026", "\u064A\u0643\u062A\u0628\u2026"],
  "git.aiFailed": ["Could not generate \u2014 is a model configured?", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0648\u0644\u064A\u062F \u2014 \u0647\u0644 \u0627\u0644\u0645\u0648\u0632\u0651\u0639 \u0645\u0636\u0628\u0648\u0637\u061F"],
  "git.aiInsert": ["Insert", "\u0625\u062F\u0631\u0627\u062C"],
  // free season billing
  "billing.free.badge": ["FREE SEASON", "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0645\u062C\u0627\u0646\u064A"],
  "billing.free.banner": [
    "Everything is unlocked \u2014 no limits, no paywall. Invite friends:",
    "\u0643\u0644 \u0634\u064A\u0621 \u0645\u0641\u062A\u0648\u062D \u2014 \u0628\u0644\u0627 \u062D\u062F\u0648\u062F \u0648\u0628\u0644\u0627 \u062C\u062F\u0627\u0631 \u062F\u0641\u0639. \u0634\u0627\u0631\u0643 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0645\u0639 \u0623\u0635\u062F\u0642\u0627\u0626\u0643:"
  ],
  "billing.plan.paused": ["currently paused", "\u0645\u062A\u0648\u0642\u0641\u0629 \u0645\u0624\u0642\u062A\u0627\u064B"],
  // v11.10 (A8) — honest Pro CTA while checkout is paused (two tiers: Free + Pro)
  "plans.pro.soon": ["Contact us \u2014 checkout coming soon", "\u062A\u0648\u0627\u0635\u0644 \u0645\u0639\u0646\u0627 \u2014 \u0627\u0644\u062F\u0641\u0639 \u0642\u0631\u064A\u0628\u0627\u064B"],
  "billing.paused.note": [
    "Paid plans are paused while the payment gateway is upgraded. The entire app is FREE meanwhile \u2014 every capability, unlimited runs.",
    "\u0627\u0644\u062E\u0637\u0637 \u0627\u0644\u0645\u062F\u0641\u0648\u0639\u0629 \u0645\u062A\u0648\u0642\u0641\u0629 \u0645\u0624\u0642\u062A\u0627\u064B \u0623\u062B\u0646\u0627\u0621 \u062A\u0637\u0648\u064A\u0631 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u062F\u0641\u0639. \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0643\u0644\u0647 \u0645\u062C\u0627\u0646\u064A \u062D\u0627\u0644\u064A\u0627\u064B \u2014 \u0643\u0644 \u0627\u0644\u0642\u062F\u0631\u0627\u062A\u060C \u0628\u0644\u0627 \u062D\u062F\u0648\u062F."
  ],
  "billing.share.copy": ["Copy download link", "\u0627\u0646\u0633\u062E \u0631\u0627\u0628\u0637 \u0627\u0644\u062A\u062D\u0645\u064A\u0644"],
  "billing.share.copied": ["Link copied", "\u0646\u064F\u0633\u062E \u0627\u0644\u0631\u0627\u0628\u0637"],
  // slash additions
  "slash.pr.desc": ["Draft a PR description from your changes", "\u0635\u064A\u0627\u063A\u0629 \u0648\u0635\u0641 PR \u0645\u0646 \u062A\u063A\u064A\u064A\u0631\u0627\u062A\u0643"],
  "slash.changelog.desc": ["Release notes from recent commits", "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0625\u0635\u062F\u0627\u0631 \u0645\u0646 \u0622\u062E\u0631 \u0639\u0645\u0644\u064A\u0627\u062A \u0627\u0644\u0625\u064A\u062F\u0627\u0639"],
  "slash.tests.desc": ["Generate tests for a file", "\u062A\u0648\u0644\u064A\u062F \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0645\u0644\u0641"],
  // sidebar
  "sidebar.resizeHint": ["Drag to resize", "\u0627\u0633\u062D\u0628 \u0644\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0639\u0631\u0636"],
  // appearance v2.4
  "set.appear.specular": ["Specular glass edges", "\u062D\u0648\u0627\u0641 \u0632\u062C\u0627\u062C\u064A\u0629 \u0639\u0627\u0643\u0633\u0629"],
  "set.appear.specularHint": [
    "Light-catching highlights on chrome edges (Liquid Glass v7)",
    "\u0644\u0645\u0639\u0627\u062A \u062A\u0644\u062A\u0642\u0637 \u0627\u0644\u0636\u0648\u0621 \u0639\u0644\u0649 \u062D\u0627\u0641\u0632 \u0627\u0644\u0648\u0627\u062C\u0647\u0629 (\u0627\u0644\u0632\u062C\u0627\u062C \u0627\u0644\u0633\u0627\u0626\u0644 v7)"
  ],
  "set.appear.font": ["App font", "\u062E\u0637 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "set.appear.fontHint": [
    "Inter is the identity font; Cairo covers Arabic text.",
    "Inter \u0647\u0648 \u062E\u0637 \u0627\u0644\u0647\u0648\u064A\u0629\u060C \u0648Cairo \u064A\u063A\u0637\u064A \u0627\u0644\u0646\u0635 \u0627\u0644\u0639\u0631\u0628\u064A."
  ],
  // rules / policy info
  "set.agent.rulesInfo": [
    "Project rules: put .md files in .surnia/rules/ (or AGENTS.md / CLAUDE.md at the repo root) and they are loaded into every run automatically.",
    "\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0645\u0634\u0631\u0648\u0639: \u0636\u0639 \u0645\u0644\u0641\u0627\u062A .md \u0641\u064A \u200E.surnia/rules/\u200E (\u0623\u0648 AGENTS.md / CLAUDE.md \u0628\u062C\u0630\u0631 \u0627\u0644\u0645\u0634\u0631\u0648\u0639) \u0648\u062A\u064F\u062D\u0645\u064E\u0651\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0641\u064A \u0643\u0644 \u062A\u0634\u063A\u064A\u0644."
  ]
};
Object.assign(D, D_V24);
var D_V26_RUNSTATE = {
  "chat.run.secs": ["{s}s", "{s} \u062B"]
};
Object.assign(D, D_V26_RUNSTATE);
var D_V31_POLISH = {
  "chat.ask.title": ["Agent question", "\u0633\u0624\u0627\u0644 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "chat.ask.placeholder": ["Type your answer\u2026", "\u0627\u0643\u062A\u0628 \u0625\u062C\u0627\u0628\u062A\u0643\u2026"],
  "chat.ask.send": ["Send", "\u0625\u0631\u0633\u0627\u0644"],
  "chat.loadEarlier": ["Load earlier messages", "\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0627\u0644\u0623\u0642\u062F\u0645"],
  "chat.sr.replyDone": ["Assistant reply finished", "\u0627\u0646\u062A\u0647\u062A \u0625\u062C\u0627\u0628\u0629 \u0627\u0644\u0645\u0633\u0627\u0639\u062F"],
  "git.terminalHint": ["Ctrl+` opens the terminal", "\u200FCtrl+` \u064A\u0641\u062A\u062D \u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "mcp.copy": ["Copy", "\u0646\u0633\u062E"],
  "mcp.copied": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "mcp.cwdPlaceholder": ["Working directory (cwd) \u2014 optional, ${workspace} = current workspace", "\u0645\u062C\u0644\u062F \u0627\u0644\u0639\u0645\u0644 (cwd) \u2014 \u0627\u062E\u062A\u064A\u0627\u0631\u064A\u060C ${workspace} = \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u062D\u0627\u0644\u064A\u0629"],
  "mcp.promptGet": ["Get prompt", "\u062C\u0644\u0628 \u0627\u0644\u0642\u0627\u0644\u0628"],
  "mcp.promptArgsHint": ["key=value arguments, one per line", "\u0648\u0633\u0627\u0626\u0637 key=value\u060C \u0648\u0627\u062D\u062F\u0629 \u0641\u064A \u0643\u0644 \u0633\u0637\u0631"],
  "mcp.stderr": ["Server stderr (last 8 KB)", "\u0645\u062E\u0631\u062C\u0627\u062A \u0627\u0644\u062E\u0637\u0623 (\u0622\u062E\u0631 \u0668 \u0643\u064A\u0644\u0648\u0628\u0627\u064A\u062A)"],
  "mcp.stderrEmpty": ["No stderr output", "\u0644\u0627 \u0645\u062E\u0631\u062C\u0627\u062A \u062E\u0637\u0623"],
  "preview.agent": ["Agent", "\u0627\u0644\u0648\u0643\u064A\u0644"],
  "preview.agentServer": ["Agent server", "\u062E\u0627\u062F\u0645 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "preview.openFile": ["Open artifact", "\u0641\u062A\u062D \u0645\u062E\u0631\u064E\u062C"],
  "preview.blank.title": ["Page looks blank", "\u062A\u0628\u062F\u0648 \u0627\u0644\u0635\u0641\u062D\u0629 \u0641\u0627\u0631\u063A\u0629"],
  "preview.diag.build": ["Project not built yet \u2014 run the build, then refresh", "\u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u063A\u064A\u0631 \u0645\u0628\u0646\u064A\u0651 \u0628\u0639\u062F \u2014 \u0634\u063A\u0651\u0644 \u0627\u0644\u0628\u0646\u0627\u0621 \u062B\u0645 \u062D\u062F\u0651\u062B"],
  "preview.diag.server": ["This page needs a dev server \u2014 use Run dev", "\u062A\u062D\u062A\u0627\u062C \u0627\u0644\u0635\u0641\u062D\u0629 \u062E\u0627\u062F\u0645 \u062A\u0637\u0648\u064A\u0631 \u2014 \u0627\u0633\u062A\u062E\u062F\u0645 \xAB\u0634\u063A\u0651\u0644 \u062E\u0627\u062F\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631\xBB"],
  "preview.diag.starting": ["Dev server still starting \u2014 wait a moment, then refresh", "\u062E\u0627\u062F\u0645 \u0627\u0644\u062A\u0637\u0648\u064A\u0631 \u0644\u0627 \u064A\u0632\u0627\u0644 \u064A\u0628\u062F\u0623 \u2014 \u0627\u0646\u062A\u0638\u0631 \u0644\u062D\u0638\u0629 \u062B\u0645 \u062D\u062F\u0651\u062B"]
};
Object.assign(D, D_V31_POLISH);
var D_V6_APEX = {
  // rail + wiki panel
  "rail.wiki": ["Repo Wiki", "\u0648\u064A\u0643\u064A \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639"],
  "wiki.needWs": ["Open a folder first \u2014 the wiki describes THIS workspace.", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B \u2014 \u0627\u0644\u0648\u064A\u0643\u064A \u062A\u0635\u0641 \u0647\u0630\u0647 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644."],
  "wiki.empty": [
    "No wiki yet for this workspace. Generate one \u2014 a catalog of pages that explains the architecture from your real files.",
    "\u0644\u0627 \u062A\u0648\u062C\u062F \u0648\u064A\u0643\u064A \u0644\u0647\u0630\u0647 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0628\u0639\u062F. \u0648\u0644\u0651\u062F\u0647\u0627 \u0627\u0644\u0622\u0646 \u2014 \u0641\u0647\u0631\u0633 \u0635\u0641\u062D\u0627\u062A \u064A\u0634\u0631\u062D \u0627\u0644\u0628\u0646\u064A\u0629 \u0645\u0646 \u0645\u0644\u0641\u0627\u062A\u0643 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629."
  ],
  "wiki.generate": ["Generate the wiki", "\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0648\u064A\u0643\u064A"],
  "wiki.regenerate": ["Regenerate", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0648\u0644\u064A\u062F"],
  "wiki.stale": ["CODE CHANGED", "\u062A\u063A\u064A\u0651\u0631 \u0627\u0644\u0643\u0648\u062F"],
  "wiki.staleTitle": ["Code changed since this wiki was generated", "\u062A\u063A\u064A\u0651\u0631 \u0627\u0644\u0643\u0648\u062F \u0645\u0646\u0630 \u0622\u062E\u0631 \u062A\u0648\u0644\u064A\u062F \u0644\u0644\u0648\u064A\u0643\u064A"],
  "wiki.stage.scan": ["Analyzing the codebase\u2026", "\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0643\u0648\u062F\u2026"],
  "wiki.stage.catalog": ["Designing the catalog\u2026", "\u062A\u0635\u0645\u064A\u0645 \u0627\u0644\u0641\u0647\u0631\u0633\u2026"],
  "wiki.stage.pages": ["Writing the pages\u2026", "\u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u0635\u0641\u062D\u0627\u062A\u2026"],
  "wiki.stage.save": ["Saving\u2026", "\u0627\u0644\u062D\u0641\u0638\u2026"],
  "wiki.stageHint": [
    "The wiki is written from your real files and stored outside the repo.",
    "\u062A\u064F\u0643\u062A\u0628 \u0627\u0644\u0648\u064A\u0643\u064A \u0645\u0646 \u0645\u0644\u0641\u0627\u062A\u0643 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u062A\u064F\u062E\u0632\u064E\u0651\u0646 \u062E\u0627\u0631\u062C \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639."
  ],
  // approvals (6-way)
  "chat.approveSession": ["THIS SESSION", "\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "chat.rejectAlways": ["ALWAYS REJECT", "\u0631\u0641\u0636 \u062F\u0627\u0626\u0645"],
  "chat.approvalScope": ["remember as (editable scope)\u2026", "\u062A\u0630\u0643\u0651\u0631 \u0643\u0640 (\u0646\u0637\u0627\u0642 \u0642\u0627\u0628\u0644 \u0644\u0644\u062A\u0639\u062F\u064A\u0644)\u2026"],
  "chat.approvalScopeHint": ["scope", "\u0646\u0637\u0627\u0642"],
  // v6 meta cards
  "chat.goalVerified": ["Goal verified against real evidence \u2014 files, commands and results.", "\u062A\u062D\u0642\u0651\u0642 \u0627\u0644\u0647\u062F\u0641 \u0645\u0646 \u0627\u0644\u0623\u062F\u0644\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u2014 \u0645\u0644\u0641\u0627\u062A \u0648\u0623\u0648\u0627\u0645\u0631 \u0648\u0646\u062A\u0627\u0626\u062C."],
  "chat.criticClean": ["Adversarial review found no critical issues.", "\u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0646\u0627\u0642\u062F\u0629 \u0644\u0645 \u062A\u062C\u062F \u0645\u0634\u0627\u0643\u0644 \u062D\u0631\u062C\u0629."],
  "chat.criticIssues": ["Adversarial review finished.", "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0646\u0627\u0642\u062F\u0629."],
  "chat.receiptSummary": ["{files} files \xB7 {cmds} commands \xB7 {min} min", "{files} \u0645\u0644\u0641\u0627\u062A \xB7 {cmds} \u0623\u0648\u0627\u0645\u0631 \xB7 {min} \u062F"],
  "chat.receiptVerifyFailed": ["VERIFY FAILED", "\u0641\u0634\u0644 \u0627\u0644\u062A\u062D\u0642\u0642"],
  // error explainer
  "tool.explainError": ["Explain this error and fix it", "\u0627\u0634\u0631\u062D \u0647\u0630\u0627 \u0627\u0644\u062E\u0637\u0623 \u0648\u0623\u0635\u0644\u062D\u0647"],
  "tool.explaining": ["Asking for an explanation\u2026", "\u062C\u0627\u0631\u064D \u0637\u0644\u0628 \u0627\u0644\u0634\u0631\u062D\u2026"],
  "tool.explainTitle": ["Ask SADEEM to explain the error and fix it", "\u0627\u0637\u0644\u0628 \u0645\u0646 \u0633\u062F\u064A\u0645 \u0634\u0631\u062D \u0627\u0644\u062E\u0637\u0623 \u0648\u0625\u0635\u0644\u0627\u062D\u0647"],
  // artifact comments
  "artifacts.commentTitle": ["Comment for the agent (sends with your next message)", "\u062A\u0639\u0644\u064A\u0642 \u0644\u0644\u0648\u0643\u064A\u0644 (\u064A\u064F\u0631\u0633\u0644 \u0645\u0639 \u0631\u0633\u0627\u0644\u062A\u0643 \u0627\u0644\u0642\u0627\u062F\u0645\u0629)"],
  "artifacts.commentRemove": ["Remove comment", "\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062A\u0639\u0644\u064A\u0642"],
  "artifacts.commentPlaceholder": ["e.g. the mobile header overlaps \u2014 fix before shipping", "\u0645\u062B\u0627\u0644: \u062A\u0631\u0648\u064A\u0633\u0629 \u0627\u0644\u062C\u0648\u0627\u0644 \u0645\u062A\u062F\u0627\u062E\u0644\u0629 \u2014 \u0623\u0635\u0644\u062D\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u062A\u0633\u0644\u064A\u0645"],
  "artifacts.commentAdd": ["Queue", "\u0623\u0636\u0641"],
  "chat.pendingComments": ["{n} comments \xB7 sent with your next message", "{n} \u062A\u0639\u0644\u064A\u0642\u0627\u062A \xB7 \u062A\u064F\u0631\u0633\u0644 \u0645\u0639 \u0631\u0633\u0627\u0644\u062A\u0643 \u0627\u0644\u0642\u0627\u062F\u0645\u0629"],
  "chat.clearComments": ["Clear comments", "\u0645\u0633\u062D \u0627\u0644\u062A\u0639\u0644\u064A\u0642\u0627\u062A"],
  // scheduling templates
  "sched.templates": ["Templates", "\u0627\u0644\u0642\u0648\u0627\u0644\u0628"],
  // settings nav
  "settings.nav.feedback": ["Suggestions & Contact", "\u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0648\u0627\u0644\u062A\u0648\u0627\u0635\u0644"],
  // feedback pane
  "feedback.title": ["Suggestions box", "\u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A"],
  "feedback.intro": [
    "SADEEM is new \u2014 YOU see what we cannot. Report problems, tell us what to improve, and suggest the features you need. We read every single submission and improve the app because of it.",
    "\u0633\u062F\u064A\u0645 \u062C\u062F\u064A\u062F\u0629 \u2014 \u0623\u0646\u062A \u062A\u0631\u0649 \u0645\u0627 \u0644\u0627 \u0646\u0631\u0627\u0647. \u0623\u0628\u0644\u063A \u0639\u0646 \u0627\u0644\u0645\u0634\u0627\u0643\u0644\u060C \u0648\u0623\u062E\u0628\u0631\u0646\u0627 \u0628\u0645\u0627 \u0646\u062D\u0633\u0651\u0646\u0647\u060C \u0648\u0627\u0642\u062A\u0631\u062D \u0627\u0644\u0645\u064A\u0632\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u062D\u062A\u0627\u062C\u0647\u0627. \u0646\u0642\u0631\u0623 \u0643\u0644 \u0645\u0634\u0627\u0631\u0643\u0629 \u0648\u0646\u0637\u0648\u0651\u0631 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0628\u0633\u0628\u0628\u0647\u0627."
  ],
  "feedback.placeholder": [
    "What happened? What should we improve? Be as specific as you like \u2014 steps, screenshots paths, what you expected\u2026",
    "\u0645\u0627\u0630\u0627 \u062D\u062F\u062B\u061F \u0645\u0627 \u0627\u0644\u0630\u064A \u0646\u062D\u0633\u0651\u0646\u0647\u061F \u0643\u0646 \u062F\u0642\u064A\u0642\u0627\u064B \u0643\u0645\u0627 \u062A\u0631\u064A\u062F \u2014 \u062E\u0637\u0648\u0627\u062A\u060C \u0645\u0633\u0627\u0631\u0627\u062A \u0644\u0642\u0637\u0627\u062A \u0627\u0644\u0634\u0627\u0634\u0629\u060C \u0645\u0627 \u062A\u0648\u0642\u0639\u062A\u0647\u2026"
  ],
  "feedback.contact": ["Optional contact (email / Telegram) \u2014 so we can follow up", "\u0648\u0633\u064A\u0644\u0629 \u062A\u0648\u0627\u0635\u0644 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A) \u2014 \u0644\u0646\u062A\u0645\u0643\u0646 \u0645\u0646 \u0627\u0644\u0631\u062F \u0639\u0644\u064A\u0643"],
  "feedback.diag": ["Attach basic diagnostics (version, OS, language \u2014 never keys or file paths)", "\u0623\u0631\u0641\u0642 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0623\u0633\u0627\u0633\u064A\u0629 (\u0627\u0644\u0625\u0635\u062F\u0627\u0631\u060C \u0627\u0644\u0646\u0638\u0627\u0645\u060C \u0627\u0644\u0644\u063A\u0629 \u2014 \u0644\u0627 \u0645\u0641\u0627\u062A\u064A\u062D \u0648\u0644\u0627 \u0645\u0633\u0627\u0631\u0627\u062A)"],
  "feedback.send": ["Send suggestion", "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D"],
  "feedback.sending": ["Saving\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062D\u0641\u0638\u2026"],
  "feedback.saved": ["Saved locally", "\u062D\u064F\u0641\u0638 \u0645\u062D\u0644\u064A\u0627\u064B"],
  "feedback.history": ["Your recent submissions", "\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A\u0643 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "feedback.contactUs": ["Reach the team directly", "\u062A\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0641\u0631\u064A\u0642 \u0645\u0628\u0627\u0634\u0631\u0629"],
  "feedback.copyLast": ["Copy latest as markdown", "\u0646\u0633\u062E \u0627\u0644\u0623\u062E\u064A\u0631 \u0643\u0640 Markdown"],
  "feedback.openFolder": ["Open the feedback folder", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A"],
  "feedback.privacyNote": [
    "Submissions are stored on YOUR device only. Nothing is uploaded automatically \u2014 you choose what to send us.",
    "\u062A\u064F\u062E\u0632\u064E\u0651\u0646 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0641\u0642\u0637. \u0644\u0627 \u064A\u064F\u0631\u0641\u0639 \u0634\u064A\u0621 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u2014 \u0623\u0646\u062A \u062A\u062E\u062A\u0627\u0631 \u0645\u0627 \u062A\u0631\u0633\u0644\u0647 \u0625\u0644\u064A\u0646\u0627."
  ],
  // usage streaks
  "usage.streak.current": ["Current streak", "\u0627\u0644\u062A\u062A\u0627\u0628\u0639 \u0627\u0644\u062D\u0627\u0644\u064A"],
  "usage.streak.longest": ["Longest streak", "\u0623\u0637\u0648\u0644 \u062A\u062A\u0627\u0628\u0639"],
  "usage.streak.peakHour": ["Peak hour", "\u0633\u0627\u0639\u0629 \u0627\u0644\u0630\u0631\u0648\u0629"],
  "usage.streak.days": ["days", "\u0623\u064A\u0627\u0645"]
};
Object.assign(D, D_V6_APEX);
var D_V7_ROUTER = {
  // model router card
  "settings.agent.router": ["Model router (v7)", "\u0645\u0648\u062C\u0651\u0647 \u0627\u0644\u0646\u0645\u0627\u0630\u062C (v7)"],
  "settings.agent.router.session": ["Session model", "\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062C\u0644\u0633\u0629"],
  "settings.agent.router.session.hint": [
    "The active model \u2014 the default for every role below until that role is set.",
    "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637 \u2014 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0644\u0643\u0644 \u062F\u0648\u0631 \u0623\u062F\u0646\u0627\u0647 \u0645\u0627 \u0644\u0645 \u064A\u064F\u0636\u0628\u0637 \u0630\u0644\u0643 \u0627\u0644\u062F\u0648\u0631."
  ],
  "settings.agent.router.role.plan": ["Planning (plan)", "\u0627\u0644\u062A\u062E\u0637\u064A\u0637 (plan)"],
  "settings.agent.router.role.plan.hint": [
    "Deep reasoning and plan steps \u2014 the strong model earns its cost here.",
    "\u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644 \u0627\u0644\u0639\u0645\u064A\u0642 \u0648\u062E\u0637\u0648\u0627\u062A \u0627\u0644\u062E\u0637\u0629 \u2014 \u0647\u0646\u0627 \u064A\u064F\u062C\u062F\u0649 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0642\u0648\u064A \u062B\u0645\u0646\u0647."
  ],
  "settings.agent.router.role.search": ["Search / reads (search)", "\u0627\u0644\u0628\u062D\u062B \u0648\u0627\u0644\u0642\u0631\u0627\u0621\u0629 (search)"],
  "settings.agent.router.role.search.hint": [
    "Greps, file reads and listings \u2014 a cheap fast model is plenty.",
    "\u0627\u0644\u0628\u062D\u062B \u0648\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u0627\u0644\u0633\u0631\u062F \u2014 \u0646\u0645\u0648\u0630\u062C \u0631\u062E\u064A\u0635 \u0648\u0633\u0631\u064A\u0639 \u064A\u0643\u0641\u064A."
  ],
  "settings.agent.router.role.edit": ["Edits (edit)", "\u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A (edit)"],
  "settings.agent.router.role.edit.hint": [
    "Code edits and writes \u2014 keep this one accurate.",
    "\u062A\u062D\u0631\u064A\u0631 \u0627\u0644\u0643\u0648\u062F \u0648\u0643\u062A\u0627\u0628\u062A\u0647 \u2014 \u0623\u0628\u0642\u0650 \u0647\u0630\u0627 \u0627\u0644\u062F\u0648\u0631 \u062F\u0642\u064A\u0642\u0627\u064B."
  ],
  "settings.agent.router.role.verify": ["Verifier (verify)", "\u0627\u0644\u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642 (verify)"],
  "settings.agent.router.role.verify.hint": [
    "Checks the run result \u2014 pick a DIFFERENT provider family than the editor.",
    "\u064A\u0641\u062D\u0635 \u0646\u062A\u064A\u062C\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u0627\u062E\u062A\u0631 \u0639\u0627\u0626\u0644\u0629 \u0645\u0632\u0648\u0651\u062F \u0645\u062E\u062A\u0644\u0641\u0629 \u0639\u0646 \u0645\u062D\u0631\u0651\u0631 \u0627\u0644\u0643\u0648\u062F."
  ],
  "settings.agent.router.providerPh": ["provider\u2026", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F\u2026"],
  "settings.agent.router.modelPh": ["model id", "\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.agent.router.useSession": ["use session model", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062C\u0644\u0633\u0629"],
  "settings.agent.router.sessionDefault": ["session default", "\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0627\u0644\u062C\u0644\u0633\u0629"],
  // verifier posture (fail-open / fail-closed)
  "settings.agent.router.posture": ["Verifier posture", "\u0645\u0648\u0642\u0641 \u0627\u0644\u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642"],
  "settings.agent.router.posture.hint": [
    "What a verifier error means for the run verdict.",
    "\u0645\u0627\u0630\u0627 \u064A\u0639\u0646\u064A \u062E\u0637\u0623 \u0627\u0644\u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642 \u0644\u062D\u0643\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."
  ],
  "settings.agent.router.posture.open": ["lenient", "\u0645\u062A\u0633\u0627\u0647\u0644"],
  "settings.agent.router.posture.closed": ["strict", "\u0635\u0627\u0631\u0645"],
  "settings.agent.router.posture.open.desc": [
    "lenient (fail-open) \u2014 verifier errors pass the run.",
    "\u0645\u062A\u0633\u0627\u0647\u0644 (fail-open) \u2014 \u0623\u062E\u0637\u0627\u0621 \u0627\u0644\u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642 \u062A\u0645\u0631\u0651 \u0648\u0644\u0627 \u062A\u064F\u0639\u0637\u0651\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."
  ],
  "settings.agent.router.posture.closed.desc": [
    "strict (fail-closed) \u2014 verifier errors = NOT verified.",
    "\u0635\u0627\u0631\u0645 (fail-closed) \u2014 \u0623\u062E\u0637\u0627\u0621 \u0627\u0644\u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642 \u062A\u0639\u0646\u064A \u0623\u0646 \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u063A\u064A\u0631 \u0645\u064F\u062A\u062D\u0642\u064E\u0651\u0642 \u0645\u0646\u0647\u0627."
  ],
  "settings.agent.router.explain": [
    "Strong model plans, cheap model reads, a DIFFERENT provider family verifies \u2014 one vendor\u2019s blind spot cannot bless a broken run.",
    "\u0646\u0645\u0648\u0630\u062C \u0642\u0648\u064A \u064A\u062E\u0637\u0651\u0637\u060C \u0648\u0646\u0645\u0648\u0630\u062C \u0631\u062E\u064A\u0635 \u064A\u0642\u0631\u0623\u060C \u0648\u0639\u0627\u0626\u0644\u0629 \u0645\u0632\u0648\u0651\u062F \u0645\u062E\u062A\u0644\u0641\u0629 \u062A\u062A\u062D\u0642\u0651\u0642 \u2014 \u0627\u0644\u0646\u0642\u0637\u0629 \u0627\u0644\u0639\u0645\u064A\u0627\u0621 \u0644\u062F\u0649 \u0645\u0632\u0648\u0651\u062F \u0648\u0627\u062D\u062F \u0644\u0627 \u062A\u064F\u0628\u0627\u0631\u0643 \u062A\u0634\u063A\u064A\u0644\u0627\u064B \u0645\u0639\u0637\u0648\u0628\u0627\u064B."
  ],
  // network allowlist card
  "settings.agent.allowlist": ["Network allowlist", "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0634\u0628\u0643\u0629 \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629"],
  "settings.agent.allowlist.ph": [
    "api.github.com \u2014 one hostname per line",
    "api.github.com \u2014 \u0645\u0636\u064A\u0641 \u0648\u0627\u062D\u062F \u0641\u064A \u0643\u0644 \u0633\u0637\u0631"
  ],
  "settings.agent.allowlist.empty": ["Empty = no restriction", "\u0641\u0627\u0631\u063A\u0629 = \u0628\u0644\u0627 \u0642\u064A\u062F"],
  "settings.agent.allowlist.hint": [
    "When set, http_request can only reach these hosts \u2014 long unattended runs stay inside your policy.",
    "\u0639\u0646\u062F \u0636\u0628\u0637\u0647\u0627\u060C \u0644\u0627 \u064A\u0635\u0644 http_request \u0625\u0644\u0627 \u0625\u0644\u0649 \u0647\u0630\u0647 \u0627\u0644\u0645\u0636\u064A\u0641\u0627\u062A \u2014 \u0641\u062A\u0628\u0642\u0649 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0637\u0648\u064A\u0644\u0629 \u063A\u064A\u0631 \u0627\u0644\u0645\u0631\u0627\u0642\u064E\u0628\u0629 \u062F\u0627\u062E\u0644 \u0633\u064A\u0627\u0633\u062A\u0643."
  ],
  // status-bar context + cache chip
  "sb.ctxCache.ctx": ["ctx", "\u0633\u064A\u0627\u0642"],
  "sb.ctxCache.cache": ["cache", "\u0643\u0627\u0634"],
  "sb.ctxCache.tip": [
    "Context {p}% of the window \xB7 cache hit {c}% ({r} read / {w} written)",
    "\u0627\u0644\u0633\u064A\u0627\u0642 {p}% \u0645\u0646 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \xB7 \u0625\u0635\u0627\u0628\u0629 \u0627\u0644\u0643\u0627\u0634 {c}% ({r} \u0642\u0631\u0627\u0621\u0629 / {w} \u0643\u062A\u0627\u0628\u0629)"
  ],
  "sb.ctxCache.tip.noCache": [
    "Context {p}% of the model window",
    "\u0627\u0644\u0633\u064A\u0627\u0642 {p}% \u0645\u0646 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"
  ]
};
Object.assign(D, D_V7_ROUTER);
var D_UI_TSX = {
  // ---- status bar: context ring + popover ----
  "sb.ring.label": ["Context ring", "\u062D\u0644\u0642\u0629 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "sb.ring.model": ["Model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "sb.ring.ctx": ["Context", "\u0627\u0644\u0633\u064A\u0627\u0642"],
  "sb.ring.ctxOf": ["{u} of {l} tokens ({p}%)", "{u} \u0645\u0646 {l} \u0631\u0645\u0632\u0627\u064B ({p}%)"],
  "sb.ring.ctxUnknown": ["{u} tokens used \u2014 window size unknown", "{u} \u0631\u0645\u0632\u0627\u064B \u0645\u0633\u062A\u062E\u062F\u064E\u0645\u0627\u064B \u2014 \u062D\u062C\u0645 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641"],
  "sb.ring.segments": ["Segments", "\u0627\u0644\u062A\u0642\u0633\u064A\u0645"],
  "sb.ring.segmentsApprox": ["Approximate \u2014 only session totals are exposed", "\u062A\u0642\u0631\u064A\u0628\u064A \u2014 \u0627\u0644\u0645\u062A\u0627\u062D \u0647\u0648 \u0625\u062C\u0645\u0627\u0644\u064A\u0627\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u0641\u0642\u0637"],
  "sb.ring.total": ["Session total", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062C\u0644\u0633\u0629"],
  "sb.ring.cacheRead": ["Cache read", "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0643\u0627\u0634"],
  "sb.ring.cacheWrite": ["Cache write", "\u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u0643\u0627\u0634"],
  "sb.ring.cost": ["Session cost", "\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "sb.ring.tokens": ["Tokens", "\u0627\u0644\u0631\u0645\u0648\u0632"],
  "sb.ring.compact": ["Compact now", "\u0627\u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642 \u0627\u0644\u0622\u0646"],
  "sb.ring.compactHint": ["Summarize and compact the transcript to free context", "\u062A\u0644\u062E\u064A\u0635 \u0648\u0636\u063A\u0637 \u0627\u0644\u0633\u062C\u0644 \u0644\u062A\u062D\u0631\u064A\u0631 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "sb.ring.openPicker": ["Change model", "\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "sb.ring.noUsage": ["No usage yet this session", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0628\u0639\u062F"],
  // task-mode chips (BUILD/PLAN/DEBUG/REVIEW)
  "comp.mode.build": ["BUILD", "\u0628\u0646\u0627\u0621"],
  "comp.mode.plan": ["PLAN", "\u062E\u0637\u0629"],
  "comp.mode.debug": ["DEBUG", "\u062A\u0646\u0642\u064A\u062D"],
  "comp.mode.review": ["REVIEW", "\u0645\u0631\u0627\u062C\u0639\u0629"],
  // transcript meta rows
  "mv.output.exit": ["OUTPUT \xB7 exit {n}", "\u0627\u0644\u0646\u0627\u062A\u062C \xB7 \u0631\u0645\u0632 \u0627\u0644\u062E\u0631\u0648\u062C {n}"],
  "mv.output.error": ["ERROR", "\u062E\u0637\u0623"],
  "mv.output.denied": ["DENIED", "\u0645\u0631\u0641\u0648\u0636"],
  "mv.notice.verify": ["VERIFY", "\u062A\u062D\u0642\u0642"],
  "mv.notice.uiq": ["UI CHECK", "\u0641\u062D\u0635 \u0627\u0644\u0648\u0627\u062C\u0647\u0629"],
  "mv.notice.goal": ["GOAL", "\u0627\u0644\u0647\u062F\u0641"],
  "mv.notice.critic": ["CRITIC", "\u0646\u0642\u062F"],
  "mv.notice.audit": ["CLAIM AUDIT", "\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0627\u062F\u0639\u0627\u0621\u0627\u062A"],
  "mv.notice.redgreen": ["RED\u2192GREEN", "\u0623\u062D\u0645\u0631\u2190\u0623\u062E\u0636\u0631"],
  "mv.notice.regression": ["REGRESSION", "\u0627\u0646\u062D\u062F\u0627\u0631"],
  "mv.notice.fake": ["FAKE-TEST", "\u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0647\u0645\u064A"],
  "mv.notice.mutation": ["MUTATION", "\u062A\u062D\u0648\u0631"],
  "mv.notice.proof": ["PROOF", "\u0625\u062B\u0628\u0627\u062A"],
  "mv.notice.guard": ["GUARD", "\u062D\u0627\u0631\u0633"],
  "mv.notice.compact": ["COMPACT", "\u0636\u063A\u0637"],
  "mv.notice.failover": ["FAILOVER", "\u062A\u062D\u0648\u064A\u0644"],
  "mv.notice.gate": ["GATE", "\u0628\u0648\u0627\u0628\u0629"],
  "mv.notice.review": ["REVIEW", "\u0645\u0631\u0627\u062C\u0639\u0629"],
  "mv.notice.continue": ["CONTINUE", "\u0645\u062A\u0627\u0628\u0639\u0629"],
  "mv.notice.stop": ["STOPPED", "\u062A\u0648\u0642\u0641"],
  "mv.notice.progress": ["AGENT", "\u0648\u0643\u064A\u0644"],
  "mv.notice.sys": ["SYSTEM", "\u0646\u0638\u0627\u0645"],
  "mv.gutter.you": ["YOU", "\u0623\u0646\u062A"],
  "mv.stamp.queued": ["QUEUED", "\u0641\u064A \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631"],
  "mv.stamp.steered": ["STEERED", "\u0645\u064F\u0648\u062C\u064E\u0651\u0647"],
  // ---- v11.9 D9 — transcript pills / gates / meta cards (EN + AR parity) ----
  // status pills (ToolCallCard / StatusPill)
  "mv.pill.running": ["RUN", "\u064A\u0639\u0645\u0644"],
  "mv.pill.ok": ["OK", "\u062A\u0645"],
  "mv.pill.error": ["ERROR", "\u062E\u0637\u0623"],
  "mv.pill.denied": ["DENIED", "\u0645\u0631\u0641\u0648\u0636"],
  // tool-result expander ("N more lines")
  "mv.res.more": ["{n} more lines", "{n} \u0633\u0637\u0631\u0627\u064B \u0625\u0636\u0627\u0641\u064A\u0627\u064B"],
  // gate verdict chip (expand / collapse details)
  "mv.gate.details": ["Show full details", "\u0627\u0639\u0631\u0636 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0643\u0627\u0645\u0644\u0629"],
  "mv.gate.hide": ["Hide details", "\u0623\u062E\u0641\u0650 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644"],
  // claim-audit row
  "chat.audit.unsupported": ["{n} claims without evidence \u2014 flagged on the receipt", "{n} \u0627\u062F\u0639\u0627\u0621 \u0628\u0644\u0627 \u062F\u0644\u064A\u0644 \u2014 \u0645\u064F\u0639\u0644\u064E\u0651\u0645 \u0641\u064A \u0627\u0644\u0625\u064A\u0635\u0627\u0644"],
  "chat.audit.ok": ["Every claim is backed by evidence", "\u0643\u0644 \u0627\u0644\u0627\u062F\u0639\u0627\u0621\u0627\u062A \u0645\u062F\u0639\u0648\u0645\u0629 \u0628\u0627\u0644\u0623\u062F\u0644\u0629"],
  // mutation-gate row
  "chat.mutation.ok": ["Tests kill the mutations \u2014 {k}/{r} on the changed lines", "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u062A\u0642\u062A\u0644 \u0627\u0644\u0637\u0641\u0631\u0627\u062A \u2014 {k}/{r} \u0639\u0644\u0649 \u0627\u0644\u0623\u0633\u0637\u0631 \u0627\u0644\u0645\u062A\u063A\u064A\u0651\u0631\u0629"],
  "chat.mutation.none": ["no mutation points on the changed lines \u2014 approved by default", "\u0644\u0627 \u0646\u0642\u0627\u0637 \u062A\u062D\u0648\u0651\u0631 \u0639\u0644\u0649 \u0627\u0644\u0623\u0633\u0637\u0631 \u0627\u0644\u0645\u062A\u063A\u064A\u0651\u0631\u0629 \u2014 \u0627\u0639\u062A\u064F\u0645\u062F \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "chat.mutation.weak": ["Tests do not protect what changed \u2014 killed {k}/{r}", "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0627 \u062A\u062D\u0645\u064A \u0645\u0627 \u062A\u063A\u064A\u0651\u0631 \u2014 \u0642\u064F\u062A\u0644 {k}/{r}"],
  // mutation-check row (tests honesty)
  "chat.mcheck.ok": ["Tests are honest \u2014 they really fail when the code breaks", "\u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0635\u0627\u062F\u0642\u0629 \u2014 \u062A\u0641\u0634\u0644 \u0641\u0639\u0644\u0627\u064B \u0639\u0646\u062F \u0643\u0633\u0631 \u0627\u0644\u0643\u0648\u062F"],
  "chat.mcheck.bad": ["Tests prove nothing \u2014 they always pass, even on broken code", "\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0644\u0627 \u062A\u062B\u0628\u062A \u0634\u064A\u0626\u064B\u0627 \u2014 \u062A\u0645\u0631 \u062F\u0627\u0626\u0645\u0627\u064B \u062D\u062A\u0649 \u0645\u0639 \u0643\u0648\u062F \u0645\u0643\u0633\u0648\u0631"],
  "chat.mcheck.skip": ["Tests-honesty check did not run", "\u0644\u0645 \u064A\u064F\u0646\u0641\u064E\u0651\u0630 \u0641\u062D\u0635 \u0635\u062F\u0642 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A"],
  // red→green row
  "chat.redgreen.ok": ["Red then green \u2014 proven from the log", "\u0627\u0644\u0623\u062D\u0645\u0631 \u062B\u0645 \u0627\u0644\u0623\u062E\u0636\u0631 \u2014 \u0645\u064F\u062B\u0628\u064E\u062A \u0645\u0646 \u0627\u0644\u0633\u062C\u0644"],
  "chat.redgreen.missing": ["no failing run recorded BEFORE the passing one", "\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0634\u063A\u064A\u0644 \u0641\u0627\u0634\u0644 \u0645\u064F\u0633\u062C\u064E\u0651\u0644 \u0642\u0628\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0646\u0627\u062C\u062D"],
  // fake-tests row
  "chat.fakes.high": ["{n} fake tests \u2014 they assert something that can never fail", "{n} \u0627\u062E\u062A\u0628\u0627\u0631 \u0648\u0647\u0645\u064A \u2014 \u064A\u0624\u0643\u062F \u0634\u064A\u0626\u0627\u064B \u0644\u0627 \u064A\u0641\u0634\u0644 \u0623\u0628\u062F\u0627\u064B"],
  "chat.fakes.clean": ["no fake tests found", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0648\u0647\u0645\u064A\u0629"],
  // taint row
  "chat.taint.origin": ["Untrusted source: {o}", "\u0645\u0635\u062F\u0631 \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642: {o}"],
  "chat.taint.escalated": ["Dangerous command after untrusted content \u2014 explicit approval required", "\u0623\u0645\u0631 \u062E\u0637\u0631 \u0628\u0639\u062F \u0645\u062D\u062A\u0648\u0649 \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642 \u2014 \u064A\u0644\u0632\u0645 \u0645\u0648\u0627\u0641\u0642\u0629 \u0635\u0631\u064A\u062D\u0629"],
  // proof card
  "chat.proof.proven": ["Change proven \u2014 every gate passed, package signed", "\u0627\u0644\u062A\u063A\u064A\u064A\u0631 \u0645\u064F\u062B\u0628\u064E\u062A \u2014 \u0643\u0644 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0646\u062C\u062D\u062A \u0648\u0627\u0644\u062A\u0642\u0631\u064A\u0631 \u0645\u064F\u0648\u0642\u064E\u0651\u0639"],
  "chat.proof.failed": ["Not proven \u2014 the gates overruled the claim", "\u063A\u064A\u0631 \u0645\u064F\u062B\u0628\u064E\u062A \u2014 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0631\u0641\u0636\u062A \u0627\u0644\u0627\u062F\u0639\u0627\u0621"],
  "chat.proof.partial": ["Partial \u2014 some gates did not complete", "\u062C\u0632\u0626\u064A \u2014 \u0628\u0639\u0636 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0644\u0645 \u062A\u0643\u062A\u0645\u0644"],
  "chat.proof.gatesSummary": ["gates \xB7 fingerprints \xB7 commands", "\u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \xB7 \u0627\u0644\u0628\u0635\u0645\u0627\u062A \xB7 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "chat.proof.reverify": ["re-verify:", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u062D\u0642\u0642:"],
  // pretty-args drawer
  "tool.noArgs": ["No arguments", "\u0644\u0627 \u0648\u0633\u0627\u0626\u0637"],
  // ---- contextual empty states (derived tasks) ----
  "chat.derived.title": ["Start from your project", "\u0627\u0628\u062F\u0623 \u0645\u0646 \u0645\u0634\u0631\u0648\u0639\u0643"],
  "chat.derived.tests": ["Run failing tests", "\u0634\u063A\u0651\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u0641\u0627\u0634\u0644\u0629"],
  "chat.derived.tests.prompt": [
    "Run the project test suite, list every failing test with its error, then fix them one by one \u2014 re-run after each fix until the suite is green.",
    "\u0634\u063A\u0651\u0644 \u0645\u062C\u0645\u0648\u0639\u0629 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639\u060C \u0648\u0627\u0643\u062A\u0628 \u0642\u0627\u0626\u0645\u0629 \u0628\u0643\u0644 \u0627\u062E\u062A\u0628\u0627\u0631 \u0641\u0627\u0634\u0644 \u0648\u0633\u0628\u0628\u0647\u060C \u062B\u0645 \u0623\u0635\u0644\u062D\u0647\u0627 \u0648\u0627\u062D\u062F\u0627\u064B \u062A\u0644\u0648 \u0627\u0644\u0622\u062E\u0631 \u2014 \u0648\u0623\u0639\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F \u0643\u0644 \u0625\u0635\u0644\u0627\u062D \u062D\u062A\u0649 \u062A\u0635\u0628\u062D \u062C\u0645\u064A\u0639\u0647\u0627 \u0646\u0627\u062C\u062D\u0629."
  ],
  "chat.derived.todos": ["List TODOs", "\u0627\u0643\u0634\u0641 \u0642\u0627\u0626\u0645\u0629 TODO"],
  "chat.derived.todos.prompt": [
    "Search the codebase for TODO, FIXME and HACK comments and summarize them grouped by file, most urgent first.",
    "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0634\u064A\u0641\u0631\u0629 \u0639\u0646 \u062A\u0639\u0644\u064A\u0642\u0627\u062A TODO \u0648FIXME \u0648HACK \u0648\u0644\u062E\u0651\u0635\u0647\u0627 \u0645\u0631\u062A\u0628\u0629 \u062D\u0633\u0628 \u0627\u0644\u0645\u0644\u0641\u060C \u0627\u0644\u0623\u0643\u062B\u0631 \u0625\u0644\u062D\u0627\u062D\u0627\u064B \u0623\u0648\u0644\u0627\u064B."
  ],
  "chat.derived.deps": ["Check outdated deps", "\u0627\u0641\u062D\u0635 \u0627\u0644\u062A\u0628\u0639\u064A\u0627\u062A \u0627\u0644\u0642\u062F\u064A\u0645\u0629"],
  "chat.derived.deps.prompt": [
    "Check the project dependencies for outdated versions (npm outdated or the project equivalent), then report major updates, breaking changes and a safe upgrade order.",
    "\u0627\u0641\u062D\u0635 \u062A\u0628\u0639\u064A\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0628\u062D\u062B\u0627\u064B \u0639\u0646 \u0625\u0635\u062F\u0627\u0631\u0627\u062A \u0642\u062F\u064A\u0645\u0629 (npm outdated \u0623\u0648 \u0645\u0627 \u064A\u0639\u0627\u062F\u0644\u0647)\u060C \u062B\u0645 \u0627\u0639\u0631\u0636 \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0648\u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0627\u0644\u062C\u0630\u0631\u064A\u0629 \u0648\u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u062A\u0631\u0642\u064A\u0629 \u0627\u0644\u0622\u0645\u0646."
  ],
  "chat.derived.review": ["Review uncommitted changes", "\u0631\u0627\u062C\u0639 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0645\u0644\u062A\u0632\u0645\u0629"],
  "chat.derived.review.prompt": [
    "Review my uncommitted changes (git diff): findings by severity, risks, and what you would fix before commit.",
    "\u0631\u0627\u062C\u0639 \u062A\u063A\u064A\u064A\u0631\u0627\u062A\u064A \u063A\u064A\u0631 \u0627\u0644\u0645\u0644\u062A\u0632\u0645\u0629 (git diff): \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u062D\u0633\u0628 \u0627\u0644\u062E\u0637\u0648\u0631\u0629\u060C \u0648\u0627\u0644\u0645\u062E\u0627\u0637\u0631\u060C \u0648\u0645\u0627 \u064A\u062C\u0628 \u0625\u0635\u0644\u0627\u062D\u0647 \u0642\u0628\u0644 \u0627\u0644\u0627\u0644\u062A\u0632\u0627\u0645."
  ],
  "chat.derived.hint": ["Fills the composer \u2014 review, then send", "\u064A\u0645\u0644\u0623 \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u2014 \u0631\u0627\u062C\u0639 \u062B\u0645 \u0623\u0631\u0633\u0644"],
  // ---- proof ribbon ----
  "proof.title": ["Proof", "\u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "proof.unproven": ["Unproven", "\u063A\u064A\u0631 \u0645\u064F\u062B\u0628\u064E\u062A"],
  "proof.proven": ["Proven", "\u0645\u064F\u062B\u0628\u064E\u062A"],
  "proof.failed": ["Failed proof", "\u0641\u0634\u0644 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "proof.evidence": ["Evidence", "\u0627\u0644\u0623\u062F\u0644\u0629"],
  "proof.gate.redGreen": ["Red \u2192 green ledger", "\u0633\u062C\u0644 \u0627\u0644\u0623\u062D\u0645\u0631 \u2192 \u0627\u0644\u0623\u062E\u0636\u0631"],
  "proof.gate.mutation": ["Mutation gate", "\u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0637\u0641\u0631\u0627\u062A"],
  "proof.gate.fakes": ["Fake-test scan", "\u0641\u062D\u0635 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0632\u064A\u0641\u0629"],
  "proof.gate.critic": ["Critic verdict", "\u062D\u0643\u0645 \u0627\u0644\u0646\u0627\u0642\u062F"],
  "proof.gate.verify": ["Verify command", "\u0623\u0645\u0631 \u0627\u0644\u062A\u062D\u0642\u0642"],
  "proof.gate.receipt": ["Run receipt", "\u0625\u064A\u0635\u0627\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "proof.empty": ["Gates will appear here as the run produces verdicts", "\u062A\u0638\u0647\u0631 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0647\u0646\u0627 \u0645\u0639 \u0635\u062F\u0648\u0631 \u0627\u0644\u0623\u062D\u0643\u0627\u0645 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "proof.passed": ["passed", "\u0646\u0627\u062C\u062D"],
  "proof.partial": ["partial", "\u062C\u0632\u0626\u064A"],
  "proof.failedGate": ["failed", "\u0641\u0627\u0634\u0644"],
  // ---- session timeline (checkpoints) ----
  "tl.title": ["Session timeline", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A \u0644\u0644\u062C\u0644\u0633\u0629"],
  "tl.restore": ["Restore checkpoint", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0646\u0642\u0637\u0629"],
  "tl.restoreConfirm": ["Restore \u201C{label}\u201D? Files changed since then will be rolled back.", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \xAB{label}\xBB\u061F \u0633\u064A\u062A\u0645 \u0627\u0644\u062A\u0631\u0627\u062C\u0639 \u0639\u0646 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0628\u0639\u062F \u0647\u0630\u0647 \u0627\u0644\u0646\u0642\u0637\u0629."],
  "tl.restored": ["Checkpoint restored", "\u0627\u0633\u062A\u064F\u0639\u064A\u062F\u062A \u0646\u0642\u0637\u0629 \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "tl.empty": ["No checkpoints yet \u2014 SADEEM snapshots before edits", "\u0644\u0627 \u0646\u0642\u0627\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0628\u0639\u062F \u2014 \u0633\u062F\u064A\u0645 \u062A\u0644\u062A\u0642\u0637 \u0646\u0633\u062E\u0629 \u0642\u0628\u0644 \u0643\u0644 \u062A\u0639\u062F\u064A\u0644"],
  "tl.now": ["Now", "\u0627\u0644\u0622\u0646"],
  // ---- trust map (diffs) ----
  "trust.label": ["Run verdict", "\u062D\u0643\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "trust.passed": ["Gates passed", "\u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0646\u0627\u062C\u062D\u0629"],
  "trust.partial": ["Partially verified", "\u062A\u062D\u0642\u0642 \u062C\u0632\u0626\u064A"],
  "trust.failed": ["Gates failed", "\u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0641\u0627\u0634\u0644\u0629"],
  "trust.unknown": ["No run verdict yet", "\u0644\u0627 \u062D\u0643\u0645 \u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F"],
  "trust.top3": ["Review the top 3", "\u0631\u0627\u062C\u0639 \u0627\u0644\u0623\u0643\u0628\u0631 \u0663"],
  "trust.top3Hint": ["Scroll to the 3 largest hunks in this diff", "\u0627\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0623\u0643\u0628\u0631 \u062B\u0644\u0627\u062B \u0643\u062A\u0644 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0641\u0631\u0642"],
  // ---- focus mode ----
  "focus.toggle": ["Focus mode", "\u0648\u0636\u0639 \u0627\u0644\u062A\u0631\u0643\u064A\u0632"],
  "focus.hint": ["Hide everything but chat \u2014 Esc exits", "\u0625\u062E\u0641\u0627\u0621 \u0643\u0644 \u0634\u064A\u0621 \u0639\u062F\u0627 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u2014 Esc \u0644\u0644\u062E\u0631\u0648\u062C"],
  // ---- welcome redesign ----
  "welcome.hero.q": ["What are we building?", "\u0645\u0627\u0630\u0627 \u0646\u0628\u0646\u064A\u061F"],
  "welcome.hero.sub": ["Describe it in one line \u2014 SADEEM plans, builds, verifies and shows the proof.", "\u0635\u0641\u0651\u0647\u0627 \u0641\u064A \u0633\u0637\u0631 \u0648\u0627\u062D\u062F \u2014 \u0633\u062F\u064A\u0645 \u062A\u062E\u0637\u0637 \u0648\u062A\u0628\u0646\u064A \u0648\u062A\u062A\u062D\u0642\u0642 \u0648\u062A\u064F\u0638\u0647\u0631 \u0627\u0644\u0625\u062B\u0628\u0627\u062A."],
  "welcome.starters": ["One-click starts", "\u0628\u062F\u0627\u064A\u0627\u062A \u0628\u0646\u0642\u0631\u0629"],
  "welcome.starters.app": ["Small web app + live preview", "\u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0628 \u0635\u063A\u064A\u0631 + \u0645\u0639\u0627\u064A\u0646\u0629 \u062D\u064A\u0651\u0629"],
  "welcome.starters.app.prompt": [
    "Build a small but polished web app (one HTML/CSS/JS page is fine), then start the live preview so I can see it.",
    "\u0627\u0628\u0646\u0650 \u062A\u0637\u0628\u064A\u0642 \u0648\u064A\u0628 \u0635\u063A\u064A\u0631\u0627\u064B \u0623\u0646\u064A\u0642\u0627\u064B (\u0635\u0641\u062D\u0629 HTML/CSS/JS \u0648\u0627\u062D\u062F\u0629 \u062A\u0643\u0641\u064A)\u060C \u062B\u0645 \u0634\u063A\u0651\u0644 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0651\u0629 \u0644\u0623\u0631\u0627\u0647."
  ],
  "welcome.starters.fix": ["Find & fix a bug", "\u0627\u0639\u062B\u0631 \u0639\u0644\u0649 \u062E\u0637\u0623 \u0648\u0623\u0635\u0644\u062D\u0647"],
  "welcome.starters.fix.prompt": [
    "Explore the project, find the most impactful bug or broken behaviour, prove the root cause, then fix it and verify with the project\u2019s own checks.",
    "\u0627\u0633\u062A\u0643\u0634\u0641 \u0627\u0644\u0645\u0634\u0631\u0648\u0639\u060C \u0648\u0627\u0639\u062B\u0631 \u0639\u0644\u0649 \u0623\u0643\u062B\u0631 \u062E\u0637\u0623 \u0645\u0624\u062B\u0631\u0627\u064B\u060C \u0648\u0623\u062B\u0628\u062A \u0627\u0644\u0633\u0628\u0628 \u0627\u0644\u062C\u0630\u0631\u064A\u060C \u062B\u0645 \u0623\u0635\u0644\u062D\u0647 \u0648\u062A\u062D\u0642\u0651\u0642 \u0628\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0646\u0641\u0633\u0647\u0627."
  ],
  "welcome.starters.explain": ["Explain this codebase", "\u0627\u0634\u0631\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "welcome.starters.explain.prompt": [
    "Map this codebase: architecture, entry points, key modules and how they connect \u2014 concise, with file paths.",
    "\u0627\u0631\u0633\u0645 \u062E\u0631\u064A\u0637\u0629 \u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639: \u0627\u0644\u0628\u0646\u064A\u0629\u060C \u0646\u0642\u0627\u0637 \u0627\u0644\u062F\u062E\u0648\u0644\u060C \u0627\u0644\u0648\u062D\u062F\u0627\u062A \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0648\u0643\u064A\u0641 \u062A\u062A\u0635\u0644 \u2014 \u0628\u0625\u064A\u062C\u0627\u0632 \u0645\u0639 \u0645\u0633\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A."
  ],
  "welcome.recent.open": ["Open project", "\u0627\u0641\u062A\u062D \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "welcome.cap.proof": ["Proven change", "\u062A\u063A\u064A\u064A\u0631 \u0645\u064F\u062B\u0628\u064E\u062A"],
  // ---- settings presets ----
  "set.presets.title": ["Safety presets", "\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u0623\u0645\u0627\u0646"],
  "set.presets.sub": ["One click applies a coherent posture across ~10 engine keys \u2014 adjust anything after.", "\u0646\u0642\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u062A\u0636\u0628\u0637 \u0646\u0645\u0637\u0627\u064B \u0645\u062A\u0643\u0627\u0645\u0644\u0627\u064B \u0639\u0628\u0631 \u0646\u062D\u0648 \u0639\u0634\u0631\u0629 \u0645\u0641\u0627\u062A\u064A\u062D \u2014 \u0639\u062F\u0651\u0644 \u0645\u0627 \u062A\u0634\u0627\u0621 \u0628\u0639\u062F\u0647\u0627."],
  "set.preset.safe": ["Safe", "\u0622\u0645\u0646"],
  "set.preset.safe.desc": ["Ask for everything, strict verifier, mutation gate on, spend capped", "\u062A\u0623\u0643\u064A\u062F \u0644\u0643\u0644 \u0634\u064A\u0621\u060C \u0645\u064F\u062A\u062D\u0642\u0650\u0651\u0642 \u0635\u0627\u0631\u0645\u060C \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0637\u0641\u0631\u0627\u062A \u0645\u0641\u0639\u0651\u0644\u0629\u060C \u0648\u0633\u0642\u0641 \u0625\u0646\u0641\u0627\u0642"],
  "set.preset.balanced": ["Balanced", "\u0645\u062A\u0648\u0627\u0632\u0646"],
  "set.preset.balanced.desc": ["Auto edits, verified commands, gates on", "\u062A\u0639\u062F\u064A\u0644\u0627\u062A \u062A\u0644\u0642\u0627\u0626\u064A\u0629\u060C \u0623\u0648\u0627\u0645\u0631 \u0645\u064F\u062A\u062D\u0642\u064E\u0651\u0642 \u0645\u0646\u0647\u0627\u060C \u0628\u0648\u0627\u0628\u0627\u062A \u0645\u0641\u0639\u0651\u0644\u0629"],
  "set.preset.indy": ["Independent", "\u0645\u0633\u062A\u0642\u0644"],
  "set.preset.indy.desc": ["Full access, auto-continue, guardrails minimal \u2014 for trusted repos", "\u0648\u0635\u0648\u0644 \u0643\u0627\u0645\u0644\u060C \u0627\u0633\u062A\u0645\u0631\u0627\u0631 \u062A\u0644\u0642\u0627\u0626\u064A\u060C \u0623\u0642\u0644 \u0642\u064A\u0648\u062F \u2014 \u0644\u0644\u0645\u0633\u062A\u0648\u062F\u0639\u0627\u062A \u0627\u0644\u0645\u0648\u062B\u0648\u0642\u0629"],
  "set.presets.applied": ["Preset applied: {name}", "\u0637\u064F\u0628\u0650\u0651\u0642 \u0627\u0644\u0646\u0645\u0637: {name}"],
  // settings groups (6)
  "set.group.general": ["General", "\u0639\u0627\u0645"],
  "set.group.agent": ["Agent", "\u0627\u0644\u0648\u0643\u064A\u0644"],
  "set.group.models": ["Models", "\u0627\u0644\u0646\u0645\u0627\u0630\u062C"],
  "set.group.integrations": ["Integrations", "\u0627\u0644\u062A\u0643\u0627\u0645\u0644\u0627\u062A"],
  "set.group.editor": ["Editor", "\u0627\u0644\u0645\u062D\u0631\u0631"],
  "set.group.account": ["Account & Billing", "\u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0641\u0648\u062A\u0631\u0629"],
  "set.group.appearance": ["Appearance", "\u0627\u0644\u0645\u0638\u0647\u0631"],
  "set.group.notifications": ["Notifications", "\u0627\u0644\u062A\u0646\u0628\u064A\u0647\u0627\u062A"],
  "set.group.voice": ["Voice", "\u0627\u0644\u0635\u0648\u062A"],
  "set.group.privacy": ["Privacy & Security", "\u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629 \u0648\u0627\u0644\u0623\u0645\u0627\u0646"],
  "set.group.memory": ["Skills & Memory", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u0630\u0627\u0643\u0631\u0629"],
  "set.group.providers": ["Providers", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0648\u0646"],
  "set.group.mcp": ["MCP", "\u062E\u0648\u0627\u062F\u0645 MCP"],
  "set.group.plugins": ["Plugins", "\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062A"],
  "set.group.apiServer": ["API Server", "\u062E\u0627\u062F\u0645 API"],
  "set.group.preview": ["Live Preview", "\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0651\u0629"],
  "set.group.terminal": ["Terminal", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "set.group.git": ["Git & Worktrees", "Git \u0648\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "set.group.shortcuts": ["Keyboard Shortcuts", "\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "set.group.feedback": ["Feedback", "\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A"],
  "set.group.advanced": ["Advanced", "\u0645\u062A\u0642\u062F\u0645"],
  // v11.10 — approvals manager (Settings → Approvals)
  "set.group.approvals": ["Approvals", "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A"],
  "set.group.approvals.desc": [
    "Always-allow rules with revoke + the Full access master switch.",
    '\u0642\u0648\u0627\u0639\u062F "\u0627\u0633\u0645\u062D \u062F\u0627\u0626\u0645\u0627\u064B" \u0645\u0639 \u0627\u0644\u0625\u0644\u063A\u0627\u0621 + \u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0648\u0635\u0648\u0644 \u0627\u0644\u0643\u0627\u0645\u0644.'
  ],
  "settings.approvals.desc": [
    "Everything the agent is pre-allowed to do \u2014 see it, revoke it.",
    "\u0643\u0644 \u0645\u0627 \u064A\u064F\u0633\u0645\u062D \u0644\u0644\u0648\u0643\u064A\u0644 \u0628\u0647 \u0645\u0633\u0628\u0642\u0627\u064B \u2014 \u0634\u0627\u0647\u062F\u0647 \u0648\u0623\u0644\u063A\u0650\u0647."
  ],
  "settings.approvals.fullAccess": ["Full access", "\u0627\u0644\u0648\u0635\u0648\u0644 \u0627\u0644\u0643\u0627\u0645\u0644"],
  "settings.approvals.fullAccess.label": ["Full access master switch", "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u0648\u0635\u0648\u0644 \u0627\u0644\u0643\u0627\u0645\u0644 \u0627\u0644\u0631\u0626\u064A\u0633\u064A"],
  "settings.approvals.fullAccess.hint": [
    "Same switch as the title-bar mode strip. OFF (Ask) confirms every edit and command; AUTO-EDIT auto-approves file edits only; ON auto-approves everything below.",
    "\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0646\u0641\u0633\u0647 \u0641\u064A \u0634\u0631\u064A\u0637 \u0627\u0644\u0623\u0648\u0636\u0627\u0639 \u0623\u0639\u0644\u0649 \u0627\u0644\u0646\u0627\u0641\u0630\u0629. \u0645\u063A\u0644\u0642 (\u062A\u0623\u0643\u064A\u062F) \u064A\u0637\u0644\u0628 \u062A\u0623\u0643\u064A\u062F\u0643 \u0644\u0643\u0644 \u062A\u0639\u062F\u064A\u0644 \u0648\u0623\u0645\u0631\u061B \u062A\u0639\u062F\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A \u064A\u0648\u0627\u0641\u0642 \u0639\u0644\u0649 \u062A\u0639\u062F\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0641\u0642\u0637\u061B \u0645\u0641\u0639\u0651\u0644 \u064A\u0648\u0627\u0641\u0642 \u0639\u0644\u0649 \u0643\u0644 \u0645\u0627 \u0647\u0648 \u0645\u0630\u0643\u0648\u0631 \u0623\u062F\u0646\u0627\u0647 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B."
  ],
  "settings.approvals.exactly": ["What this grants \u2014 exactly", "\u0645\u0627 \u064A\u0645\u0646\u062D\u0647 \u0647\u0630\u0627 \u0627\u0644\u0625\u0639\u062F\u0627\u062F \u2014 \u0628\u062F\u0642\u0629"],
  "settings.approvals.grant.write": [
    "File writes, edits and deletes inside the workspace \u2014 approved automatically.",
    "\u0643\u062A\u0627\u0628\u0629 \u0648\u062A\u0639\u062F\u064A\u0644 \u0648\u062D\u0630\u0641 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u062F\u0627\u062E\u0644 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u2014 \u0645\u0648\u0627\u0641\u0642\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0629."
  ],
  "settings.approvals.grant.cmd": [
    "Ordinary shell commands (npm, git, python, builds) \u2014 approved automatically.",
    "\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0639\u0627\u062F\u064A\u0629 (npm \u0648git \u0648python \u0648\u0627\u0644\u0628\u0646\u0627\u0621) \u2014 \u0645\u0648\u0627\u0641\u0642\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0629."
  ],
  "settings.approvals.grant.keep": [
    "HIGH-RISK commands (sudo, rm -rf /, fork bombs) and commands flagged by taint/network checks STILL ask once.",
    "\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0639\u0627\u0644\u064A\u0629 \u0627\u0644\u062E\u0637\u0648\u0631\u0629 (sudo \u0648rm -rf / \u0648\u0642\u0646\u0627\u0628\u0644 fork) \u0648\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u062A\u064A \u062A\u0634\u064A\u0631 \u0625\u0644\u064A\u0647\u0627 \u0641\u062D\u0648\u0635\u0627\u062A \u0627\u0644\u062A\u0644\u0648\u064A\u062B/\u0627\u0644\u0634\u0628\u0643\u0629 \u062A\u0628\u0642\u0649 \u062A\u0637\u0644\u0628 \u062A\u0623\u0643\u064A\u062F\u0627\u064B \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629."
  ],
  "settings.approvals.warning": [
    "Never enable on a machine with secrets you cannot afford to lose.",
    "\u0644\u0627 \u062A\u0641\u0639\u0651\u0644\u0647 \u0623\u0628\u062F\u0627\u064B \u0639\u0644\u0649 \u062C\u0647\u0627\u0632 \u064A\u062D\u062A\u0648\u064A \u0623\u0633\u0631\u0627\u0631\u0627\u064B \u0644\u0627 \u062A\u062A\u062D\u0645\u0651\u0644 \u0641\u0642\u062F\u0627\u0646\u0647\u0627."
  ],
  "settings.approvals.rules": ["Granted always-rules", '\u0642\u0648\u0627\u0639\u062F "\u0627\u0633\u0645\u062D \u062F\u0627\u0626\u0645\u0627\u064B" \u0627\u0644\u0645\u0645\u0646\u0648\u062D\u0629'],
  "settings.approvals.empty": [
    "Nothing granted yet \u2014 every edit/command asks until you pick \u201CAlways allow\u201D on its card.",
    '\u0644\u0627 \u0634\u064A\u0621 \u0645\u0645\u0646\u0648\u062D \u0628\u0639\u062F \u2014 \u0643\u0644 \u062A\u0639\u062F\u064A\u0644/\u0623\u0645\u0631 \u064A\u0637\u0644\u0628 \u062A\u0623\u0643\u064A\u062F\u0643 \u062D\u062A\u0649 \u062A\u062E\u062A\u0627\u0631 "\u0627\u0633\u0645\u062D \u062F\u0627\u0626\u0645\u0627\u064B" \u0645\u0646 \u0628\u0637\u0627\u0642\u062A\u0647.'
  ],
  "settings.approvals.alwaysAllow": ["ALWAYS ALLOW", "\u0627\u0633\u0645\u062D \u062F\u0627\u0626\u0645\u0627\u064B"],
  "settings.approvals.alwaysReject": ["ALWAYS REJECT", "\u0627\u0631\u0641\u0636 \u062F\u0627\u0626\u0645\u0627\u064B"],
  "settings.approvals.revoke": ["Revoke", "\u0625\u0644\u063A\u0627\u0621"],
  "settings.approvals.revoked": ["Rule revoked ({n})", "\u0623\u064F\u0644\u063A\u064A\u062A \u0627\u0644\u0642\u0627\u0639\u062F\u0629 ({n})"],
  "settings.approvals.revokeFail": ["Could not revoke the rule", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0642\u0627\u0639\u062F\u0629"],
  "settings.approvals.showMore": ["Show all {n} rules", "\u0627\u0639\u0631\u0636 \u0643\u0644 \u0627\u0644\u0642\u0648\u0627\u0639\u062F ({n})"],
  "settings.approvals.showLess": ["Show less", "\u0627\u0639\u0631\u0636 \u0623\u0642\u0644"],
  "settings.approvals.note": [
    "Rules are stored per workspace in the app-data approval stores. A revoke takes full effect for the active chat after its next run / app restart; new chats apply it immediately.",
    "\u062A\u064F\u062D\u0641\u0638 \u0627\u0644\u0642\u0648\u0627\u0639\u062F \u0644\u0643\u0644 \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0641\u064A \u0645\u062E\u0627\u0632\u0646 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A \u062F\u0627\u062E\u0644 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062A\u0637\u0628\u064A\u0642. \u0627\u0644\u0625\u0644\u063A\u0627\u0621 \u064A\u0633\u0631\u064A \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0639\u0644\u0649 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u0646\u0634\u0637\u0629 \u0628\u0639\u062F \u062A\u0634\u063A\u064A\u0644\u0647\u0627 \u0627\u0644\u062A\u0627\u0644\u064A/\u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642\u061B \u0648\u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0627\u062A \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u062A\u0637\u0628\u0651\u0642\u0647 \u0641\u0648\u0631\u0627\u064B."
  ],
  "common.loading": ["Loading\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "set.group.general.desc": ["Language, permissions, checkpoints, onboarding and recent projects.", "\u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A \u0648\u0646\u0642\u0627\u0637 \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0648\u0627\u0644\u062A\u0631\u062D\u064A\u0628 \u0648\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 \u0627\u0644\u0623\u062E\u064A\u0631\u0629."],
  "set.group.agent.desc": ["Engine loop, turns, caching, router and verification.", "\u062D\u0644\u0642\u0629 \u0627\u0644\u0645\u062D\u0631\u0643 \u0648\u0627\u0644\u062F\u0648\u0631\u0627\u062A \u0648\u0627\u0644\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0645\u0624\u0642\u062A \u0648\u0627\u0644\u0645\u0648\u062C\u0651\u0647 \u0648\u0627\u0644\u062A\u062D\u0642\u0642."],
  "set.group.models.desc": ["Active model, reasoning depth, tokens and temperature.", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637 \u0648\u0639\u0645\u0642 \u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644 \u0648\u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A \u0648\u0627\u0644\u062D\u0631\u0627\u0631\u0629."],
  "set.group.integrations.desc": ["MCP servers, API server and live preview.", "\u062E\u0648\u0627\u062F\u0645 MCP \u0648\u062E\u0627\u062F\u0645 API \u0648\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0651\u0629."],
  "set.group.editor.desc": ["Ghost suggestions, minimap, wrap and indentation.", "\u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0627\u0644\u0634\u0628\u062D\u064A\u0629 \u0648\u0627\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0645\u0635\u063A\u0631\u0629 \u0648\u0627\u0644\u0627\u0644\u062A\u0641\u0627\u0641 \u0648\u0627\u0644\u0645\u0633\u0627\u0641\u0627\u062A."],
  "set.group.account.desc": ["Profile, license, plans and usage on this device.", "\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A \u0648\u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0648\u0627\u0644\u062E\u0637\u0637 \u0648\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632."],
  "set.router.summary": ["Model routing", "\u062A\u0648\u062C\u064A\u0647 \u0627\u0644\u0646\u0645\u0627\u0630\u062C"],
  "set.router.summary.sub": ["Role \u2192 model map the engine uses for each step. Unset roles use the session model.", "\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u062F\u0648\u0631 \u2190 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062A\u064A \u064A\u0633\u062A\u062E\u062F\u0645\u0647\u0627 \u0627\u0644\u0645\u062D\u0631\u0643 \u0641\u064A \u0643\u0644 \u062E\u0637\u0648\u0629. \u0627\u0644\u0623\u062F\u0648\u0627\u0631 \u063A\u064A\u0631 \u0627\u0644\u0645\u0636\u0628\u0648\u0637\u0629 \u062A\u0633\u062A\u062E\u062F\u0645 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062C\u0644\u0633\u0629."],
  "set.router.edit": ["Edit routing in Agent & Security", "\u0639\u062F\u0651\u0644 \u0627\u0644\u062A\u0648\u062C\u064A\u0647 \u0645\u0646 \xAB\u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u0627\u0644\u0623\u0645\u0627\u0646\xBB"],
  "set.router.role.plan": ["Plan", "\u0627\u0644\u062A\u062E\u0637\u064A\u0637"],
  "set.router.role.search": ["Search", "\u0627\u0644\u0628\u062D\u062B"],
  "set.router.role.edit": ["Edit", "\u0627\u0644\u062A\u0639\u062F\u064A\u0644"],
  "set.router.role.verify": ["Verify", "\u0627\u0644\u062A\u062D\u0642\u0642"],
  "set.router.role.context": ["Context", "\u0627\u0644\u0633\u064A\u0627\u0642"],
  // density / zoom / numerals controls
  "set.ui.zoom": ["Interface zoom", "\u062A\u0643\u0628\u064A\u0631 \u0627\u0644\u0648\u0627\u062C\u0647\u0629"],
  "set.ui.zoom.hint": ["Scales the whole UI (0.9\u20131.25). Applied live.", "\u064A\u0643\u0628\u0651\u0631 \u0627\u0644\u0648\u0627\u062C\u0647\u0629 \u0643\u0627\u0645\u0644\u0629 (\u0660\u066B\u0669\u2013\u0661\u066B\u0662\u0665). \u064A\u064F\u0637\u0628\u064E\u0651\u0642 \u0641\u0648\u0631\u0627\u064B."],
  "set.ui.density": ["Density", "\u0627\u0644\u0643\u062B\u0627\u0641\u0629"],
  "set.ui.density.comfortable": ["Comfortable", "\u0645\u0631\u064A\u062D\u0629"],
  "set.ui.density.compact": ["Compact", "\u0645\u0636\u063A\u0648\u0637\u0629"],
  "set.ui.numerals": ["Numerals", "\u0627\u0644\u0623\u0631\u0642\u0627\u0645"],
  "set.ui.numerals.western": ["Western (123)", "\u063A\u0631\u0628\u064A\u0629 (123)"],
  "set.ui.numerals.arabic": ["Arabic (\u0661\u0662\u0663)", "\u0639\u0631\u0628\u064A\u0629 (\u0661\u0662\u0663)"],
  // themes follow/high
  "settings.theme.follow": ["Follow device (default)", "\u062D\u0633\u0628 \u0627\u0644\u062C\u0647\u0627\u0632 (\u0627\u0641\u062A\u0631\u0627\u0636\u064A)"],
  "settings.theme.high": ["High contrast", "\u062A\u0628\u0627\u064A\u0646 \u0639\u0627\u0644\u064D"],
  // onboarding (3 steps)
  "onboard.step.model": ["Model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "onboard.step.model.sub": ["Pick a provider and paste your API key \u2014 it stays on this device.", "\u0627\u062E\u062A\u0631 \u0645\u0632\u0648\u0651\u062F\u0627\u064B \u0648\u0627\u0644\u0635\u0642 \u0645\u0641\u062A\u0627\u062D API \u2014 \u064A\u0628\u0642\u0649 \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643."],
  "onboard.step.folder": ["Folder", "\u0627\u0644\u0645\u062C\u0644\u062F"],
  "onboard.step.folder.sub": ["Choose the project folder SADEEM will work in.", "\u0627\u062E\u062A\u0631 \u0645\u062C\u0644\u062F \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0630\u064A \u0633\u064A\u0639\u0645\u0644 \u0639\u0644\u064A\u0647 \u0633\u062F\u064A\u0645."],
  "onboard.step.security": ["Security level", "\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0623\u0645\u0627\u0646"],
  "onboard.step.security.sub": ["One posture for approvals, verification and network \u2014 change it anytime in Settings.", "\u0646\u0645\u0637 \u0648\u0627\u062D\u062F \u0644\u0644\u0623\u0630\u0648\u0646\u0627\u062A \u0648\u0627\u0644\u062A\u062D\u0642\u0642 \u0648\u0627\u0644\u0634\u0628\u0643\u0629 \u2014 \u064A\u0645\u0643\u0646\u0643 \u062A\u063A\u064A\u064A\u0631\u0647 \u0644\u0627\u062D\u0642\u0627\u064B \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A."],
  "onboard.skipModel": ["Configure later", "\u0623\u064F\u0639\u064A\u0651\u0646\u0647 \u0644\u0627\u062D\u0642\u0627\u064B"],
  "onboard.folderPick": ["Pick a folder", "\u0627\u062E\u062A\u0631 \u0645\u062C\u0644\u062F\u0627\u064B"],
  "onboard.folderDone": ["Folder selected", "\u062A\u0645 \u0627\u062E\u062A\u064A\u0627\u0631 \u0627\u0644\u0645\u062C\u0644\u062F"],
  // misc
  "misc.esc": ["Esc", "Esc"]
};
Object.assign(D, D_UI_TSX);
var D_UI_TSX2 = {
  // missing keys found by the t() call audit
  "dna.fb.recorded": ["Recorded", "\u0633\u064F\u062C\u0651\u0644"],
  "settings.appearance.compact.hint": [
    "Compact density tightens chrome spacing app-wide",
    "\u0627\u0644\u0643\u062B\u0627\u0641\u0629 \u0627\u0644\u0645\u0636\u063A\u0648\u0637\u0629 \u062A\u0642\u0644\u0651\u0635 \u062A\u0628\u0627\u0639\u062F \u0627\u0644\u0648\u0627\u062C\u0647\u0629 \u0641\u064A \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0643\u0644\u0647"
  ],
  // MCP — import servers from agents installed on this machine
  "settings.mcp.importRivals": ["Import from installed agents", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0645\u0646 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u062B\u0628\u064E\u0651\u062A\u064A\u0646"],
  "settings.mcp.rivalScan": ["Scanning installed agent configs\u2026", "\u062C\u0627\u0631\u064D \u0641\u062D\u0635 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u062B\u0628\u064E\u0651\u062A\u064A\u0646\u2026"],
  "settings.mcp.rivalNone": [
    "No other agent configs found on this machine",
    "\u0644\u0627 \u062A\u0648\u062C\u062F \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0648\u0643\u0644\u0627\u0621 \u0622\u062E\u0631\u064A\u0646 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"
  ],
  "settings.mcp.rivalAdd": ["Add", "\u0625\u0636\u0627\u0641\u0629"],
  "settings.mcp.rivalAddedShort": ["Added", "\u0645\u064F\u0636\u0627\u0641"],
  "settings.mcp.rivalAdded": ['Added "{name}" from {src}', '\u0623\u064F\u0636\u064A\u0641 "{name}" \u0645\u0646 {src}'],
  "settings.mcp.rivalAddFailed": ["Could not add this server.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0625\u0636\u0627\u0641\u0629 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645."],
  // Skills — import from other agents
  "skills.rivals.title": ["Import from other agents", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0645\u0646 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0622\u062E\u0631\u064A\u0646"],
  "skills.rivals.scopeTip": ["Imported skills land in this scope", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0648\u0631\u062F\u0629 \u062A\u064F\u062D\u0641\u0638 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0646\u0637\u0627\u0642"],
  "skills.rivals.scanning": ["Scanning installed agent tools\u2026", "\u062C\u0627\u0631\u064D \u0641\u062D\u0635 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u062B\u0628\u064E\u0651\u062A\u0629\u2026"],
  "skills.rivals.noneFound": ["No importable skills found", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0627\u0631\u0627\u062A \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F"],
  "skills.rivals.import": ["Import", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F"],
  "skills.rivals.imported": ["Imported {n} skill(s) from {src}", "\u0627\u0633\u062A\u064F\u0648\u0631\u062F\u062A {n} \u0645\u0647\u0627\u0631\u0629 \u0645\u0646 {src}"],
  "skills.rivals.failedShort": ["failed", "\u0641\u0634\u0644\u062A"],
  "skills.rivals.none": ["Nothing new \u2014 existing skills were skipped", "\u0644\u0627 \u062C\u062F\u064A\u062F \u2014 \u062A\u0645 \u062A\u062E\u0637\u064A \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u0648\u062C\u0648\u062F\u0629"],
  // task-mode stamp tooltips (status bar)
  "comp.mode.build.desc": ["BUILD \u2014 default execution posture", "\u0628\u0646\u0627\u0621 \u2014 \u0648\u0636\u0639 \u0627\u0644\u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A"],
  "comp.mode.plan.desc": ["PLAN \u2014 research and propose, no writes", "\u062E\u0637\u0629 \u2014 \u0628\u062D\u062B \u0648\u0627\u0642\u062A\u0631\u0627\u062D \u062F\u0648\u0646 \u062A\u0639\u062F\u064A\u0644"],
  "comp.mode.debug.desc": ["DEBUG \u2014 hypothesis \u2192 test discipline", "\u062A\u0646\u0642\u064A\u062D \u2014 \u0645\u0646\u0647\u062C\u064A\u0629 \u0641\u0631\u0636\u064A\u0629 \u062B\u0645 \u0627\u062E\u062A\u0628\u0627\u0631"],
  "comp.mode.review.desc": ["REVIEW \u2014 read-only review posture", "\u0645\u0631\u0627\u062C\u0639\u0629 \u2014 \u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637"],
  // plan contract card (was hardwired Latin)
  "chat.plan.stamp": ["PLAN", "\u062E\u0637\u0629"],
  "chat.plan.steps": ["{n} steps", "{n} \u062E\u0637\u0648\u0627\u062A"],
  // review header stamp (was hardwired '{n} FINDINGS')
  "chat.review.findings": ["{n} FINDINGS", "{n} \u0646\u062A\u0627\u0626\u062C"],
  // welcome permission-mode stamps (short instrument forms)
  "welcome.mode.stamp.plan": ["PLAN", "\u062E\u0637\u0629"],
  "welcome.mode.stamp.default": ["ASK", "\u062A\u0623\u0643\u064A\u062F"],
  "welcome.mode.stamp.autoEdit": ["AUTO", "\u062A\u0644\u0642\u0627\u0626\u064A"],
  "welcome.mode.stamp.fullAccess": ["FULL", "\u0643\u0627\u0645\u0644"],
  // context lens — chat header popover (segments or total + Compact)
  "chat.lens.title": ["Context lens", "\u0639\u062F\u0633\u0629 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "chat.lens.hint": ["Model, context window, session cost and Compact", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0648\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642 \u0648\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062C\u0644\u0633\u0629 \u0648\u0627\u0644\u0636\u063A\u0637"]
};
Object.assign(D, D_UI_TSX2);
var D_A4_STATUSBAR = {
  // False-Done Rate chip tooltip (v8.1 published honesty metric)
  "sb.fd.tip": [
    "False-Done Rate \u2014 of runs claiming success, the share the proof gates overruled (career-long, persisted)",
    "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0632\u0627\u0626\u0641 \u2014 \u0645\u0646 \u0627\u0644\u062C\u0648\u0644\u0627\u062A \u0627\u0644\u062A\u064A \u0627\u062F\u0651\u0639\u062A \u0627\u0644\u0646\u062C\u0627\u062D\u060C \u0645\u0627 \u062F\u062D\u0636\u062A\u0647 \u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0625\u062B\u0628\u0627\u062A (\u0633\u062C\u0644 \u062A\u0631\u0627\u0643\u0645\u064A \u062F\u0627\u0626\u0645)"
  ],
  // task progress stamp tooltip ({d} done of {t} total)
  "sb.tasks.tip": ["Task progress \u2014 {d} of {t} done", "\u062A\u0642\u062F\u0651\u0645 \u0627\u0644\u0645\u0647\u0627\u0645 \u2014 {d} \u0645\u0646 {t} \u0645\u0646\u062C\u0632\u0629"]
};
Object.assign(D, D_A4_STATUSBAR);
var D_A2_MCP = {
  // per-server last-connection row (health monitor / registry probe)
  "mcp.lastConn": ["Last connection: {status} \xB7 {when}", "\u0622\u062E\u0631 \u0627\u062A\u0635\u0627\u0644: {status} \xB7 {when}"],
  "mcp.hstatus.up": ["Connected", "\u0645\u062A\u0635\u0644"],
  "mcp.hstatus.down": ["Unreachable", "\u063A\u064A\u0631 \u0642\u0627\u0628\u0644 \u0644\u0644\u0648\u0635\u0648\u0644"],
  "mcp.hstatus.starting": ["Connecting", "\u062C\u0627\u0631\u064D \u0627\u0644\u0627\u062A\u0635\u0627\u0644"],
  "mcp.hstatus.disabled": ["Disabled", "\u0645\u0639\u0637\u0651\u0644"],
  "mcp.hstatus.quarantined": ["Quarantined", "\u0645\u062D\u062C\u0648\u0631"],
  "mcp.hstatus.never": ["Not checked yet", "\u0644\u0645 \u064A\u064F\u0641\u062D\u0635 \u0628\u0639\u062F"],
  "mcp.hstatus.error": ["Last error", "\u0622\u062E\u0631 \u062E\u0637\u0623"],
  // per-server tool allow/deny inputs (exact names or globs; deny wins)
  "mcp.allow": ["Allow", "\u0633\u0645\u0627\u062D"],
  "mcp.deny": ["Deny", "\u0631\u0641\u0636"],
  "mcp.allowHint": [
    "Allow-list: exact tool names or globs (*, ?). Empty = every tool is allowed.",
    "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0633\u0645\u0627\u062D: \u0623\u0633\u0645\u0627\u0621 \u0623\u062F\u0648\u0627\u062A \u062F\u0642\u064A\u0642\u0629 \u0623\u0648 \u0623\u0646\u0645\u0627\u0637 (*\u060C ?). \u0641\u0627\u0631\u063A = \u0643\u0644 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u0633\u0645\u0648\u062D\u0629."
  ],
  "mcp.denyHint": [
    "Deny-list: denied tools are hidden from the model and their calls are refused. DENY WINS over the allow-list.",
    "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0631\u0641\u0636: \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0648\u0636\u0629 \u062A\u064F\u062E\u0641\u0649 \u0639\u0646 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0648\u062A\u064F\u0631\u0641\u0636 \u0646\u062F\u0627\u0624\u0647\u0627. \u0627\u0644\u0631\u0641\u0636 \u064A\u0633\u0628\u0642 \u0627\u0644\u0633\u0645\u0627\u062D."
  ],
  "mcp.allowPlaceholder": ["e.g. search_*, get_file \u2014 empty = all tools", "\u0645\u062B\u0627\u0644: search_*, get_file \u2014 \u0641\u0627\u0631\u063A = \u0643\u0644 \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "mcp.denyPlaceholder": ["e.g. delete_*, run_cmd \u2014 deny wins", "\u0645\u062B\u0627\u0644: delete_*, run_cmd \u2014 \u0627\u0644\u0631\u0641\u0636 \u064A\u0633\u0628\u0642"],
  // denied tool badges in the inspector
  "mcp.toolDeniedTip": [
    "Excluded by this server's allow/deny lists \u2014 never offered to the model, calls refused. Edit the lists on the server card.",
    "\u0645\u0633\u062A\u0628\u0639\u062F\u0629 \u0645\u0646 \u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0633\u0645\u0627\u062D/\u0627\u0644\u0631\u0641\u0636 \u0644\u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u2014 \u0644\u0627 \u062A\u064F\u0639\u0631\u0636 \u0639\u0644\u0649 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0648\u062A\u064F\u0631\u0641\u0636 \u0646\u062F\u0627\u0624\u0647\u0627. \u0639\u062F\u0651\u0644 \u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0645\u0646 \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062E\u0627\u062F\u0645."
  ],
  "mcp.toolDeniedNote": [
    "Excluded by the allow/deny lists on this card \u2014 the agent never sees this tool.",
    "\u0645\u0633\u062A\u0628\u0639\u062F\u0629 \u0645\u0646 \u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0633\u0645\u0627\u062D/\u0627\u0644\u0631\u0641\u0636 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u2014 \u0627\u0644\u0648\u0643\u064A\u0644 \u0644\u0627 \u064A\u0631\u0649 \u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0627\u0629 \u0625\u0637\u0644\u0627\u0642\u0627\u064B."
  ]
};
Object.assign(D, D_A2_MCP);
var D_A6_OPENROUTER = {
  // live group header (rendered under the static OpenRouter catalog)
  "mp.liveGroup": ["OpenRouter \u2014 live catalog", "\u0623\u0648\u0628\u0646 \u0631\u0627\u0648\u062A\u0631 \u2014 \u0643\u062A\u0627\u0644\u0648\u062C \u062D\u064A"],
  // row tooltip for live models
  "mp.liveTip": [
    "Fetched live from openrouter.ai with your API key",
    "\u0645\u062C\u0644\u0648\u0628 \u062D\u064A\u0627\u064B \u0645\u0646 openrouter.ai \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0641\u062A\u0627\u062D API \u0627\u0644\u062E\u0627\u0635 \u0628\u0643"
  ],
  // ':free' chip tooltip on live free variants
  "mp.liveFreeTip": ["Free variant \u2014 zero metered cost (:free)", "\u0646\u0633\u062E\u0629 \u0645\u062C\u0627\u0646\u064A\u0629 \u2014 \u0628\u0644\u0627 \u062A\u0643\u0644\u0641\u0629 \u0645\u062D\u0633\u0648\u0628\u0629 (:free)"],
  // loading hint (spinner next to the live group header)
  "mp.liveLoading": ["Loading live models\u2026", "\u062C\u0627\u0631\u064D \u062C\u0644\u0628 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062D\u064A\u0629\u2026"]
};
Object.assign(D, D_A6_OPENROUTER);
var D_A1_SLASH = {
  // /status — compact system snapshot of the current session
  "slash.status.title": ["Session status", "\u062D\u0627\u0644\u0629 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "slash.status.model": ["Model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "slash.status.mode": ["Permission mode", "\u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "slash.status.workspace": ["Workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "slash.status.tokens": ["Tokens", "\u0627\u0644\u0631\u0645\u0648\u0632"],
  "slash.status.cost": ["Est. cost", "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062A\u0642\u062F\u064A\u0631\u064A\u0629"],
  "slash.status.keyOn": ["key set", "\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0636\u0628\u0648\u0637"],
  "slash.status.keyOff": ["no key", "\u0644\u0627 \u0645\u0641\u062A\u0627\u062D"],
  "slash.status.budget": ["Verification budget", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062A\u062D\u0642\u0642"],
  "slash.status.falseDone": ["False-done rate", "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u0646\u062C\u0627\u0632 \u0627\u0644\u0632\u0627\u0626\u0641"],
  // /export — transcript → <workspace>/.surnia/export/session-<ISO date>.md
  "slash.export.written": ["Session exported to {path}", "\u0635\u064F\u062F\u0651\u0631\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u0625\u0644\u0649 {path}"],
  "slash.export.downloaded": ["Session exported (Markdown download)", "\u0635\u064F\u062F\u0651\u0631\u062A \u0627\u0644\u062C\u0644\u0633\u0629 (\u062A\u0646\u0632\u064A\u0644 Markdown)"],
  "slash.export.failed": ["Export failed", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0635\u062F\u064A\u0631"],
  // /diff — working-tree diff in the DiffModal ('slash.diff.title' and
  // 'slash.diff.failed' live in the later D_V1113 block — no duplicates).
  "slash.diff.noChanges": ["No uncommitted changes \u2014 the working tree is clean.", "\u0644\u0627 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u0648\u062F\u0639\u0629 \u2014 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0646\u0638\u064A\u0641\u0629."],
  // /rewind — checkpoint chooser (inline list + picker)
  "slash.rewind.list": ["Checkpoints ({n})", "\u0646\u0642\u0627\u0637 \u0627\u0644\u062A\u062D\u0642\u0642 ({n})"],
  "slash.rewind.pick": ["Pick a checkpoint to restore \u2014 files go back, the conversation stays.", "\u0627\u062E\u062A\u0631 \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642 \u0644\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u2014 \u062A\u0639\u0648\u062F \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u062A\u0628\u0642\u0649 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629."],
  "slash.rewind.files": ["{n} files", "{n} \u0645\u0644\u0641"],
  "slash.rewind.latest": ["latest", "\u0627\u0644\u0623\u062D\u062F\u062B"],
  "slash.rewind.restore": ["Restore", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "slash.rewind.restoring": ["Restoring\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629\u2026"],
  "slash.rewind.restored": ["Checkpoint restored: {label}", "\u0627\u0633\u062A\u064F\u0639\u064A\u062F\u062A \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u062D\u0642\u0642: {label}"],
  "slash.rewind.empty": ["No checkpoints yet \u2014 they are created automatically before edits.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u0642\u0627\u0637 \u062A\u062D\u0642\u0642 \u0628\u0639\u062F \u2014 \u062A\u064F\u0646\u0634\u0623 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0642\u0628\u0644 \u0643\u0644 \u062A\u0639\u062F\u064A\u0644."],
  "slash.rewind.failed": ["Restore failed", "\u0641\u0634\u0644\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "slash.rewind.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  // /share — self-contained HTML report → <workspace>/.surnia/share/
  "slash.share.written": ["Share page saved to {path}", "\u062D\u064F\u0641\u0638\u062A \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0641\u064A {path}"],
  "slash.share.downloaded": ["Share page downloaded (HTML)", "\u0646\u064F\u0632\u0651\u0644\u062A \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629 (HTML)"],
  "slash.share.failed": ["Share export failed", "\u0641\u0634\u0644 \u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u0634\u0627\u0631\u0643\u0629"],
  "slash.share.toolCalls": ["Tool calls", "\u0627\u0633\u062A\u062F\u0639\u0627\u0621\u0627\u062A \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "slash.share.proof": ["Proof & gates", "\u0627\u0644\u0625\u062B\u0628\u0627\u062A \u0648\u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A"],
  "slash.share.noProof": ["No gates ran in this session yet.", "\u0644\u0645 \u062A\u064F\u0646\u0641\u064E\u0651\u0630 \u0623\u064A \u0628\u0648\u0627\u0628\u0629 \u062A\u062D\u0642\u0642 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0628\u0639\u062F."],
  "slash.share.messages": ["Messages", "\u0627\u0644\u0631\u0633\u0627\u0626\u0644"],
  "slash.share.tool": ["tool", "\u0623\u062F\u0627\u0629"],
  // ── v11.12 CHAT CAPABILITIES — /model · /profile · /undo · /continue · /clear ──
  // Every pair is MONOLINGUAL: the EN slot holds EN prose, the AR slot holds AR
  // prose. Command identifiers (/model, /profile…) are neutral tokens, not prose.
  "slash.model.desc": ["Switch the active model \u2014 /model followed by a model name", "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637 \u2014 \u0627\u0643\u062A\u0628 \u200E/model \u062B\u0645 \u0627\u0633\u0645 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "slash.arg.model": ["model name", "\u0627\u0633\u0645 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "slash.model.hint": ["Open the model picker, or type /model followed by a model name.", "\u0627\u0641\u062A\u062D \u0645\u0646\u062A\u0642\u064A \u0627\u0644\u0646\u0645\u0627\u0630\u062C\u060C \u0623\u0648 \u0627\u0643\u062A\u0628 \u200E/model \u062B\u0645 \u0627\u0633\u0645 \u0627\u0644\u0646\u0645\u0648\u0630\u062C."],
  "slash.model.notFound": ['No installed model matches "{q}".', "\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0645\u0648\u0630\u062C \u0645\u062B\u0628\u0651\u062A \u064A\u0637\u0627\u0628\u0642 \xAB{q}\xBB."],
  "slash.model.switched": ["Model switched to {provider}/{model} \u2014 the next run uses it.", "\u062A\u064F\u0628\u062F\u0651\u0644 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0625\u0644\u0649 {provider}/{model} \u2014 \u0633\u064A\u0633\u062A\u062E\u062F\u0645\u0647 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0642\u0627\u062F\u0645."],
  "slash.profile.desc": ["Switch the tool profile (essential | balanced | full)", "\u062A\u0628\u062F\u064A\u0644 \u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A (\u0623\u0633\u0627\u0633\u064A | \u0645\u062A\u0648\u0627\u0632\u0646 | \u0643\u0627\u0645\u0644)"],
  "slash.arg.profile": ["essential|balanced|full", "\u0623\u0633\u0627\u0633\u064A|\u0645\u062A\u0648\u0627\u0632\u0646|\u0643\u0627\u0645\u0644"],
  "slash.profile.current": ["Tool profile: {p} \u2014 choose essential, balanced or full.", "\u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A: {p} \u2014 \u0627\u062E\u062A\u0631 \u0623\u0633\u0627\u0633\u064A\u0627\u064B \u0623\u0648 \u0645\u062A\u0648\u0627\u0632\u0646\u0627\u064B \u0623\u0648 \u0643\u0627\u0645\u0644\u0627\u064B."],
  "slash.profile.bad": ['Unknown tool profile "{p}" \u2014 use essential, balanced or full.', "\u0645\u0644\u0641 \u0623\u062F\u0648\u0627\u062A \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641 \xAB{p}\xBB \u2014 \u0627\u0633\u062A\u062E\u062F\u0645 \u0623\u0633\u0627\u0633\u064A\u0627\u064B \u0623\u0648 \u0645\u062A\u0648\u0627\u0632\u0646\u0627\u064B \u0623\u0648 \u0643\u0627\u0645\u0644\u0627\u064B."],
  "slash.profile.same": ["Tool profile is already {p}.", "\u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u0636\u0628\u0648\u0637 \u0639\u0644\u0649 {p} \u0628\u0627\u0644\u0641\u0639\u0644."],
  "slash.profile.switched": ["Tool profile set to {p} \u2014 the next run advertises the matching tool set.", "\u0636\u064F\u0628\u0637 \u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0639\u0644\u0649 {p} \u2014 \u0633\u064A\u0639\u0631\u0636 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0642\u0627\u062F\u0645 \u0645\u062C\u0645\u0648\u0639\u0629 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0646\u0627\u0633\u0628\u0629."],
  "slash.undo.desc": ["Undo \u2014 restore the newest checkpoint", "\u062A\u0631\u0627\u062C\u0639 \u2014 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0623\u062D\u062F\u062B \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642"],
  "slash.undo.noWorkspace": ["Open a folder first", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B"],
  "slash.undo.bridge": ["Checkpoint restore is unavailable in this build.", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0646\u0642\u0627\u0637 \u0627\u0644\u062A\u062D\u0642\u0642 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  "slash.undo.failedList": ["Could not list checkpoints", "\u062A\u0639\u0630\u0651\u0631 \u0639\u0631\u0636 \u0646\u0642\u0627\u0637 \u0627\u0644\u062A\u062D\u0642\u0642"],
  "slash.undo.restoreFailed": ["Could not restore the checkpoint", "\u062A\u0639\u0630\u0651\u0631\u062A \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u062D\u0642\u0642"],
  "slash.undo.empty": ["No checkpoints to undo \u2014 they are created before edits.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u0642\u0627\u0637 \u062A\u062D\u0642\u0642 \u0644\u0644\u062A\u0631\u0627\u062C\u0639 \u2014 \u062A\u064F\u0646\u0634\u0623 \u0642\u0628\u0644 \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A."],
  "slash.undo.confirm": ['Restore checkpoint "{label}"? Files go back; the conversation stays.', "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u062D\u0642\u0642 \xAB{label}\xBB\u061F \u0633\u062A\u0639\u0648\u062F \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0648\u062A\u0628\u0642\u0649 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629."],
  "slash.undo.restoring": ['Undo \u2014 restoring "{label}" ({n} files)\u2026', "\u062A\u0631\u0627\u062C\u0639 \u2014 \u0627\u0633\u062A\u0639\u0627\u062F\u0629 \xAB{label}\xBB ({n} \u0645\u0644\u0641\u0627\u062A)\u2026"],
  "slash.undo.done": ['Undo complete \u2014 restored "{label}". The conversation is unchanged.', "\u0627\u0643\u062A\u0645\u0644 \u0627\u0644\u062A\u0631\u0627\u062C\u0639 \u2014 \u0627\u0633\u062A\u064F\u0639\u064A\u062F\u062A \xAB{label}\xBB. \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0644\u0645 \u062A\u062A\u063A\u064A\u0631."],
  "slash.continue.desc": ["Continue the last task from where it stopped", "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0623\u062E\u064A\u0631\u0629 \u0645\u0646 \u062D\u064A\u062B \u062A\u0648\u0642\u0641\u062A"],
  "slash.continue.noSession": ["Open a session first", "\u0627\u0641\u062A\u062D \u062C\u0644\u0633\u0629 \u0623\u0648\u0644\u0627\u064B"],
  "slash.continue.busy": ["The agent is busy \u2014 wait for the current run", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u0634\u063A\u0648\u0644 \u2014 \u0627\u0646\u062A\u0638\u0631 \u0627\u0643\u062A\u0645\u0627\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062D\u0627\u0644\u064A"],
  "slash.continue.noTask": ["No previous task to continue", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0645\u0629 \u0633\u0627\u0628\u0642\u0629 \u0644\u0645\u062A\u0627\u0628\u0639\u062A\u0647\u0627"],
  "chat.continue.button": ["Continue", "\u0645\u062A\u0627\u0628\u0639\u0629"],
  "chat.continue.compacted": ["Continue after compaction", "\u0645\u062A\u0627\u0628\u0639\u0629 \u0628\u0639\u062F \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642"],
  "chat.continue.truncated": ["Continue \u2014 the last run stopped early", "\u0645\u062A\u0627\u0628\u0639\u0629 \u2014 \u062A\u0648\u0642\u0641 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0633\u0627\u0628\u0642 \u0645\u0628\u0643\u0631\u0627\u064B"],
  "chat.continue.error": ["Retry the last task", "\u0625\u0639\u0627\u062F\u0629 \u0645\u062D\u0627\u0648\u0644\u0629 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "chat.continue.title": ["Re-send the last task with a continue instruction", "\u0625\u0639\u0627\u062F\u0629 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0623\u062E\u064A\u0631\u0629 \u0645\u0639 \u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0627\u0644\u0645\u062A\u0627\u0628\u0639\u0629"],
  "slash.clear.confirm": ["Start a new session? The current transcript stays saved in Sessions.", "\u0628\u062F\u0621 \u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629\u061F \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u062A\u0628\u0642\u0649 \u0645\u062D\u0641\u0648\u0638\u0629 \u0641\u064A \u0627\u0644\u062C\u0644\u0633\u0627\u062A."],
  "slash.clear.done": ["New session started", "\u0628\u062F\u0623\u062A \u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "slash.help.profile": ["switch the tool profile (essential | balanced | full)", "\u062A\u0628\u062F\u064A\u0644 \u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A (\u0623\u0633\u0627\u0633\u064A | \u0645\u062A\u0648\u0627\u0632\u0646 | \u0643\u0627\u0645\u0644)"],
  "slash.help.undo": ["restore the newest checkpoint", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0623\u062D\u062F\u062B \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642"],
  "slash.help.continue": ["continue the last interrupted task", "\u0645\u062A\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0623\u062E\u064A\u0631\u0629 \u0627\u0644\u0645\u062A\u0648\u0642\u0641\u0629"]
};
Object.assign(D, D_A1_SLASH);
var D_A8_PALETTE = {
  // Checkpoints — open the click-to-restore rewind chooser
  "palette.rewindPicker": ["Checkpoints: rewind the workspace", "\u0646\u0642\u0627\u0637 \u0627\u0644\u062A\u062D\u0642\u0642: \u0625\u0631\u062C\u0627\u0639 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  // Skills rail (08)
  "palette.skills": ["Skills: open the skills panel", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A: \u0641\u062A\u062D \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  // Journals submenu — recent run journals (time · task · outcome)
  "palette.journals": ["Journals: view run journals", "\u0627\u0644\u0633\u062C\u0644\u0651\u0627\u062A: \u0627\u0633\u062A\u0639\u0631\u0627\u0636 \u0633\u062C\u0644\u0651\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "pal.sec.journals": ["Journals", "\u0627\u0644\u0633\u062C\u0644\u0651\u0627\u062A"],
  "pal.journal.back": ["\u2190 Back to commands", "\u2192 \u0631\u062C\u0648\u0639 \u0625\u0644\u0649 \u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "pal.journal.loading": ["Loading journals\u2026", "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0633\u062C\u0644\u0651\u0627\u062A\u2026"],
  "pal.journal.empty": ["No run journals yet", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0633\u062C\u0644\u0651\u0627\u062A \u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F"],
  "pal.journal.failed": ["Could not read the journals", "\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0633\u062C\u0644\u0651\u0627\u062A"],
  "pal.journal.copied": ["Journal path copied to clipboard", "\u0646\u064F\u0633\u062E \u0645\u0633\u0627\u0631 \u0627\u0644\u0633\u062C\u0644 \u0625\u0644\u0649 \u0627\u0644\u062D\u0627\u0641\u0638\u0629"],
  "pal.journal.copyFailed": ["Could not copy the journal path", "\u062A\u0639\u0630\u0651\u0631 \u0646\u0633\u062E \u0645\u0633\u0627\u0631 \u0627\u0644\u0633\u062C\u0644"],
  "pal.journal.outcome.completed": ["completed", "\u0645\u0643\u062A\u0645\u0644\u0629"],
  "pal.journal.outcome.aborted": ["aborted", "\u0623\u064F\u062C\u0647\u0636\u062A"]
};
Object.assign(D, D_A8_PALETTE);
var D_A7_PROOFMV = {
  // verdict chip labels (stamps render uppercase — static vocabulary)
  "proof.mv.killedEnough": ["killed", "\u0623\u064F\u0632\u064A\u0644\u062A"],
  "proof.mv.survivors": ["FAILED \u2014 survivors", "\u0641\u0634\u0644 \u2014 \u0646\u0627\u062C\u0648\u0646"],
  "proof.mv.boundary": ["equiv. mutants", "\u0637\u0641\u0631\u0627\u062A \u0645\u064F\u0643\u0627\u0641\u0650\u0626\u0629"],
  "proof.mv.strongSmall": ["small sample", "\u0639\u064A\u0651\u0646\u0629 \u0635\u063A\u064A\u0631\u0629"],
  "proof.mv.weak": ["inconclusive", "\u063A\u064A\u0631 \u062D\u0627\u0633\u0645"],
  "proof.mv.noMutations": ["nothing to probe", "\u0644\u0627 \u0645\u0627 \u064A\u064F\u062E\u062A\u0628\u0631"],
  "proof.mv.baseline": ["baseline not green", "\u062E\u0637 \u0627\u0644\u0623\u0633\u0627\u0633 \u063A\u064A\u0631 \u0646\u0627\u062C\u062D"],
  "proof.mv.skipped": ["skipped", "\u0645\u064F\u062A\u062E\u0637\u0651\u0627\u0629"],
  // kill-rate sample size ({k} killed of {r} ran) — shows WHY a verdict is
  // 'small sample' (e.g. killed 2/2)
  "proof.mv.sample": ["killed {k}/{r}", "\u0623\u064F\u0632\u064A\u0644\u062A {k}/{r}"],
  // INCONCLUSIVE (no overrule) — info line + strip chip + bilingual tooltip
  "proof.mv.inconcl.line": ["INCONCLUSIVE (no overrule)", "\u063A\u064A\u0631 \u062D\u0627\u0633\u0645 (\u0628\u0644\u0627 \u0646\u0642\u0636)"],
  "proof.mv.inconcl.stamp": ["INCONCLUSIVE", "\u063A\u064A\u0631 \u062D\u0627\u0633\u0645"],
  "proof.mv.inconcl.tip": [
    "the gate found nothing it could judge \u2014 the agent's claim stands",
    "\u0627\u0644\u0628\u0648\u0627\u0628\u0629 \u0644\u0645 \u062A\u062C\u062F \u0645\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062D\u0643\u0645 \u0639\u0644\u064A\u0647 \u2014 \u0627\u062F\u0651\u0627\u0639 \u0627\u0644\u0648\u0643\u064A\u0644 \u0642\u0627\u0626\u0645"
  ]
};
Object.assign(D, D_A7_PROOFMV);
var D_A10_COCKPIT = {
  // 01 — hero identity
  "ck.tagline.latin": ["The agent that must PROVE it is done.", "The agent that must PROVE it is done."],
  "ck.tagline.arabic": ["\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0630\u064A \u064A\u062C\u0628 \u0623\u0646 \u064A\u064F\u062B\u0628\u062A \u0623\u0646\u0647 \u0623\u0646\u0647\u0649.", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0630\u064A \u064A\u062C\u0628 \u0623\u0646 \u064A\u064F\u062B\u0628\u062A \u0623\u0646\u0647 \u0623\u0646\u0647\u0649."],
  "ck.hero.sub": [
    "The cockpit shows what SADEEM actually did \u2014 no decoration, no unverifiable claims.",
    "\u062A\u0639\u0631\u0636 \u0644\u0648\u062D\u0629 \u0627\u0644\u0642\u064A\u0627\u062F\u0629 \u0645\u0627 \u0641\u0639\u0644\u0647 \u0633\u062F\u064A\u0645 \u0641\u0639\u0644\u0627\u064B \u2014 \u0644\u0627 \u0632\u062E\u0631\u0641\u0629 \u0648\u0644\u0627 \u0627\u062F\u0651\u0639\u0627\u0621\u0627\u062A \u0628\u0644\u0627 \u0625\u062B\u0628\u0627\u062A."
  ],
  "ck.hero.verTip": ["Version {v}", "\u0627\u0644\u0625\u0635\u062F\u0627\u0631 {v}"],
  // 02 — honesty strip (section)
  "ck.sec.honesty": ["Honesty", "\u0627\u0644\u0635\u062F\u0642"],
  "ck.sec.honesty.sub": ["What this build will not fake", "\u0645\u0627 \u0644\u0646 \u064A\u0632\u0648\u0651\u0631\u0647 \u0647\u0630\u0627 \u0627\u0644\u0628\u0646\u0627\u0621"],
  // (a) False-Done Rate — api.metricsHonesty()
  "ck.fd.label": ["False-Done Rate", "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u0646\u062C\u0627\u0632 \u0627\u0644\u0632\u0627\u0626\u0641"],
  "ck.fd.noData": ["No data yet", "\u0644\u0627 \u0628\u064A\u0627\u0646\u0627\u062A \u0628\u0639\u062F"],
  "ck.fd.noData.sub": [
    "No run has claimed success yet \u2014 the ledger starts with your first run.",
    "\u0644\u0645 \u062A\u062F\u0651\u0639\u064A \u0623\u064A \u062C\u0648\u0644\u0629 \u0627\u0644\u0646\u062C\u0627\u062D \u0628\u0639\u062F \u2014 \u064A\u0628\u062F\u0623 \u0627\u0644\u0633\u062C\u0644 \u0628\u0623\u0648\u0644 \u062C\u0648\u0644\u0629 \u0644\u0643."
  ],
  "ck.fd.of": ["{n} of {m} claimed runs overruled", "{n} \u0645\u0646 {m} \u062C\u0648\u0644\u0629 \u0627\u062F\u0651\u0639\u062A \u0627\u0644\u0646\u062C\u0627\u062D \u0623\u064F\u0633\u0642\u0637\u062A"],
  "ck.fd.hint": ["Career-long ledger \u2014 claimed success overruled by the proof gates", "\u0633\u062C\u0644 \u062F\u0627\u0626\u0645 \u2014 \u0627\u062F\u0651\u0639\u0627\u0621\u0627\u062A \u0627\u0644\u0646\u062C\u0627\u062D \u0627\u0644\u062A\u064A \u0623\u0633\u0642\u0637\u062A\u0647\u0627 \u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  // (b) Last proof verdict — store.proof (read-only)
  "ck.pv.label": ["Last proof verdict", "\u0622\u062E\u0631 \u062D\u0643\u0645 \u0625\u062B\u0628\u0627\u062A"],
  "ck.pv.none": ["No verdict yet", "\u0644\u0627 \u062D\u0643\u0645 \u0628\u0639\u062F"],
  "ck.pv.none.sub": [
    "Reports here after the first proof event of this session.",
    "\u064A\u0638\u0647\u0631 \u0647\u0646\u0627 \u0628\u0639\u062F \u0623\u0648\u0644 \u062D\u062F\u062B \u0625\u062B\u0628\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629."
  ],
  "ck.pv.gates": ["{n} gates recorded this session", "{n} \u0628\u0648\u0627\u0628\u0629 \u0645\u0633\u062C\u0651\u0644\u0629 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  // (c) Journals — api.journalList(50)
  "ck.jr.label": ["Journals \xB7 7 days", "\u0627\u0644\u0633\u062C\u0644\u0627\u062A \xB7 \u0667 \u0623\u064A\u0627\u0645"],
  "ck.jr.total": ["{n} runs", "{n} \u062C\u0648\u0644\u0629"],
  "ck.jr.split": ["{c} completed \xB7 {u} unfinished", "{c} \u0645\u0643\u062A\u0645\u0644\u0629 \xB7 {u} \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629"],
  "ck.jr.none": ["No runs in the last 7 days", "\u0644\u0627 \u062C\u0648\u0644\u0627\u062A \u0641\u064A \u0622\u062E\u0631 \u0667 \u0623\u064A\u0627\u0645"],
  "ck.jr.none.sub": ["Run journals are written on this machine as runs happen.", "\u062A\u064F\u0643\u062A\u0628 \u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062C\u0648\u0644\u0627\u062A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0645\u0639 \u0643\u0644 \u062C\u0648\u0644\u0629."],
  "ck.jr.hint": ["Newest {n} journals on this machine", "\u0623\u062D\u062F\u062B {n} \u0633\u062C\u0644 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  // 03 — quick actions (existing store behaviors only)
  "ck.sec.actions": ["Quick actions", "\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0633\u0631\u064A\u0639\u0629"],
  "ck.qa.diff": ["Run /diff", "\u0646\u0641\u0651\u0630 \u200E/diff"],
  "ck.qa.diff.sub": ["Working-tree diff via the /diff slash flow \u2014 asks for a folder first", "\u0641\u0631\u0642 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0639\u0628\u0631 \u0623\u0645\u0631 \u200E/diff \u2014 \u064A\u0637\u0644\u0628 \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B"],
  "ck.qa.skills": ["Skills", "\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A"],
  "ck.qa.skills.sub": ["Open the Skills rail \u2014 what the agent can do", "\u0627\u0641\u062A\u062D \u0634\u0631\u064A\u0637 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u2014 \u0645\u0627 \u064A\u0633\u062A\u0637\u064A\u0639\u0647 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "ck.qa.settings": ["Settings", "\u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  "ck.qa.settings.sub": ["Open the settings modal", "\u0627\u0641\u062A\u062D \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A"],
  // 04 — recents
  "ck.sec.recents": ["Recent projects", "\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "ck.recent.sub": ["Pick up where you left off", "\u0623\u0643\u0645\u0644 \u0645\u0646 \u062D\u064A\u062B \u062A\u0648\u0642\u0641\u062A"],
  "ck.recent.empty.sub": ["Open a folder \u2014 it will be listed here honestly.", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u2014 \u0633\u064A\u064F\u062F\u0631\u062C \u0647\u0646\u0627 \u0628\u0635\u062F\u0642."],
  // loading + footer
  "ck.loading": ["Reading the honest ledger\u2026", "\u062C\u0627\u0631\u064D \u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644 \u0627\u0644\u0635\u062F\u0642\u2026"],
  "ck.error.sub": ["The ledger could not be read \u2014 nothing is claimed.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0633\u062C\u0644 \u2014 \u0644\u0627 \u0627\u062F\u0651\u0639\u0627\u0621\u0627\u062A."],
  "ck.footer.ledger": ["Every number on this page comes from a real ledger on this machine.", "\u0643\u0644 \u0631\u0642\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629 \u064A\u0623\u062A\u064A \u0645\u0646 \u0633\u062C\u0644 \u062D\u0642\u064A\u0642\u064A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632."]
};
Object.assign(D, D_A10_COCKPIT);
var D_A9_JOURNAL = {
  // section header + controls
  "jn.title": ["Run journals", "\u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "jn.refresh": ["Refresh journals", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0633\u062C\u0644\u0627\u062A"],
  // empty / failed states
  "jn.none": ["No run journals yet", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0633\u062C\u0644\u0627\u062A \u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F"],
  "jn.failed": ["Could not read journals", "\u062A\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0633\u062C\u0644\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "jn.noTask": ["(untitled run)", "(\u062A\u0634\u063A\u064A\u0644 \u0628\u0644\u0627 \u0639\u0646\u0648\u0627\u0646)"],
  // outcome stamps (UPPERCASE voice is applied by .stamp CSS)
  "jn.st.done": ["Completed", "\u0645\u0643\u062A\u0645\u0644"],
  "jn.st.aborted": ["Aborted", "\u0623\u064F\u062C\u0647\u0636"],
  "jn.st.unfinished": ["Unfinished", "\u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644"],
  // UNFINISHED resume note (warn tone, shown in the expanded row)
  "jn.unfinishedNote": [
    "The run was killed or crashed \u2014 resume by starting a new session with the same task.",
    "\u0642\u064F\u062A\u0644 \u0647\u0630\u0627 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0623\u0648 \u0627\u0646\u0647\u0627\u0631 \u2014 \u0627\u0633\u062A\u0623\u0646\u0641 \u0628\u0641\u062A\u062D \u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629 \u0628\u0627\u0644\u0645\u0647\u0645\u0629 \u0646\u0641\u0633\u0647\u0627."
  ],
  // row meta
  "jn.evCount": ["{n} ev", "{n} \u062D\u062F\u062B"],
  // expanded timeline
  "jn.timeline": ["Event timeline", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A \u0644\u0644\u0623\u062D\u062F\u0627\u062B"],
  "jn.shown": ["showing {a} of ~{b}", "\u064A\u064F\u0639\u0631\u0636 {a} \u0645\u0646 ~{b}"],
  "jn.loading": ["Loading events\u2026", "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0623\u062D\u062F\u0627\u062B\u2026"],
  "jn.emptyEvents": ["No events recorded", "\u0644\u0627 \u0623\u062D\u062F\u0627\u062B \u0645\u0633\u062C\u0651\u0644\u0629"],
  "jn.more": ["Load 100 more", "\u062D\u0645\u0651\u0644 100 \u0625\u0636\u0627\u0641\u064A\u0629"],
  "jn.evFailed": ["Could not read the journal", "\u062A\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0633\u062C\u0644"],
  // timeline row labels (journal event types)
  "jn.ev.start": ["run start", "\u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "jn.ev.continue": ["continue \xB7 round {n}", "\u0627\u0633\u062A\u0645\u0631\u0627\u0631 \xB7 \u062C\u0648\u0644\u0629 {n}"],
  "jn.ev.continuePlain": ["continue", "\u0627\u0633\u062A\u0645\u0631\u0627\u0631"],
  "jn.ev.finish": ["finish", "\u0646\u0647\u0627\u064A\u0629"],
  "jn.ev.finishOutcome": ["finish \xB7 {o}", "\u0646\u0647\u0627\u064A\u0629 \xB7 {o}"],
  "jn.ev.event": ["event", "\u062D\u062F\u062B"]
};
Object.assign(D, D_A9_JOURNAL);
var D_A5_USAGE = {
  // context bar / ring — exact numbers + honesty markers
  "sb.ring.ctxOfExact": ["{a}{u} / {l} tokens ({p}%)", "{a}{u} / {l} \u0631\u0645\u0632\u0627\u064B ({p}%)"],
  "sb.ring.streamingEst": [
    "Live estimate (chars/4) \u2014 exact on completion",
    "\u062A\u0642\u062F\u064A\u0631 \u062D\u064A\u0651 (\u062D\u0631\u0648\u0641/4) \u2014 \u064A\u064F\u0633\u062A\u0628\u062F\u0644 \u0628\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u062F\u0642\u064A\u0642 \u0639\u0646\u062F \u0627\u0644\u0627\u0643\u062A\u0645\u0627\u0644"
  ],
  "sb.ring.ctxDefault": [
    "Window unknown for this model \u2014 200k default",
    "\u062D\u062C\u0645 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u062F\u064A\u0644 \u2014 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A 200 \u0623\u0644\u0641"
  ],
  // Usage tab — per-message billing rows + reconciliation + attempts
  "usage.perMsg": ["Messages \u2014 tokens & cost", "\u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u2014 \u0627\u0644\u0631\u0645\u0648\u0632 \u0648\u0627\u0644\u062A\u0643\u0644\u0641\u0629"],
  "usage.perMsgEmpty": [
    "No billed turns yet \u2014 rows appear when a reply completes",
    "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u062D\u0627\u062F\u062B\u0627\u062A \u0645\u064F\u062D\u0627\u0633\u064E\u0628\u0629 \u0628\u0639\u062F \u2014 \u062A\u0638\u0647\u0631 \u0627\u0644\u0635\u0641\u0648\u0641 \u0639\u0646\u062F \u0627\u0643\u062A\u0645\u0627\u0644 \u0643\u0644 \u0631\u062F"
  ],
  "usage.reconciled": [
    "Reconciled \u2014 {n} billing rows sum to the session total",
    "\u0645\u0637\u0627\u0628\u064E\u0642\u0629 \u2014 \u0645\u062C\u0645\u0648\u0639 {n} \u0635\u0641\u0651\u0627\u064B \u064A\u0633\u0627\u0648\u064A \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062C\u0644\u0633\u0629"
  ],
  "usage.estMark": ["estimated (no provider usage reported)", "\u062A\u0642\u062F\u064A\u0631\u064A (\u0644\u0645 \u064A\u0628\u0644\u063A \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0639\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645)"],
  "usage.attemptN": ["attempt {n}", "\u0645\u062D\u0627\u0648\u0644\u0629 {n}"],
  "usage.attemptsN": ["{n} attempts", "{n} \u0645\u062D\u0627\u0648\u0644\u0627\u062A"],
  "usage.cacheRead": ["Cache-read tokens", "\u0631\u0645\u0648\u0632 \u0645\u0642\u0631\u0648\u0621\u0629 \u0645\u0646 \u0627\u0644\u0643\u0627\u0634"],
  "usage.cacheReadShort": ["cache", "\u0643\u0627\u0634"],
  "usage.moreRows": ["older rows \xB7 total this session:", "\u0635\u0641\u0648\u0641 \u0623\u0642\u062F\u0645 \xB7 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062C\u0644\u0633\u0629:"]
};
Object.assign(D, D_A5_USAGE);
var D_A9_DESIGN = {
  // ── Proof Center explained in plain language ──
  // One sentence, no jargon, shown on the ribbon (tooltip) and FIRST inside
  // the evidence popover. Arabic phrasing per the founder's own words.
  "proof.explainer": [
    "Proof Center in one line: it proves that what the assistant said actually happened \u2014 commands ran, tests passed, files changed \u2014 evidence, not promises.",
    "\u062F\u0644\u064A\u0644 \u0627\u0644\u0625\u0646\u062C\u0627\u0632 \u2014 \u064A\u064F\u062B\u0628\u062A \u0623\u0646 \u0645\u0627 \u0642\u0627\u0644\u0647 \u0627\u0644\u0645\u0633\u0627\u0639\u062F \u062D\u062F\u062B \u0641\u0639\u0644\u0627\u064B: \u0623\u0648\u0627\u0645\u0631 \u0646\u064F\u0641\u0651\u0630\u062A\u060C \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0646\u062C\u062D\u062A\u060C \u0645\u0644\u0641\u0627\u062A \u062A\u063A\u064A\u0651\u0631\u062A \u2014 \u0628\u0627\u0644\u0623\u062F\u0644\u0629 \u0644\u0627 \u0628\u0627\u0644\u0648\u0639\u0648\u062F."
  ],
  // at-a-glance evidence-kind chips (ProofRibbon) + their hover tooltips
  "proof.kind.cmd": ["command ran", "\u0623\u0645\u0631 \u0646\u064F\u0641\u0651\u0630"],
  "proof.kind.cmd.tip": ["a verify command actually executed on this machine", "\u0623\u0645\u0631 \u062A\u062D\u0642\u0642 \u0646\u064F\u0641\u0651\u0630 \u0641\u0639\u0644\u0627\u064B \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "proof.kind.tests": ["tests passed", "\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0646\u062C\u062D\u062A"],
  "proof.kind.tests.tip": ["test gates returned real red\u2192green verdicts", "\u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0623\u0639\u0627\u062F\u062A \u0623\u062D\u0643\u0627\u0645 \u062D\u0645\u0631\u0627\u0621\u2192\u062E\u0636\u0631\u0627\u0621 \u062D\u0642\u064A\u0642\u064A\u0629"],
  "proof.kind.receipt": ["run receipt", "\u0625\u064A\u0635\u0627\u0644 \u062A\u0634\u063A\u064A\u0644"],
  "proof.kind.receipt.tip": ["the run left an auditable receipt", "\u062A\u0631\u0643 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0625\u064A\u0635\u0627\u0644\u0627\u064B \u0642\u0627\u0628\u0644\u0627\u064B \u0644\u0644\u062A\u062F\u0642\u064A\u0642"]
  // ── empty-state captions (personality, one line each) ──
};
Object.assign(D, D_A9_DESIGN);
var D_V1112 = {
  "rail.subagents": ["Subagents", "\u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u0648\u0646"],
  "rail.signature": ["Run Intelligence", "\u0627\u0633\u062A\u062E\u0628\u0627\u0631\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "rail.proof": ["Proof Center", "\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  // v11.43 — mention-in-plus, proof center, skills auto-use.
  "chat.mention.count.v1143": ["{n} files", "{n} \u0645\u0644\u0641"],
  "chat.mention.empty.v1143": ["No matching files", "\u0644\u0627 \u0645\u0644\u0641\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629"],
  "chat.mention.file.v1143": ["Mention a workspace file", "\u0627\u0633\u062A\u0634\u0647\u0627\u062F \u0628\u0645\u0644\u0641 \u0645\u0646 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "chat.mention.files.v1143": ["Workspace files", "\u0645\u0644\u0641\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "chat.mention.filter.v1143": ["Filter files\u2026", "\u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062A\u2026"],
  "proof.openCenter": ["Copy proof summary and open the Proof Center", "\u0646\u0633\u062E \u0645\u0644\u062E\u0635 \u0627\u0644\u0625\u062B\u0628\u0627\u062A \u0648\u0641\u062A\u062D \u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "skills.autoUseInfo": ["AUTO-USE: every skill you add is advertised to the AI on the next run \u2014 it loads the most relevant one FIRST and follows ALL its steps. Press USE to force a specific skill.", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062A\u0644\u0642\u0627\u0626\u064A: \u0643\u0644 \u0645\u0647\u0627\u0631\u0629 \u062A\u0636\u064A\u0641\u0647\u0627 \u062A\u064F\u0639\u0631\u0636 \u0644\u0644\u0630\u0643\u0627\u0621 \u0641\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A \u2014 \u064A\u062D\u0645\u0651\u0644 \u0627\u0644\u0623\u0646\u0633\u0628 \u0623\u0648\u0644\u0627\u064B \u0648\u064A\u062A\u0651\u0628\u0639 \u0643\u0644 \u062E\u0637\u0648\u0627\u062A\u0647. \u0627\u0636\u063A\u0637 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0644\u0641\u0631\u0636 \u0645\u0647\u0627\u0631\u0629 \u0645\u062D\u062F\u062F\u0629."],
  "account.open": ["Account & sign in", "\u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644"],
  "usage.provRates": ["Resolver rates - USD per 1M tokens", "\u0623\u0633\u0639\u0627\u0631 \u0627\u0644\u0645\u062D\u0644\u0651\u0644 \u2014 \u062F\u0648\u0644\u0627\u0631 \u0644\u0643\u0644 \u0645\u0644\u064A\u0648\u0646 \u062A\u0648\u0643\u0646"],
  // v11.42 — fleet handoff keys (DNA insights, flows, effort, skills, slash, settings, usage).
  "chat.effort.engine": ["Engine step budget", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0651\u0643"],
  "dna.insights.title": ["DNA INSIGHTS", "\u0631\u0624\u0649 \u0627\u0644\u062D\u0645\u0636"],
  "dna.insights.tip": ["Read-only explanation of the same stored DNA, plus prompt visibility.", "\u0634\u0631\u062D \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637 \u0644\u0646\u0641\u0633 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062D\u0645\u0636 \u0627\u0644\u0645\u062E\u0632\u0651\u0646\u0629\u060C \u0645\u0639 \u0638\u0647\u0648\u0631\u0647\u0627 \u0641\u064A \u0627\u0644\u0645\u0648\u062C\u0651\u0647."],
  "dna.insights.promptTip": ["Patterns the real prompt builder will inject into the next run", "\u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u062A\u064A \u0633\u064A\u062D\u0642\u0646\u0647\u0627 \u0628\u0627\u0646\u064A \u0627\u0644\u0645\u0648\u062C\u0651\u0647 \u0641\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0642\u0627\u062F\u0645"],
  "dna.insights.inPrompt": ["in prompt", "\u0641\u064A \u0627\u0644\u0645\u0648\u062C\u0651\u0647"],
  "dna.insights.empty": ["No learned facts are stored yet. DNA grows only from observed runs and your explicit feedback.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0642\u0627\u0626\u0642 \u0645\u062A\u0639\u0644\u0651\u0645\u0629 \u0628\u0639\u062F. \u064A\u0646\u0645\u0648 \u0627\u0644\u062D\u0645\u0636 \u0645\u0646 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0645\u0631\u0635\u0648\u062F\u0629 \u0648\u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643 \u0627\u0644\u0635\u0631\u064A\u062D\u0629 \u0641\u0642\u0637."],
  "dna.insights.caveat": ["Advisory only. Each explanation is derived from stored fields; it is not a claim the AI made about itself.", "\u0644\u0644\u0625\u0631\u0634\u0627\u062F \u0641\u0642\u0637. \u0643\u0644 \u062A\u0641\u0633\u064A\u0631 \u0645\u0634\u062A\u0642 \u0645\u0646 \u062D\u0642\u0648\u0644 \u0645\u062E\u0632\u0651\u0646\u0629\u060C \u0648\u0644\u064A\u0633 \u0627\u062F\u0651\u0639\u0627\u0621\u064B \u0645\u0646 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0639\u0646 \u0646\u0641\u0633\u0647."],
  "flows.how.title": ["How a flow works", "\u0643\u064A\u0641 \u064A\u0639\u0645\u0644 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.how.s1": ["Type the same prompt several times \u2014 it appears under \u201CRepeated prompts\u201D.", "\u0627\u0643\u062A\u0628 \u0627\u0644\u0637\u0644\u0628 \u0646\u0641\u0633\u0647 \u0639\u062F\u0629 \u0645\u0631\u0627\u062A \u2014 \u064A\u0638\u0647\u0631 \u062A\u062D\u062A \xAB\u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0645\u062A\u0643\u0631\u0631\u0629\xBB."],
  "flows.how.s2": ["Save it as a flow with a clear name (global or this project).", "\u0627\u062D\u0641\u0638\u0647 \u0643\u0645\u0633\u0627\u0631 \u0628\u0627\u0633\u0645 \u0648\u0627\u0636\u062D (\u0639\u0627\u0645 \u0623\u0648 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639)."],
  "flows.how.s3": ["Press Run: it sends the exact prompt in your chat, and records the run only after the turn settles.", "\u0627\u0636\u063A\u0637 Run: \u064A\u064F\u0631\u0633\u0644 \u0627\u0644\u0646\u0635 \u0627\u0644\u062D\u0631\u0641\u064A \u0641\u064A \u0645\u062D\u0627\u062F\u062B\u062A\u0643\u060C \u0648\u064A\u064F\u0633\u062C\u064E\u0651\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u062F\u0648\u0631 \u0641\u0642\u0637."],
  "flows.run.flow": ["Run flow", "\u0634\u063A\u0651\u0644 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.run.finished": ["Flow finished \u2014 run recorded", "\u0627\u0643\u062A\u0645\u0644 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0633\u0627\u0631 \u2014 \u0633\u064F\u062C\u0651\u0644"],
  "flows.run.title": ["Send the saved prompt verbatim in the chat; the run is recorded only after the turn ends.", "\u0623\u0631\u0633\u0644 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u062D\u0641\u0648\u0638 \u062D\u0631\u0641\u064A\u0627\u064B \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629\u060C \u0648\u064A\u064F\u0633\u062C\u064E\u0651\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0628\u0639\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u062F\u0648\u0631."],
  "flows.empty.tip": ["Tip: type the same prompt 3 times and a suggestion appears above.", "\u0646\u0635\u064A\u062D\u0629: \u0627\u0643\u062A\u0628 \u0646\u0641\u0633 \u0627\u0644\u0637\u0644\u0628 \u0663 \u0645\u0631\u0627\u062A \u0648\u0633\u064A\u0638\u0647\u0631 \u0645\u0642\u062A\u0631\u062D\u0627\u064B \u0641\u064A \u0627\u0644\u0623\u0639\u0644\u0649."],
  "settings.agent.subagents.title.v1142": ["Subagents", "\u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u0648\u0646"],
  "settings.agent.subagents.maxConcurrent.v1142": ["Max concurrent subagents", "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u064A\u0646 \u0628\u0627\u0644\u062A\u0648\u0627\u0632\u064A"],
  "settings.agent.subagents.maxConcurrent.hint.v1142": ["1\u201364. A hard ceiling prevents runaway spawning; lower it to suit your machine.", "\u0661\u2013\u0666\u0664. \u0633\u0642\u0641 \u0635\u0627\u0631\u0645 \u064A\u0645\u0646\u0639 \u0627\u0644\u062A\u0643\u0627\u062B\u0631 \u0627\u0644\u062C\u0627\u0645\u062D\u061B \u062E\u0641\u0651\u0636\u0647 \u062D\u0633\u0628 \u0642\u062F\u0631\u0627\u062A \u062C\u0647\u0627\u0632\u0643."],
  "settings.agent.subagents.honest.v1142": ["A real ceiling, not unlimited", "\u0633\u0642\u0641 \u062D\u0642\u064A\u0642\u064A\u060C \u0644\u064A\u0633 \u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F"],
  "skills.add": ["Add skill", "\u0625\u0636\u0627\u0641\u0629 \u0645\u0647\u0627\u0631\u0629"],
  "skills.add.menu": ["Ways to add a skill", "\u0637\u0631\u0642 \u0625\u0636\u0627\u0641\u0629 \u0645\u0647\u0627\u0631\u0629"],
  "slash.v1142.commands": ["Commands", "\u0627\u0644\u0623\u0648\u0627\u0645\u0631"],
  "usage.reconciledTokens": ["Reconciled \u2014 {n} billing rows sum to the session token total", "\u0645\u064F\u0637\u0627\u0628\u0642 \u2014 {n} \u0635\u0641\u0648\u0641 \u0641\u0627\u062A\u0648\u0631\u0629 \u0645\u062C\u0645\u0648\u0639\u0647\u0627 \u0625\u062C\u0645\u0627\u0644\u064A \u062A\u0648\u0643\u0646 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "usage.todayEstimate": ["\u2248 includes turns the provider did not report usage for \u2014 not exact figures.", "\u2248 \u062A\u0634\u0645\u0644 \u0637\u0644\u0628\u0627\u062A \u0644\u0645 \u064A\u0628\u0644\u063A \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0639\u0646 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647\u0627 \u2014 \u0644\u064A\u0633\u062A \u0623\u0631\u0642\u0627\u0645\u0627\u064B \u062F\u0642\u064A\u0642\u0629."],
  "sa.title": ["Subagents", "\u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u0648\u0646"],
  "sa.desc": ["Every specialist launched by the agent \u2014 live progress, outcomes and one-click retry.", "\u0643\u0644 \u0648\u0643\u064A\u0644 \u0645\u062A\u062E\u0635\u0635 \u0623\u0637\u0644\u0642\u0647 \u0627\u0644\u0648\u0643\u064A\u0644 \u2014 \u062A\u0642\u062F\u0645 \u0645\u0628\u0627\u0634\u0631 \u0648\u0646\u062A\u0627\u0626\u062C \u0648\u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0628\u0646\u0642\u0631\u0629 \u0648\u0627\u062D\u062F\u0629."],
  "sa.refresh": ["Refresh", "\u062A\u062D\u062F\u064A\u062B"],
  "sa.clear": ["Clear history", "\u0645\u0633\u062D \u0627\u0644\u0633\u062C\u0644"],
  "sa.total": ["TOTAL", "\u0627\u0644\u0645\u062C\u0645\u0648\u0639"],
  "sa.running": ["RUNNING", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sa.done": ["DONE", "\u0645\u0643\u062A\u0645\u0644"],
  "sa.failed": ["FAILED", "\u0641\u0634\u0644"],
  "sa.filter.all": ["ALL", "\u0627\u0644\u0643\u0644"],
  "sa.filter.running": ["RUNNING", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sa.filter.done": ["DONE", "\u0645\u0643\u062A\u0645\u0644"],
  "sa.filter.error": ["FAILED", "\u0641\u0634\u0644"],
  "sa.loading": ["Loading subagents\u2026", "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0648\u0643\u0644\u0627\u0621\u2026"],
  "sa.emptyTitle": ["No subagents yet", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0648\u0643\u0644\u0627\u0621 \u0641\u0631\u0639\u064A\u0648\u0646 \u0628\u0639\u062F"],
  "sa.emptySub": ["When the agent delegates a task (the `task` tool), its live progress appears here.", "\u0639\u0646\u062F\u0645\u0627 \u064A\u0641\u0648\u0651\u0636 \u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u0647\u0645\u0629 (\u0623\u062F\u0627\u0629 `task`) \u064A\u0638\u0647\u0631 \u062A\u0642\u062F\u0645\u0647\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631 \u0647\u0646\u0627."],
  "sa.running.st": ["RUNNING", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sa.done.st": ["DONE", "\u0645\u0643\u062A\u0645\u0644"],
  "sa.error.st": ["ERROR", "\u062E\u0637\u0623"],
  "sa.aborted.st": ["ABORTED", "\u0623\u064F\u0644\u063A\u064A"],
  "sa.prompt": ["Prompt", "\u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "sa.retry": ["Retry", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629"],
  // v11.12 polish — agent-team card + dedicated detail view + composer chips
  "sa.team": ["AGENT TEAM", "\u0641\u0631\u064A\u0642 \u0627\u0644\u0648\u0643\u0644\u0627\u0621"],
  "sa.specialist": ["specialist", "\u0648\u0643\u064A\u0644"],
  "sa.specialists": ["specialists", "\u0648\u0643\u0644\u0627\u0621"],
  "sa.outputs": ["outputs", "\u0645\u062E\u0631\u062C\u0627\u062A"],
  "sad.title": ["Subagent detail", "\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0641\u0631\u0639\u064A"],
  "sa.openDetail": ["Open", "\u0641\u062A\u062D"],
  "sad.eyebrow": ["SUBAGENT / DETAIL", "\u0648\u0643\u064A\u0644 \u0641\u0631\u0639\u064A / \u062A\u0641\u0627\u0635\u064A\u0644"],
  "sad.loading": ["Loading\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "sad.notFound": ["This subagent is no longer in the ledger.", "\u0644\u0645 \u064A\u0639\u062F \u0647\u0630\u0627 \u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u0648\u062C\u0648\u062F\u064B\u0627 \u0641\u064A \u0627\u0644\u0633\u062C\u0644."],
  "sad.launched": ["Delegated to {role}", "\u0641\u064F\u0648\u0651\u0636 \u0625\u0644\u0649 {role}"],
  "sad.step": ["Step {n} of {total}", "\u0627\u0644\u062E\u0637\u0648\u0629 {n} \u0645\u0646 {total}"],
  "sad.failed": ["Subagent failed", "\u0641\u0634\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0641\u0631\u0639\u064A"],
  "sad.finished": ["Finished \xB7 {n} steps", "\u0627\u0643\u062A\u0645\u0644 \xB7 {n} \u062E\u0637\u0648\u0629"],
  "sad.waiting": ["Waiting for the next step\u2026", "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062E\u0637\u0648\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629\u2026"],
  "sad.duration": ["DURATION", "\u0627\u0644\u0645\u062F\u0629"],
  "sad.steps": ["STEPS", "\u0627\u0644\u062E\u0637\u0648\u0627\u062A"],
  "sad.progress": ["PROGRESS", "\u0627\u0644\u062A\u0642\u062F\u0645"],
  "sad.prompt": ["Prompt", "\u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "sad.noPrompt": ["(no prompt recorded)", "(\u0644\u0627 \u064A\u0648\u062C\u062F \u062A\u0648\u062C\u064A\u0647 \u0645\u0633\u062C\u0651\u0644)"],
  "sad.timeline": ["Timeline", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A"],
  "sad.events": ["events", "\u0623\u062D\u062F\u0627\u062B"],
  "sad.output": ["Output", "\u0627\u0644\u0646\u062A\u064A\u062C\u0629"],
  "sad.noOutput": ["(no output)", "(\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0627\u062A\u062C)"],
  "sad.pending": ["(still running \u2014 output arrives on completion)", "(\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u062A\u0638\u0647\u0631 \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0639\u0646\u062F \u0627\u0644\u0627\u0643\u062A\u0645\u0627\u0644)"],
  "comp.agents": ["agents", "\u0648\u0643\u0644\u0627\u0621"],
  "comp.agents2.tip": ["Insert an instruction to delegate to 2 specialist agents", "\u0623\u062F\u0631\u062C \u062A\u0648\u062C\u064A\u0647\u064B\u0627 \u0644\u062A\u0641\u0648\u064A\u0636 \u0645\u0647\u0645\u0629 \u0625\u0644\u0649 \u0648\u0643\u064A\u0644\u064A\u0646 \u0645\u062A\u062E\u0635\u0635\u064A\u0646"],
  "comp.agents3.tip": ["Insert an instruction to delegate to 3 specialist agents", "\u0623\u062F\u0631\u062C \u062A\u0648\u062C\u064A\u0647\u064B\u0627 \u0644\u062A\u0641\u0648\u064A\u0636 \u0645\u0647\u0645\u0629 \u0625\u0644\u0649 \u062B\u0644\u0627\u062B\u0629 \u0648\u0643\u0644\u0627\u0621 \u0645\u062A\u062E\u0635\u0635\u064A\u0646"],
  "pb.tip": ["The agent rewrites this field guide after every run and injects it into the next one.", "\u064A\u0639\u064A\u062F \u0627\u0644\u0648\u0643\u064A\u0644 \u0643\u062A\u0627\u0628\u0629 \u0647\u0630\u0627 \u0627\u0644\u062F\u0644\u064A\u0644 \u0628\u0639\u062F \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u0648\u064A\u062D\u0642\u0646\u0647 \u0641\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A."],
  "pb.title": ["LIVING PLAYBOOK", "\u0627\u0644\u062F\u0644\u064A\u0644 \u0627\u0644\u062D\u064A\u0651"],
  "pb.sub": ["Learned from real runs \xB7 injected into the next run", "\u0645\u0633\u062A\u062E\u0644\u0635 \u0645\u0646 \u062A\u0634\u063A\u064A\u0644\u0627\u062A \u062D\u0642\u064A\u0642\u064A\u0629 \xB7 \u064A\u064F\u062D\u0642\u0646 \u0641\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u062A\u0627\u0644\u064A"],
  "pb.version": ["Evolution version", "\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062A\u0637\u0648\u0631"],
  "pb.countTip": ["Learned lessons", "\u0627\u0644\u062F\u0631\u0648\u0633 \u0627\u0644\u0645\u0633\u062A\u0641\u0627\u062F\u0629"],
  "pb.learned": ["SADEEM learned", "\u062A\u0639\u0644\u0651\u0645 \u0633\u062F\u064A\u0645"],
  "pb.empty": ["The playbook grows after your first completed run.", "\u064A\u0646\u0645\u0648 \u0627\u0644\u062F\u0644\u064A\u0644 \u0628\u0639\u062F \u0623\u0648\u0644 \u062A\u0634\u063A\u064A\u0644 \u0645\u0643\u062A\u0645\u0644."],
  "pb.timeline": ["Evolution timeline", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A \u0644\u0644\u062A\u0637\u0648\u0631"],
  "pb.noHistory": ["No revisions yet \u2014 each learning step creates a version here.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0631\u0627\u062C\u0639\u0627\u062A \u0628\u0639\u062F \u2014 \u0643\u0644 \u062E\u0637\u0648\u0629 \u062A\u0639\u0644\u0651\u0645 \u062A\u0646\u0634\u0626 \u0625\u0635\u062F\u0627\u0631\u0627\u064B \u0647\u0646\u0627."],
  "pb.forget": ["Forget playbook", "\u0646\u0633\u064A\u0627\u0646 \u0627\u0644\u062F\u0644\u064A\u0644"]
};
Object.assign(D, D_V1112);
var D_V1113 = {
  // slash menu descriptions + argument hints
  "slash.cmd.diff.desc": ["Show a unified diff of uncommitted changes (optional path)", "\u0639\u0631\u0636 \u0641\u0631\u0642 \u0645\u0648\u062D\u0651\u062F \u0644\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0645\u0648\u062F\u0639\u0629 (\u0645\u0633\u0627\u0631 \u0627\u062E\u062A\u064A\u0627\u0631\u064A)"],
  "slash.cmd.test.desc": ["Run the test command with a real exit-code verdict", "\u062A\u0634\u063A\u064A\u0644 \u0623\u0645\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0639 \u0646\u062A\u064A\u062C\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0646 \u0631\u0645\u0632 \u0627\u0644\u062E\u0631\u0648\u062C"],
  "slash.cmd.explain.desc": ["Read a file and explain it in your language", "\u0642\u0631\u0627\u0621\u0629 \u0645\u0644\u0641 \u0648\u0634\u0631\u062D\u0647 \u0628\u0644\u063A\u062A\u0643"],
  "slash.cmd.skills.desc": ["Toggle skill injection or list workspace skills", "\u062A\u0628\u062F\u064A\u0644 \u062D\u0642\u0646 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0623\u0648 \u0639\u0631\u0636 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "slash.cmd.mcp.desc": ["List MCP servers or test one by id", "\u0639\u0631\u0636 \u062E\u0648\u0627\u062F\u0645 MCP \u0623\u0648 \u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u062D\u062F\u0647\u0627 \u0628\u0627\u0644\u0645\u0639\u0631\u0641"],
  "slash.cmd.budget.desc": ["Show real token and cost totals for this session", "\u0639\u0631\u0636 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0631\u0645\u0648\u0632 \u0648\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "slash.arg.path": ["path", "\u0627\u0644\u0645\u0633\u0627\u0631"],
  "slash.arg.command": ["command", "\u0627\u0644\u0623\u0645\u0631"],
  "slash.arg.file": ["file", "\u0627\u0644\u0645\u0644\u0641"],
  "slash.arg.skill": ["on|off|list", "\u062A\u0634\u063A\u064A\u0644|\u0625\u064A\u0642\u0627\u0641|\u0642\u0627\u0626\u0645\u0629"],
  "slash.arg.mcpid": ["list|test <id>", "\u0642\u0627\u0626\u0645\u0629|\u0627\u062E\u062A\u0628\u0627\u0631 <\u0627\u0644\u0645\u0639\u0631\u0641>"],
  // /diff
  "slash.diff.noRepo": ["No git repository is open in this workspace.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0633\u062A\u0648\u062F\u0639 git \u0645\u0641\u062A\u0648\u062D \u0641\u064A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647."],
  "slash.diff.bridge": ["The git diff bridge is unavailable in this build.", "\u062C\u0633\u0631 \u0641\u0631\u0642 git \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  "slash.diff.clean": ["No uncommitted changes \u2014 the working tree is clean.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0645\u0648\u062F\u0639\u0629 \u2014 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0646\u0638\u064A\u0641\u0629."],
  "slash.diff.title": ["Unified diff for {path}", "\u0627\u0644\u0641\u0631\u0642 \u0627\u0644\u0645\u0648\u062D\u0651\u062F \u0644\u0644\u0645\u0633\u0627\u0631 {path}"],
  "slash.diff.allTitle": ["Unified diff \u2014 uncommitted changes", "\u0627\u0644\u0641\u0631\u0642 \u0627\u0644\u0645\u0648\u062D\u0651\u062F \u2014 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0645\u0648\u062F\u0639\u0629"],
  "slash.diff.summary": ["Unified diff: {n} file(s), {lines} lines \u2014 shown in the output panel.", "\u0627\u0644\u0641\u0631\u0642 \u0627\u0644\u0645\u0648\u062D\u0651\u062F: {n} \u0645\u0644\u0641\u060C {lines} \u0633\u0637\u0631 \u2014 \u0638\u0647\u0631 \u0641\u064A \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062E\u0631\u0627\u062C."],
  "slash.diff.failed": ["Could not read the git diff.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0641\u0631\u0642 git."],
  // /test
  "slash.test.noWorkspace": ["Open a folder first.", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B."],
  "slash.test.bridge": ["The command runner is unavailable in this build.", "\u0645\u0634\u063A\u0651\u0644 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  "slash.test.noScript": ["No test command found \u2014 add a test script to package.json or pass one after /test", "\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u0623\u0645\u0631 \u0627\u062E\u062A\u0628\u0627\u0631 \u2014 \u0623\u0636\u0641 \u0633\u0643\u0631\u0628\u062A test \u0625\u0644\u0649 package.json \u0623\u0648 \u0645\u0631\u0651\u0631 \u0623\u0645\u0631\u0627\u064B \u0628\u0639\u062F /test"],
  "slash.test.running": ["Running test command: {cmd}", "\u062C\u0627\u0631\u064A \u062A\u0634\u063A\u064A\u0644 \u0623\u0645\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631: {cmd}"],
  "slash.test.pass": ["PASS \u2014 exit code 0 in {ms} ms.", "\u0646\u062C\u062D \u2014 \u0631\u0645\u0632 \u0627\u0644\u062E\u0631\u0648\u062C 0 \u062E\u0644\u0627\u0644 {ms} \u0645\u0644\u0651\u064A."],
  "slash.test.fail": ["FAIL \u2014 exit code {code} in {ms} ms.", "\u0641\u0634\u0644 \u2014 \u0631\u0645\u0632 \u0627\u0644\u062E\u0631\u0648\u062C {code} \u062E\u0644\u0627\u0644 {ms} \u0645\u0644\u0651\u064A."],
  "slash.test.timeout": ["TIMEOUT \u2014 the test command exceeded its deadline.", "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u0645\u0647\u0644\u0629 \u2014 \u062A\u062C\u0627\u0648\u0632 \u0623\u0645\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u0648\u0642\u062A \u0627\u0644\u0645\u0633\u0645\u0648\u062D."],
  "slash.test.error": ["Could not run the test command: {error}", "\u062A\u0639\u0630\u0651\u0631 \u062A\u0634\u063A\u064A\u0644 \u0623\u0645\u0631 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631: {error}"],
  // /explain
  "slash.explain.usage": ["Usage: /explain <path>", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645: /explain <path>"],
  "slash.explain.bridge": ["File reading or one-shot completion is unavailable in this build.", "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641 \u0623\u0648 \u0627\u0644\u0625\u0643\u0645\u0627\u0644 \u0628\u0646\u0641\u064A\u0632\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  "slash.explain.reading": ["Reading the file and explaining it in your language\u2026", "\u062C\u0627\u0631\u064A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0641 \u0648\u0634\u0631\u062D\u0647 \u0628\u0644\u063A\u062A\u0643\u2026"],
  "slash.explain.empty": ["The file is empty \u2014 nothing to explain.", "\u0627\u0644\u0645\u0644\u0641 \u0641\u0627\u0631\u063A \u2014 \u0644\u0627 \u0634\u064A\u0621 \u0644\u0634\u0631\u062D\u0647."],
  "slash.explain.noProvider": ["No model is configured \u2014 set a provider and key in Settings first.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0645\u0648\u0630\u062C \u0645\u064F\u0639\u062F \u2014 \u0627\u0636\u0628\u0637 \u0645\u0632\u0648\u0651\u062F\u0627\u064B \u0648\u0645\u0641\u062A\u0627\u062D\u0627\u064B \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0623\u0648\u0644\u0627\u064B."],
  "slash.explain.failed": ["Explanation failed: {error}", "\u0641\u0634\u0644 \u0627\u0644\u0634\u0631\u062D: {error}"],
  "slash.explain.title": ["Explanation of {path}", "\u0634\u0631\u062D \u0627\u0644\u0645\u0644\u0641 {path}"],
  // /skills
  "slash.skills.status": ["Skill injection: {state} \u2014 based on the real workspace trust gate.", "\u062D\u0642\u0646 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A: {state} \u2014 \u0627\u0633\u062A\u0646\u0627\u062F\u0627\u064B \u0625\u0644\u0649 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u062B\u0642\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644."],
  "slash.skills.on": ["Skill injection ON \u2014 trusted workspace skills are injected from the next run.", "\u062D\u0642\u0646 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u064F\u0641\u0639\u0651\u0644 \u2014 \u062A\u064F\u062D\u0642\u0646 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u0648\u062B\u0648\u0642\u0629 \u0628\u062F\u0621\u0627\u064B \u0645\u0646 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0642\u0627\u062F\u0645."],
  "slash.skills.off": ["Skill injection OFF \u2014 workspace skills are skipped from the next run.", "\u062D\u0642\u0646 \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u064F\u0639\u0637\u0651\u0644 \u2014 \u062A\u064F\u062A\u062E\u0637\u0649 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0628\u062F\u0621\u0627\u064B \u0645\u0646 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0642\u0627\u062F\u0645."],
  "slash.skills.listEmpty": ["No skills are configured for this workspace.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u064F\u0639\u062F\u0651\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629."],
  "slash.skills.listTitle": ["Workspace skills ({n})", "\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 ({n})"],
  "slash.skills.bad": ["Usage: /skills on | off | list", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645: /skills on | off | list"],
  "slash.skills.state.on": ["on", "\u0645\u0641\u0639\u0651\u0644"],
  "slash.skills.state.off": ["off", "\u0645\u0639\u0637\u0651\u0644"],
  "slash.skills.state.ask": ["ask on use", "\u0627\u0644\u0633\u0624\u0627\u0644 \u0639\u0646\u062F \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645"],
  // /mcp
  "slash.mcp.empty": ["No MCP servers are configured.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062E\u0648\u0627\u062F\u0645 MCP \u0645\u064F\u0639\u062F\u0651\u0629."],
  "slash.mcp.listTitle": ["MCP servers ({n})", "\u062E\u0648\u0627\u062F\u0645 MCP ({n})"],
  "slash.mcp.testUsage": ["Usage: /mcp test <server-id>", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645: /mcp test <\u0645\u0639\u0631\u0641 \u0627\u0644\u062E\u0627\u062F\u0645>"],
  "slash.mcp.notFound": ["No MCP server matches {id}.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u062E\u0627\u062F\u0645 MCP \u064A\u0637\u0627\u0628\u0642 {id}."],
  "slash.mcp.testing": ["Testing MCP server {id}\u2026", "\u062C\u0627\u0631\u064A \u0627\u062E\u062A\u0628\u0627\u0631 \u062E\u0627\u062F\u0645 MCP {id}\u2026"],
  "slash.mcp.connected": ["{id} is connected \u2014 {n} tool(s), {ms} ms.", "{id} \u0645\u062A\u0635\u0644 \u2014 {n} \u0623\u062F\u0627\u0629\u060C {ms} \u0645\u0644\u0651\u064A."],
  "slash.mcp.failed": ["{id} failed: {error}", "\u0641\u0634\u0644 {id}: {error}"],
  "slash.mcp.bad": ["Usage: /mcp list | test <server-id>", "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645: /mcp list | test <\u0645\u0639\u0631\u0641 \u0627\u0644\u062E\u0627\u062F\u0645>"],
  "slash.mcp.bridge": ["The MCP bridge is unavailable in this build.", "\u062C\u0633\u0631 MCP \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  // /budget
  "slash.budget.title": ["Session budget \u2014 real usage", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062C\u0644\u0633\u0629 \u2014 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u062D\u0642\u064A\u0642\u064A"],
  "slash.budget.tokens": ["Tokens: {i} in / {o} out", "\u0627\u0644\u0631\u0645\u0648\u0632: {i} \u0625\u062F\u062E\u0627\u0644 / {o} \u0625\u062E\u0631\u0627\u062C"],
  "slash.budget.cost": ["Estimated cost: {c}", "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062A\u0642\u062F\u064A\u0631\u064A\u0629: {c}"],
  "slash.budget.lastTurn": ["Last turn: {t} tokens (estimated marked with approx)", "\u0622\u062E\u0631 \u062F\u0648\u0631\u0629: {t} \u0631\u0645\u0632 (\u0627\u0644\u062A\u0642\u062F\u064A\u0631\u064A \u0645\u0648\u0633\u0648\u0645 \u0628\u0639\u0644\u0627\u0645\u0629 \u062A\u0642\u0631\u064A\u0628)"],
  "slash.budget.taskCap": ["Task spend cap: {v}", "\u0633\u0642\u0641 \u0627\u0644\u0625\u0646\u0641\u0627\u0642 \u0644\u0644\u0645\u0647\u0645\u0629: {v}"],
  "slash.budget.noCap": ["unlimited", "\u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F"],
  "slash.budget.verification": ["Verification budget: {v}", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u0627\u0644\u062A\u062D\u0642\u0642: {v}"],
  // capability output panel + stop feedback
  "cap.panel.copy": ["Copy output", "\u0646\u0633\u062E \u0627\u0644\u0645\u062E\u0631\u062C\u0627\u062A"],
  "cap.panel.copied": ["Output copied", "\u0646\u064F\u0633\u062E\u062A \u0627\u0644\u0645\u062E\u0631\u062C\u0627\u062A"],
  "cap.panel.close": ["Close output panel", "\u0625\u063A\u0644\u0627\u0642 \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u062E\u0631\u0627\u062C"],
  "cap.panel.title": ["Output \u2014 {title}", "\u0627\u0644\u0625\u062E\u0631\u0627\u062C \u2014 {title}"],
  "chat.stopping": ["Stopping the agent\u2026", "\u062C\u0627\u0631\u064A \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0648\u0643\u064A\u0644\u2026"]
};
Object.assign(D, D_V1113);
var D_V1118_I18N_CLEAN = {
  // ── new PROOF button / claim-audit labels (A2) ──
  "chat.proof.toggle": ["Toggle proof details", "\u062A\u0628\u062F\u064A\u0644 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "chat.proof.title": ["Proof", "\u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "chat.audit.title": ["Claim audit", "\u062A\u062F\u0642\u064A\u0642 \u0627\u0644\u0627\u062F\u0639\u0627\u0621\u0627\u062A"],
  "chat.audit.quiet": ["Quiet \u2014 nothing to audit", "\u0647\u0627\u062F\u0626 \u2014 \u0644\u0627 \u0634\u064A\u0621 \u0644\u0644\u062A\u062F\u0642\u064A\u0642"],
  // ── ProofRibbon dictionary keys (were inline `ar ? … : …` fallbacks) ──
  "proof.center.title": ["PROOF CENTER", "\u0645\u0631\u0643\u0632 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "proof.center.def": [
    "Evidence, not promises \u2014 only recorded gate verdicts appear here.",
    "\u0623\u062F\u0644\u0629 \u0644\u0627 \u0648\u0639\u0648\u062F \u2014 \u0644\u0627 \u064A\u0638\u0647\u0631 \u0647\u0646\u0627 \u0625\u0644\u0627 \u0645\u0627 \u0633\u064F\u062C\u0651\u0644 \u0641\u0639\u0644\u0627\u064B \u0645\u0646 \u0623\u062D\u0643\u0627\u0645."
  ],
  "proof.center.checks": ["CHECKS PERFORMED", "\u0627\u0644\u0641\u062D\u0648\u0635\u0627\u062A \u0627\u0644\u0645\u064F\u0646\u0641\u0651\u0630\u0629"],
  "proof.noDetail": ["no detail recorded", "\u0644\u0645 \u064A\u064F\u0633\u062C\u0651\u0644 \u062A\u0641\u0635\u064A\u0644"],
  "proof.center.foot": [
    "Only events the run actually produced are shown.",
    "\u0644\u0627 \u064A\u064F\u0639\u0631\u0636 \u0625\u0644\u0627 \u0645\u0627 \u0623\u0646\u062A\u062C\u0647 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0641\u0639\u0644\u0627\u064B."
  ],
  "proof.center.open": ["Open evidence detail", "\u0641\u062A\u062D \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0623\u062F\u0644\u0629"],
  "proof.close": ["Close evidence detail", "\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644"],
  "proof.tag": ["PROOF", "\u0625\u062B\u0628\u0627\u062A"],
  "proof.tally.tip": [
    "Gate verdicts recorded for this run \u2014 click for full detail",
    "\u0623\u062D\u0643\u0627\u0645 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0645\u0633\u062C\u0651\u0644\u0629 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u0627\u0646\u0642\u0631 \u0644\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0643\u0627\u0645\u0644\u0629"
  ],
  "proof.chips.label": ["Recorded evidence", "\u0627\u0644\u0623\u062F\u0644\u0629 \u0627\u0644\u0645\u0633\u062C\u0651\u0644\u0629"],
  "proof.focus.showing": ["Showing: {kind}", "\u064A\u064F\u0639\u0631\u0636: {kind}"],
  "proof.focus.clear": ["All evidence", "\u0643\u0644 \u0627\u0644\u0623\u062F\u0644\u0629"]
};
Object.assign(D, D_V1118_I18N_CLEAN);
var D_V1121_FINAL = {
  "bdock.close": ["Close the agent browser and free its resources", "\u0625\u063A\u0644\u0627\u0642 \u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u062A\u062D\u0631\u064A\u0631 \u0645\u0648\u0627\u0631\u062F\u0647"],
  "bdock.idle": ["No browser is running", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u062A\u0635\u0641\u062D \u064A\u0639\u0645\u0644"],
  "bdock.idle.hint": ["Ask the agent to open a page (a hidden CDP-driven browser) and everything it sees appears here live.", "\u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644 \u062A\u0635\u0641\u062D \u0635\u0641\u062D\u0629 (\u0645\u062A\u0635\u0641\u062D \u0645\u062E\u0641\u064A \u0645\u062F\u0641\u0648\u0639 \u0628\u0640 CDP) \u0648\u0633\u064A\u0638\u0647\u0631 \u0643\u0644 \u0645\u0627 \u064A\u0631\u0627\u0647 \u0647\u0646\u0627 \u062D\u064A\u064B\u0627."],
  "bdock.idle.title": ["The agent browser is not running", "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u062A\u0648\u0642\u0641"],
  "bdock.net.empty": ["No requests logged yet", "\u0644\u0627 \u0637\u0644\u0628\u0627\u062A \u0645\u0633\u062C\u0644\u0629 \u0628\u0639\u062F"],
  "bdock.network": ["Network log", "\u0633\u062C\u0644 \u0627\u0644\u0634\u0628\u0643\u0629"],
  "bdock.noShot.hint": ["This view does not capture frames on its own; the moment the agent runs browser_screenshot the shot appears here.", "\u0644\u0627 \u064A\u0644\u062A\u0642\u0637 \u0647\u0630\u0627 \u0627\u0644\u0625\u0637\u0627\u0631 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B\u061B \u0639\u0646\u062F\u0645\u0627 \u064A\u062C\u0631\u064A \u0627\u0644\u0648\u0643\u064A\u0644 \u0623\u062F\u0627\u0629 browser_screenshot \u062A\u0638\u0647\u0631 \u0627\u0644\u0644\u0642\u0637\u0629 \u0647\u0646\u0627 \u0641\u0648\u0631\u064B\u0627."],
  "bdock.noShot.title": ["Browser is running \u2014 no screenshot yet", "\u0627\u0644\u0645\u062A\u0635\u0641\u062D \u064A\u0639\u0645\u0644 \u2014 \u0644\u0627 \u0644\u0642\u0637\u0629 \u0628\u0639\u062F"],
  "bdock.openExternal": ["Open the current URL in your browser", "\u0627\u0641\u062A\u062D \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062D\u0627\u0644\u064A \u0641\u064A \u0645\u062A\u0635\u0641\u062D\u0643"],
  "bdock.readOnly": ["Read-only view \u2014 the agent drives this browser with its browser_* tools (navigate, screenshot, click, type, read). Include it in a task, e.g. \u201Copen {url} and read the title\u201D.", "\u0639\u0631\u0636 \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637 \u2014 \u0627\u0644\u0648\u0643\u064A\u0644 \u064A\u0642\u0648\u062F \u0647\u0630\u0627 \u0627\u0644\u0645\u062A\u0635\u0641\u062D \u0628\u0623\u062F\u0648\u0627\u062A browser_* (\u062A\u0646\u0642\u0651\u0644\u060C \u0644\u0642\u0637\u0629\u060C \u0646\u0642\u0631\u060C \u0643\u062A\u0627\u0628\u0629\u060C \u0642\u0631\u0627\u0621\u0629). \u0623\u062F\u0631\u062C\u0647 \u0641\u064A \u0645\u0647\u0645\u062A\u0643 \u0645\u062B\u0644: \xAB\u0627\u0641\u062A\u062D {url} \u0648\u0627\u0642\u0631\u0623 \u0627\u0644\u0639\u0646\u0648\u0627\u0646\xBB."],
  "bdock.refresh": ["Refresh state", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u062D\u0627\u0644\u0629"],
  "bdock.running": ["The browser is running for this session", "\u0627\u0644\u0645\u062A\u0635\u0641\u062D \u064A\u0639\u0645\u0644 \u0644\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"],
  "bdock.shotAlt": ["Live screenshot of the agent page", "\u0644\u0642\u0637\u0629 \u0634\u0627\u0634\u0629 \u062D\u064A\u0629 \u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0648\u0643\u064A\u0644"],
  "bdock.state.idle": ["Idle", "\u0645\u062A\u0648\u0642\u0641"],
  "bdock.state.running": ["Running", "\u064A\u0639\u0645\u0644"],
  "bdock.tab.close": ["Close tab", "\u0625\u063A\u0644\u0627\u0642 \u0627\u0644\u062A\u0628\u0648\u064A\u0628"],
  "bdock.tab.new": ["New tab", "\u062A\u0628\u0648\u064A\u0628 \u062C\u062F\u064A\u062F"],
  "bdock.title": ["Agent browser", "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u0643\u064A\u0644"],
  "billing.freeSeason.eyebrow": ["NO MONTHLY PLAN", "\u0644\u0627 \u062E\u0637\u0629 \u0634\u0647\u0631\u064A\u0629"],
  "billing.freeSeason.statement": ["SADEEM is free during the public season \u2014 bring your own keys. There is no monthly plan; monetization is being designed.", "\u0633\u062F\u064A\u0645 \u0645\u062C\u0627\u0646\u064A\u0629 \u062E\u0644\u0627\u0644 \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0639\u0627\u0645 \u2014 \u0628\u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u0627\u0644\u062E\u0627\u0635\u0629. \u0644\u0627 \u062A\u0648\u062C\u062F \u062E\u0637\u0629 \u0634\u0647\u0631\u064A\u0629\u061B \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062F\u062E\u0644 \u0642\u064A\u062F \u0627\u0644\u062A\u0635\u0645\u064A\u0645."],
  "chat.focusEnter": ["Focus mode \u2014 just the chat (Esc to exit)", "\u0648\u0636\u0639 \u0627\u0644\u062A\u0631\u0643\u064A\u0632 \u2014 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0641\u0642\u0637 (Esc \u0644\u0644\u062E\u0631\u0648\u062C)"],
  "chat.focusExit": ["Exit focus mode (Esc)", "\u0627\u0644\u062E\u0631\u0648\u062C \u0645\u0646 \u0648\u0636\u0639 \u0627\u0644\u062A\u0631\u0643\u064A\u0632 (Esc)"],
  "chat.focusExitShort": ["to exit", "\u0644\u0644\u062E\u0631\u0648\u062C"],
  "chat.focusHint": ["Zen focus \u2014 rail, sidebar and editor are hidden.", "\u062A\u0631\u0643\u064A\u0632 \u062A\u0627\u0645 \u2014 \u0627\u0644\u0634\u0631\u064A\u0637 \u0648\u0627\u0644\u0644\u0648\u062D\u0629 \u0627\u0644\u062C\u0627\u0646\u0628\u064A\u0629 \u0648\u0627\u0644\u0645\u062D\u0631\u0631 \u0645\u062E\u0641\u064A\u0629."],
  "chat.hideDetails": ["Hide run details", "\u0625\u062E\u0641\u0627\u0621 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "chat.liveIndicator": ["Live", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "chat.livePanel.label": ["Live run status", "\u062D\u0627\u0644\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0628\u0627\u0634\u0631"],
  "chat.loadEarlier.hint": ["Only the newest messages are mounted for speed \u2014 click to reveal more. Tool results stay paired with their calls.", "\u062A\u064F\u062D\u0645\u064E\u0651\u0644 \u0623\u062D\u062F\u062B \u0627\u0644\u0631\u0633\u0627\u0626\u0644 \u0641\u0642\u0637 \u0644\u0644\u0633\u0631\u0639\u0629 \u2014 \u0627\u0646\u0642\u0631 \u0644\u0639\u0631\u0636 \u0627\u0644\u0645\u0632\u064A\u062F. \u062A\u0628\u0642\u0649 \u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0645\u0642\u062A\u0631\u0646\u0629 \u0628\u0627\u0633\u062A\u062F\u0639\u0627\u0626\u0647\u0627."],
  "chat.report.aborted": ["Stopped \u2014 partial work kept, summary below", "\u062A\u0648\u0642\u0651\u0641 \u2014 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u062C\u0632\u0626\u064A \u0645\u062D\u0641\u0648\u0638\u060C \u0648\u0627\u0644\u0645\u0644\u062E\u0635 \u0623\u062F\u0646\u0627\u0647"],
  "chat.report.done": ["Task finished \u2014 summary below", "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0645\u0647\u0645\u0629 \u2014 \u0627\u0644\u0645\u0644\u062E\u0635 \u0623\u062F\u0646\u0627\u0647"],
  "chat.report.error": ["Run failed \u2014 summary below", "\u0641\u0634\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u0627\u0644\u0645\u0644\u062E\u0635 \u0623\u062F\u0646\u0627\u0647"],
  "chat.report.next": ["NEXT STEPS", "\u0627\u0644\u062E\u0637\u0648\u0627\u062A \u0627\u0644\u062A\u0627\u0644\u064A\u0629"],
  "chat.report.notDone": ["NOT DONE", "\u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644"],
  "chat.report.tools": ["TOOLS USED", "\u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0629"],
  "chat.rewind": ["Rewind to a checkpoint", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642"],
  "chat.runDetails": ["Run details", "\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "chat.showDetails": ["Show run details", "\u0625\u0638\u0647\u0627\u0631 \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "chat.steer": ["Steer", "\u062A\u0648\u062C\u064A\u0647 \u0641\u0648\u0631\u064A"],
  "chat.voice.listening": ["Listening\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u0627\u0633\u062A\u0645\u0627\u0639\u2026"],
  "chat.voice.noDevice": ["No microphone was found.", "\u0644\u0645 \u064A\u064F\u0639\u062B\u0631 \u0639\u0644\u0649 \u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646."],
  "chat.voice.processing": ["Transcribing\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u0641\u0631\u064A\u063A \u0627\u0644\u0646\u0635\u064A\u2026"],
  "chat.voice.result": ["Transcript ready", "\u0627\u0644\u0646\u0635 \u062C\u0627\u0647\u0632"],
  "chat.voice.sent": ["Transcript sent", "\u0623\u064F\u0631\u0633\u0644 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0646\u0642\u0648\u0644"],
  "chat.voice.steady": ["Level unavailable \u2014 steady pulse", "\u0642\u064A\u0627\u0633 \u0627\u0644\u0635\u0648\u062A \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u2014 \u0646\u0628\u0636 \u062B\u0627\u0628\u062A"],
  "chat.voice.unsupported": ["Audio capture is unavailable in this window. Update SADEEM or check permission settings.", "\u0627\u0644\u062A\u0642\u0627\u0637 \u0627\u0644\u0635\u0648\u062A \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0646\u0627\u0641\u0630\u0629. \u062D\u062F\u0651\u062B \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0623\u0648 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0625\u0630\u0646."],
  "chat.working": ["Working\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u0639\u0645\u0644\u2026"],
  "cl.needDest": ["Pick a destination folder \u2014 the clone lands inside it.", "\u0627\u062E\u062A\u0631 \u0645\u062C\u0644\u062F\u0627\u064B \u0648\u062C\u0647\u0629\u064B \u2014 \u0633\u064A\u064F\u0648\u0636\u0639 \u0627\u0644\u0627\u0633\u062A\u0646\u0633\u0627\u062E \u062F\u0627\u062E\u0644\u0647."],
  "cl.needFields": ["Add a repository URL and a destination folder first.", "\u0623\u0636\u0641 \u0631\u0627\u0628\u0637 \u0645\u0633\u062A\u0648\u062F\u0639 \u0648\u0645\u062C\u0644\u062F\u0627\u064B \u0648\u062C\u0647\u0629\u064B \u0623\u0648\u0644\u0627\u064B."],
  "cl.needUrl": ["Paste a repository URL to continue.", "\u0627\u0644\u0635\u0642 \u0631\u0627\u0628\u0637 \u0645\u0633\u062A\u0648\u062F\u0639 \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629."],
  "common.cancel": ["Cancel", "\u0625\u0644\u063A\u0627\u0621"],
  "comp.phases": ["phases", "\u0645\u0631\u0627\u062D\u0644"],
  "comp.runLabel": ["RUN", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "comp.runProgress": ["Run progress", "\u062A\u0642\u062F\u0651\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "comp.sending": ["Sending\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u0625\u0631\u0633\u0627\u0644\u2026"],
  "diff.after": ["After", "\u0628\u0639\u062F"],
  "diff.before": ["Before", "\u0642\u0628\u0644"],
  "diff.change": ["Change", "\u062A\u063A\u064A\u064A\u0631"],
  "diff.created": ["New file", "\u0645\u0644\u0641 \u062C\u062F\u064A\u062F"],
  "diff.less": ["Show less", "\u0639\u0631\u0636 \u0623\u0642\u0644"],
  "diff.more": ["Show all changes", "\u0639\u0631\u0636 \u0643\u0644 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  "diff.split": ["Before / After", "\u0642\u0628\u0644 / \u0628\u0639\u062F"],
  "diff.statTitle": ["{a} added \xB7 {r} removed", "{a} \u0645\u0636\u0627\u0641 \xB7 {r} \u0645\u062D\u0630\u0648\u0641"],
  "diff.unified": ["Unified", "\u0645\u0648\u062D\u0651\u062F"],
  "diff.view": ["Diff view", "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u0639\u0631\u0636"],
  "diff.viewSplit": ["Side-by-side view", "\u0639\u0631\u0636 \u062C\u0646\u0628\u0627\u064B \u0625\u0644\u0649 \u062C\u0646\u0628"],
  "diff.viewUnified": ["Unified view", "\u0639\u0631\u0636 \u0645\u0648\u062D\u0651\u062F"],
  "dna.suggestion": ["AGENT SUGGESTED", "\u0627\u0642\u062A\u0631\u0627\u062D \u0627\u0644\u0648\u0643\u064A\u0644"],
  "dna.suggestion.dismiss": ["Dismiss suggestion", "\u062A\u062C\u0627\u0647\u0644 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D"],
  "ed.back": ["Back to Workspace", "\u0627\u0644\u0639\u0648\u062F\u0629 \u0625\u0644\u0649 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "ed.lang": ["Language", "\u0627\u0644\u0644\u063A\u0629"],
  "feedback.compose": ["COMPOSE", "\u0627\u0643\u062A\u0628 \u0631\u0633\u0627\u0644\u062A\u0643"],
  "flows.active": ["has been run", "\u0634\u064F\u063A\u0651\u0644 \u0645\u0646 \u0642\u0628\u0644"],
  "flows.compare.flow": ["Flow", "\u0645\u0633\u0627\u0631 (Flow)"],
  "flows.compare.flowBody": ["An interactive shortcut in chat. You press Run: the saved prompt is re-sent exactly as written and the agent answers inside your current session.", "\u0627\u062E\u062A\u0635\u0627\u0631 \u062A\u0641\u0627\u0639\u0644\u064A \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629. \u0623\u0646\u062A \u0645\u0646 \u064A\u0636\u063A\u0637 Run: \u064A\u064F\u0639\u0627\u062F \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u062D\u0641\u0648\u0638 \u0643\u0645\u0627 \u0643\u064F\u062A\u0628\u060C \u0648\u064A\u062C\u064A\u0628 \u0627\u0644\u0648\u0643\u064A\u0644 \u062F\u0627\u062E\u0644 \u062C\u0644\u0633\u062A\u0643 \u0627\u0644\u062D\u0627\u0644\u064A\u0629."],
  "flows.compare.job": ["Scheduled job", "\u0645\u0647\u0645\u0629 \u0645\u062C\u062F\u0648\u0644\u0629"],
  "flows.compare.jobBody": ["A cron worker that fires on a schedule, runs in the background, and must pass the proof gate before it counts as done.", "\u0639\u0627\u0645\u0644 cron \u064A\u0639\u0645\u0644 \u0648\u062D\u062F\u0647 \u062D\u0633\u0628 \u062C\u062F\u0648\u0644 \u0632\u0645\u0646\u064A\u060C \u0641\u064A \u0627\u0644\u062E\u0644\u0641\u064A\u0629\u060C \u0648\u064A\u062C\u0628 \u0623\u0646 \u064A\u062C\u062A\u0627\u0632 \u0628\u0648\u0627\u0628\u0629 \u0627\u0644\u0625\u062B\u0628\u0627\u062A \u0642\u0628\u0644 \u0623\u0646 \u064A\u064F\u0639\u062F\u064E\u0651 \u0646\u0627\u062C\u062D\u0627\u064B."],
  "flows.compare.note": ["A flow never runs by itself \u2014 you start it.", "\u0627\u0644\u0645\u0633\u0627\u0631 \u0644\u0627 \u064A\u0639\u0645\u0644 \u0645\u0646 \u062A\u0644\u0642\u0627\u0621 \u0646\u0641\u0633\u0647 \u2014 \u0623\u0646\u062A \u0645\u0646 \u064A\u0628\u062F\u0623\u0647."],
  "flows.compare.title": ["Flows vs Scheduled Jobs", "\u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A \u0645\u0642\u0627\u0628\u0644 \u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "flows.copy": ["Copy prompt", "\u0646\u0633\u062E \u0627\u0644\u0637\u0644\u0628"],
  "flows.copy.ok": ["Prompt copied", "\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0637\u0644\u0628"],
  "flows.editor.kicker": ["FLOW EDITOR", "\u0645\u062D\u0631\u0631 \u0627\u0644\u0645\u0633\u0627\u0631"],
  "flows.empty.cta": ["Create your first flow", "\u0623\u0646\u0634\u0626 \u0645\u0633\u0627\u0631\u0643 \u0627\u0644\u0623\u0648\u0644"],
  "flows.lede": ["A flow is a saved prompt, re-sent in chat with one click \u2014 not an autonomous job.", "\u0627\u0644\u0645\u0633\u0627\u0631 \u0637\u0644\u0628 \u0645\u062D\u0641\u0648\u0638 \u064A\u064F\u0639\u0627\u062F \u0625\u0631\u0633\u0627\u0644\u0647 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0628\u0636\u063A\u0637\u0629 \u0648\u0627\u062D\u062F\u0629 \u2014 \u0644\u064A\u0633 \u0645\u0647\u0645\u0629 \u062A\u0639\u0645\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B."],
  "flows.list.title": ["SAVED FLOWS", "\u0627\u0644\u0645\u0633\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629"],
  "flows.preview.empty": ["Write a prompt to see exactly what will be sent.", "\u0627\u0643\u062A\u0628 \u0637\u0644\u0628\u0627\u064B \u0644\u062A\u0631\u0649 \u0645\u0627 \u0633\u064A\u064F\u0631\u0633\u0644 \u0628\u0627\u0644\u0636\u0628\u0637."],
  "flows.preview.title": ["INVOCATION PREVIEW", "\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u0625\u0631\u0633\u0627\u0644"],
  "flows.replay": ["Validate by replay", "\u062A\u062D\u0642\u0642 \u0628\u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "flows.replay.fail": ["Replay failed", "\u0641\u0634\u0644\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "flows.replay.ok": ["Replay passed", "\u0646\u062C\u062D\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "flows.spark.note": ["spacing between this session\u2019s runs only \u2014 no per-run timeline is stored", "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0632\u0645\u0646\u064A\u0629 \u0628\u064A\u0646 \u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0641\u0642\u0637 \u2014 \u0644\u0627 \u064A\u064F\u062D\u0641\u0638 \u0633\u062C\u0644 \u062F\u0627\u0626\u0645 \u0644\u0643\u0644 \u062A\u0634\u063A\u064A\u0644."],
  "flows.status.done": ["chat run finished", "\u0627\u0646\u062A\u0647\u0649 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "flows.status.error": ["send failed", "\u0641\u0634\u0644 \u0627\u0644\u0625\u0631\u0633\u0627\u0644"],
  "flows.status.label": ["LAST SEND", "\u0622\u062E\u0631 \u0625\u0631\u0633\u0627\u0644"],
  "flows.status.queued": ["queued in chat", "\u0641\u064A \u0637\u0627\u0628\u0648\u0631 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "flows.status.running": ["running in chat", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "flows.val.name": ["Give the flow a name.", "\u0623\u062F\u062E\u0644 \u0627\u0633\u0645\u0627\u064B \u0644\u0644\u0645\u0633\u0627\u0631."],
  "flows.val.nameLen": ["Name is too long (80 characters max).", "\u0627\u0644\u0627\u0633\u0645 \u0637\u0648\u064A\u0644 \u062C\u062F\u0627\u064B (80 \u062D\u0631\u0641\u0627\u064B \u0643\u062D\u062F \u0623\u0642\u0635\u0649)."],
  "flows.val.prompt": ["Write the prompt this flow will send.", "\u0627\u0643\u062A\u0628 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0630\u064A \u0633\u064A\u0631\u0633\u0644\u0647 \u0627\u0644\u0645\u0633\u0627\u0631."],
  "flows.val.promptLen": ["Prompt is too long (20,000 characters max).", "\u0627\u0644\u0637\u0644\u0628 \u0637\u0648\u064A\u0644 \u062C\u062F\u0627\u064B (20 \u0623\u0644\u0641 \u062D\u0631\u0641 \u0643\u062D\u062F \u0623\u0642\u0635\u0649)."],
  "flows.vars.hint": ["No variable engine: this text is sent verbatim. Anything in {{braces}} stays literal.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u062D\u0631\u0643 \u0645\u062A\u063A\u064A\u0631\u0627\u062A: \u064A\u064F\u0631\u0633\u0644 \u0647\u0630\u0627 \u0627\u0644\u0646\u0635 \u062D\u0631\u0641\u064A\u0627\u064B. \u0623\u064A \u0634\u064A\u0621 \u062F\u0627\u062E\u0644 {{\u0642\u0648\u0633\u064A\u0646}} \u064A\u0628\u0642\u0649 \u0643\u0645\u0627 \u0647\u0648."],
  "git.cleanTree": ["Working tree clean \u2014 nothing to commit", "\u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0646\u0638\u064A\u0641\u0629 \u2014 \u0644\u0627 \u0634\u064A\u0621 \u0644\u0644\u0625\u064A\u062F\u0627\u0639"],
  "git.desc": ["Review working-tree changes, inspect history and commit with AI assistance.", "\u0631\u0627\u062C\u0639 \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0648\u062A\u0635\u0641\u0651\u062D \u0627\u0644\u0633\u062C\u0644 \u0648\u0623\u0648\u062F\u0650\u0639 \u0628\u0645\u0633\u0627\u0639\u062F\u0629 \u0627\u0644\u0630\u0643\u0627\u0621."],
  "git.untracked": ["Untracked", "\u063A\u064A\u0631 \u0645\u062A\u062A\u0628\u064E\u0651\u0639"],
  "goal.stateActive": ["ACTIVE", "\u0646\u0634\u0637"],
  "goal.stateDone": ["DONE", "\u0645\u0643\u062A\u0645\u0644"],
  "hgs.git.branch": ["branch", "\u0641\u0631\u0639"],
  "hgs.git.graph": ["Branch graph", "\u0631\u0633\u0645 \u0627\u0644\u0641\u0631\u0648\u0639"],
  "hgs.home.chart": ["Tokens across recent sessions", "\u0627\u0644\u0631\u0645\u0648\u0632 \u0639\u0628\u0631 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "hgs.home.chartLabel": ["TOKENS / RECENT SESSIONS", "\u0627\u0644\u0631\u0645\u0648\u0632 / \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "hgs.sess.timeline": ["Session timeline", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A \u0644\u0644\u062C\u0644\u0633\u0627\u062A"],
  "hgs.sess.timelineEmpty": ["No sessions on the timeline yet.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062C\u0644\u0633\u0627\u062A \u0628\u0639\u062F."],
  "hgs.sess.timelineLabel": ["SESSION TIMELINE", "\u0627\u0644\u062E\u0637 \u0627\u0644\u0632\u0645\u0646\u064A / \u0627\u0644\u062C\u0644\u0633\u0627\u062A"],
  "home.changed": ["changed", "\u0645\u062A\u063A\u064A\u0651\u0631"],
  "home.clean": ["Clean", "\u0646\u0638\u064A\u0641\u0629"],
  "home.falseDone": ["False-Done rate", "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0632\u0627\u0626\u0641"],
  "home.falseDone.hint": ["Published honesty metric \u2014 claims the proof gates caught", "\u0645\u0642\u064A\u0627\u0633 \u0635\u062F\u0642 \u0645\u064F\u0646\u0634\u064E\u0631 \u2014 \u0627\u0644\u0627\u062F\u0639\u0627\u0621\u0627\u062A \u0627\u0644\u062A\u064A \u0636\u0628\u0637\u062A\u0647\u0627 \u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "home.footerHint": ["The agent that must PROVE it is done.", "\u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0630\u064A \u064A\u062C\u0628 \u0623\u0646 \u064A\u064F\u062B\u0628\u062A \u0623\u0646\u0647 \u0623\u0646\u0647\u0649."],
  "home.git": ["Source control", "\u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631"],
  "home.jobs": ["Scheduled jobs", "\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629"],
  "home.mcp": ["MCP servers", "\u062E\u0648\u0627\u062F\u0645 MCP"],
  "home.model": ["Model", "\u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "home.newSession": ["New Session", "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629"],
  "home.noProjects": ["No projects yet \u2014 open a folder to begin.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0634\u0627\u0631\u064A\u0639 \u0628\u0639\u062F \u2014 \u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0644\u0644\u0628\u062F\u0621."],
  "home.noRunsYet": ["no runs yet", "\u0644\u0627 \u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0628\u0639\u062F"],
  "home.noSessions": ["No sessions yet \u2014 start one from the composer or the quick action above.", "\u0644\u0627 \u062C\u0644\u0633\u0627\u062A \u0628\u0639\u062F \u2014 \u0627\u0628\u062F\u0623 \u0648\u0627\u062D\u062F\u0629 \u0645\u0646 \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0623\u0648 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0627\u0644\u0633\u0631\u064A\u0639 \u0623\u0639\u0644\u0627\u0647."],
  "home.noWorkspace": ["No workspace open \u2014 pick a folder to start.", "\u0644\u0627 \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0645\u0641\u062A\u0648\u062D\u0629 \u2014 \u0627\u062E\u062A\u0631 \u0645\u062C\u0644\u062F\u0627\u064B \u0644\u0644\u0628\u062F\u0621."],
  "home.noWsGit": ["\u2014", "\u2014"],
  "home.openProject": ["Open Project", "\u0641\u062A\u062D \u0645\u0634\u0631\u0648\u0639"],
  "home.permissions": ["Permissions", "\u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "home.queued": ["{n} queued", "{n} \u0641\u064A \u0627\u0644\u0637\u0627\u0628\u0648\u0631"],
  "home.recentProjects": ["Recent projects", "\u0627\u0644\u0645\u0634\u0627\u0631\u064A\u0639 \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "home.recentSessions": ["Recent sessions", "\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "home.running": ["Running now", "\u064A\u0639\u0645\u0644 \u0627\u0644\u0622\u0646"],
  "home.system": ["At a glance", "\u0646\u0638\u0631\u0629 \u0633\u0631\u064A\u0639\u0629"],
  "home.viewAll": ["View all", "\u0639\u0631\u0636 \u0627\u0644\u0643\u0644"],
  "home.workspace": ["Workspace", "\u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "key": ["English", "\u0627\u0644\u0639\u0631\u0628\u064A\u0629"],
  "lib.clearAll": ["Clear all", "\u062D\u0630\u0641 \u0627\u0644\u0643\u0644"],
  "lib.clearAll.confirm": ["Remove ALL entries from the library? The files themselves stay on disk. This cannot be undone.", "\u062D\u0630\u0641 \u0643\u0644 \u0627\u0644\u0639\u0646\u0627\u0635\u0631 \u0645\u0646 \u0627\u0644\u0645\u0643\u062A\u0628\u0629\u061F \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0646\u0641\u0633\u0647\u0627 \u062A\u0628\u0642\u0649 \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635 \u0648\u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639."],
  "lib.clearAll.done": ["Library cleared", "\u062A\u0645 \u062A\u0641\u0631\u064A\u063A \u0627\u0644\u0645\u0643\u062A\u0628\u0629"],
  "lib.empty": ["Empty for now \u2014 every image, document or file SADEEM produces (or the agent downloads) shows up here automatically, across sessions.", "\u0641\u0627\u0631\u063A\u0629 \u062D\u062A\u0649 \u0627\u0644\u0622\u0646 \u2014 \u0643\u0644 \u0635\u0648\u0631\u0629 \u0623\u0648 \u0645\u0633\u062A\u0646\u062F \u0623\u0648 \u0645\u0644\u0641 \u064A\u0646\u062A\u062C\u0647 \u0633\u062F\u064A\u0645 (\u0623\u0648 \u062A\u062D\u0645\u0651\u0644\u0647 \u0627\u0644\u0648\u0643\u064A\u0644) \u064A\u0638\u0647\u0631 \u0647\u0646\u0627 \u062A\u0644\u0642\u0627\u0626\u064A\u064B\u0627 \u0639\u0628\u0631 \u0627\u0644\u062C\u0644\u0633\u0627\u062A."],
  "lib.filter": ["Filter", "\u062A\u0635\u0641\u064A\u0629"],
  "lib.forget": ["Remove from library", "\u0625\u0632\u0627\u0644\u0629 \u0645\u0646 \u0627\u0644\u0645\u0643\u062A\u0628\u0629"],
  "lib.loading": ["Loading\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "lib.open": ["Open", "\u0641\u062A\u062D"],
  "lib.refresh": ["Refresh", "\u062A\u062D\u062F\u064A\u062B"],
  "lib.search": ["Search the library\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0643\u062A\u0628\u0629\u2026"],
  "lib.shelf.a11y": ["Library shelf with real per-kind counts", "\u0631\u0641 \u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u0645\u0639 \u0639\u062F\u0627\u062F\u0627\u062A \u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0643\u0644 \u0646\u0648\u0639"],
  "lib.shelf.hint": ["one bay per kind \xB7 counts from the live registry", "\u062E\u0627\u0646\u0629 \u0644\u0643\u0644 \u0646\u0648\u0639 \xB7 \u0627\u0644\u0623\u0639\u062F\u0627\u062F \u0645\u0646 \u0627\u0644\u0633\u062C\u0644 \u0627\u0644\u0645\u0628\u0627\u0634\u0631"],
  "lib.shelf.label": ["SHELF / INDEX", "\u0645\u062E\u0637\u0637 \u0627\u0644\u0631\u0641"],
  "lib.shelf.total": ["TOTAL", "\u0627\u0644\u0645\u062C\u0645\u0648\u0639"],
  "lib.tab.files": ["Files", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "lib.tabs": ["Library tabs", "\u062A\u0628\u0648\u064A\u0628\u0627\u062A \u0627\u0644\u0645\u0643\u062A\u0628\u0629"],
  "lib.title": ["Library", "\u0627\u0644\u0645\u0643\u062A\u0628\u0629"],
  "mcp.catalog.added": ["Added", "\u0623\u064F\u0636\u064A\u0641"],
  "mcp.catalog.addedToast": ['Added "{name}" to MCP servers.', '\u0623\u064F\u0636\u064A\u0641 "{name}" \u0625\u0644\u0649 \u062E\u0648\u0627\u062F\u0645 MCP.'],
  "mcp.catalog.addOneClick": ["Add to MCP servers", "\u0625\u0636\u0627\u0641\u0629 \u0625\u0644\u0649 \u062E\u0648\u0627\u062F\u0645 MCP"],
  "mcp.catalog.all": ["All", "\u0627\u0644\u0643\u0644"],
  "mcp.catalog.empty": ["No curated server matches.", "\u0644\u0627 \u062E\u0627\u062F\u0645 \u0645\u064F\u0646\u0633\u064E\u0651\u0642 \u0645\u0637\u0627\u0628\u0642."],
  "mcp.catalog.hint": ["Hand-picked servers with verified install commands. Adding one writes a normal MCP server entry; fill in any credentials in the edit form that opens.", "\u062E\u0648\u0627\u062F\u0645 \u0645\u062E\u062A\u0627\u0631\u0629 \u0628\u0623\u0648\u0627\u0645\u0631 \u062A\u062B\u0628\u064A\u062A \u0645\u0648\u062B\u0648\u0642\u0629. \u0627\u0644\u0625\u0636\u0627\u0641\u0629 \u062A\u064F\u0646\u0634\u0626 \u0625\u062F\u062E\u0627\u0644 \u062E\u0627\u062F\u0645 MCP \u0639\u0627\u062F\u064A\u0627\u064B\u061B \u0623\u0643\u0645\u0644 \u0623\u064A \u0628\u064A\u0627\u0646\u0627\u062A \u062F\u062E\u0648\u0644 \u0641\u064A \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0630\u064A \u064A\u0641\u062A\u062D."],
  "mcp.catalog.manual": ["Manual setup", "\u0625\u0639\u062F\u0627\u062F \u064A\u062F\u0648\u064A"],
  "mcp.catalog.search": ["Search curated servers\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u062E\u0648\u0627\u062F\u0645 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629\u2026"],
  "mcp.catalog.setup": ["Open setup form", "\u0641\u062A\u062D \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0625\u0639\u062F\u0627\u062F"],
  "mcp.desc": ["Connect external tools, inspect their capabilities and review every call.", "\u0627\u0631\u0628\u0637 \u0623\u062F\u0648\u0627\u062A \u062E\u0627\u0631\u062C\u064A\u0629 \u0648\u062A\u0641\u062D\u0651\u0635 \u0642\u062F\u0631\u0627\u062A\u0647\u0627 \u0648\u0631\u0627\u062C\u0639 \u0643\u0644 \u0627\u0633\u062A\u062F\u0639\u0627\u0621."],
  "mcp.tab.catalog": ["Catalog", "\u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C"],
  "md.collapseFull": ["Show less", "\u0639\u0631\u0636 \u0623\u0642\u0644"],
  "md.showFull": ["Show full message", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0643\u0627\u0645\u0644\u0629"],
  "mp.reasoning.": ["Reasoning", "\u0627\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644"],
  "mv.badge.count": ["{n} {unit}", "{n} {unit}"],
  "mv.badge.lines": ["{n} lines", "{n} \u0633\u0637\u0631\u0627\u064B"],
  "mv.stack.sameTool": ["{name} \xB7 call {n} in a row", "{name} \xB7 \u0627\u0633\u062A\u062F\u0639\u0627\u0621 {n} \u0639\u0644\u0649 \u0627\u0644\u062A\u0648\u0627\u0644\u064A"],
  "onboard.caps.arabic": ["145 real tools \xB7 tool profiles \xB7 Living Playbook \xB7 MCP & subagents \xB7 bring your own key \u2014 no subscription.", "145 \u0623\u062F\u0627\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \xB7 \u0645\u0644\u0641\u0627\u062A \u0623\u062F\u0648\u0627\u062A \xB7 \u062F\u0644\u064A\u0644 \u062D\u064A\u0651 \xB7 \u0648\u0643\u0644\u0627\u0621 \u062E\u0627\u0631\u062C\u064A\u0648\u0646 \u0648\u0641\u0631\u0648\u0639 \xB7 \u0628\u0645\u0641\u062A\u0627\u062D\u0643 \u0627\u0644\u062E\u0627\u0635 \u0628\u0644\u0627 \u0627\u0634\u062A\u0631\u0627\u0643."],
  "onboard.caps.guide": ["Open the capability guide from the command palette ({mod}+K) anytime.", "\u0627\u0641\u062A\u062D \u062F\u0644\u064A\u0644 \u0627\u0644\u0642\u062F\u0631\u0627\u062A \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u0623\u0648\u0627\u0645\u0631 ({mod}+K) \u0641\u064A \u0623\u064A \u0648\u0642\u062A."],
  "onboard.caps.latin": ["145 real tools \xB7 tool profiles \xB7 Living Playbook \xB7 MCP & subagents \xB7 bring your own key \u2014 no subscription.", "145 \u0623\u062F\u0627\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \xB7 \u0645\u0644\u0641\u0627\u062A \u0623\u062F\u0648\u0627\u062A \xB7 \u062F\u0644\u064A\u0644 \u062D\u064A\u0651 \xB7 \u0648\u0643\u0644\u0627\u0621 \u062E\u0627\u0631\u062C\u064A\u0648\u0646 \u0648\u0641\u0631\u0648\u0639 \xB7 \u0628\u0645\u0641\u062A\u0627\u062D\u0643 \u0627\u0644\u062E\u0627\u0635 \u0628\u0644\u0627 \u0627\u0634\u062A\u0631\u0627\u0643."],
  "onboard.caps.title": ["What SADEEM really does", "\u0645\u0627 \u0627\u0644\u0630\u064A \u062A\u0641\u0639\u0644\u0647 \u0633\u062F\u064A\u0645 \u0641\u0639\u0644\u0627\u064B"],
  "onboard.key.localOnly": ["Your key is stored locally on your machine only \u2014 it is never sent anywhere but your chosen provider.", "\u0645\u0641\u062A\u0627\u062D\u0643 \u0645\u062D\u0641\u0648\u0638 \u0645\u062D\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u062C\u0647\u0627\u0632\u0643 \u0641\u0642\u0637 \u2014 \u0648\u0644\u0627 \u064A\u064F\u0631\u0633\u0644 \u0625\u0644\u0627 \u0625\u0644\u0649 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u0630\u064A \u062A\u062E\u062A\u0627\u0631\u0647."],
  "pal.nav.move": ["navigate", "\u062A\u0646\u0642\u0651\u0644"],
  "pal.nav.run": ["run", "\u062A\u0634\u063A\u064A\u0644"],
  "pal.typeToSearch": ["type to search", "\u0627\u0643\u062A\u0628 \u0644\u0644\u0628\u062D\u062B"],
  "palette.openGuide": ["Open capability guide", "\u0641\u062A\u062D \u062F\u0644\u064A\u0644 \u0627\u0644\u0642\u062F\u0631\u0627\u062A"],
  "pf.breadcrumb": ["Current folder", "\u0627\u0644\u0645\u062C\u0644\u062F \u0627\u0644\u062D\u0627\u0644\u064A"],
  "pf.copied": ["Path copied to clipboard", "\u0646\u064F\u0633\u062E \u0627\u0644\u0645\u0633\u0627\u0631 \u0625\u0644\u0649 \u0627\u0644\u062D\u0627\u0641\u0638\u0629"],
  "pf.copyPath": ["Copy path", "\u0646\u0633\u062E \u0627\u0644\u0645\u0633\u0627\u0631"],
  "pf.filter": ["Filter files by name\u2026", "\u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0628\u0627\u0644\u0627\u0633\u0645\u2026"],
  "pf.hint": ["Click a file to open it in the editor \u2014 you can always return here.", "\u0627\u0646\u0642\u0631 \u0645\u0644\u0641\u0627\u064B \u0644\u0641\u062A\u062D\u0647 \u0641\u064A \u0627\u0644\u0645\u062D\u0631\u0631 \u2014 \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u0639\u0648\u062F\u0629 \u0647\u0646\u0627 \u062F\u0627\u0626\u0645\u0627\u064B."],
  "pf.noMatches": ["No matching files", "\u0644\u0627 \u0645\u0644\u0641\u0627\u062A \u0645\u0637\u0627\u0628\u0642\u0629"],
  "pf.noMatchesHint": ["Try a different name or extension", "\u062C\u0631\u0651\u0628 \u0627\u0633\u0645\u0627\u064B \u0623\u0648 \u0627\u0645\u062A\u062F\u0627\u062F\u0627\u064B \u0622\u062E\u0631"],
  "pf.open": ["Open file", "\u0641\u062A\u062D \u0627\u0644\u0645\u0644\u0641"],
  "pf.reveal": ["Reveal in tree", "\u0625\u0638\u0647\u0627\u0631 \u0641\u064A \u0627\u0644\u0634\u062C\u0631\u0629"],
  "pf.title": ["Project files", "\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "pf.tree": ["Project files", "\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "plans.title.new": ["SADEEM \u2014 free season", "\u0633\u062F\u064A\u0645 \u2014 \u0645\u0648\u0633\u0645 \u0645\u062C\u0627\u0646\u064A"],
  "presets.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "presets.empty": ["No saved presets yet \u2014 create them in the Prompt Library panel.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062A\u0648\u062C\u064A\u0647\u0627\u062A \u0645\u062D\u0641\u0648\u0638\u0629 \u0628\u0639\u062F \u2014 \u0623\u0646\u0634\u0626\u0647\u0627 \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A."],
  "presets.inserted": ["Preset inserted into the composer", "\u0623\u064F\u062F\u0631\u062C \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "presets.loading": ["Loading\u2026", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "presets.noMatch": ["No matching presets", "\u0644\u0627 \u0646\u062A\u0627\u0626\u062C \u0645\u0637\u0627\u0628\u0642\u0629"],
  "presets.search": ["Filter presets\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A\u2026"],
  "presets.title": ["Prompt presets", "\u062A\u0648\u062C\u064A\u0647\u0627\u062A \u062C\u0627\u0647\u0632\u0629"],
  "preview.browserTab": ["Agent browser", "\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u0643\u064A\u0644"],
  "preview.browserTabTip": ["Live view of the agent\u2019s hidden CDP browser (browser_* tools)", "\u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u062D\u064A \u0644\u0645\u062A\u0635\u0641\u062D \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0645\u062E\u0641\u064A (\u0623\u062F\u0648\u0627\u062A browser_)"],
  "preview.copyUrl": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "preview.eyebrow": ["LIVE PREVIEW", "\u0645\u0639\u0627\u064A\u0646\u0629 \u062D\u064A\u0629"],
  "preview.runtimeCustom": ["Custom command", "\u0623\u0645\u0631 \u0645\u062E\u0635\u0635"],
  "preview.runtimeGo": ["Go run", "\u062A\u0634\u063A\u064A\u0644 Go"],
  "preview.runtimePython": ["Python server", "\u062E\u0627\u062F\u0645 Python"],
  "preview.state.error": ["ERROR", "\u062E\u0637\u0623"],
  "preview.state.idle": ["IDLE", "\u062E\u0627\u0645\u0644"],
  "preview.state.loading": ["LOADING", "\u062C\u0627\u0631\u064D \u0627\u0644\u062A\u062D\u0645\u064A\u0644"],
  "preview.state.ready": ["READY", "\u062C\u0627\u0647\u0632"],
  "preview.status": ["Preview status", "\u062D\u0627\u0644\u0629 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629"],
  "preview.viewTabs": ["View", "\u0627\u0644\u0639\u0631\u0636"],
  "prompts.cancel": ["Cancel", "\u0625\u0644\u063A\u0627\u0621"],
  "prompts.copied": ["Prompt copied to clipboard", "\u0646\u064F\u0633\u062E \u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "prompts.copy": ["Copy", "\u0646\u0633\u062E"],
  "prompts.copyFailed": ["Clipboard is unavailable on this device", "\u0627\u0644\u0646\u0633\u062E \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "prompts.delete": ["Delete", "\u062D\u0630\u0641"],
  "prompts.desc": ["Your own text snippets, stored on this device \u2014 reusable, not AI templates.", "\u0646\u0635\u0648\u0635\u0643 \u0623\u0646\u062A\u060C \u0645\u062D\u0641\u0648\u0638\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u2014 \u0642\u0627\u0628\u0644\u0629 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645\u060C \u0644\u064A\u0633\u062A \u0642\u0648\u0627\u0644\u0628 \u0630\u0643\u0627\u0621 \u0627\u0635\u0637\u0646\u0627\u0639\u064A."],
  "prompts.edit": ["Edit", "\u062A\u062D\u0631\u064A\u0631"],
  "prompts.editor.edit": ["EDIT PROMPT", "\u062A\u062D\u0631\u064A\u0631 \u062A\u0648\u062C\u064A\u0647"],
  "prompts.editor.new": ["NEW PROMPT", "\u062A\u0648\u062C\u064A\u0647 \u062C\u062F\u064A\u062F"],
  "prompts.empty": ["The library is empty", "\u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u0641\u0627\u0631\u063A\u0629"],
  "prompts.emptySub": ["Save your recurring prompts (code review, task brief, report format\u2026) and re-insert them into the chat in one click.", "\u0627\u062D\u0641\u0638 \u062A\u0648\u062C\u064A\u0647\u0627\u062A\u0643 \u0627\u0644\u0645\u062A\u0643\u0631\u0631\u0629 (\u0645\u0631\u0627\u062C\u0639\u0629 \u0643\u0648\u062F\u060C \u062A\u0648\u0635\u064A\u0641 \u0645\u0647\u0645\u0629\u060C \u0635\u064A\u063A\u0629 \u062A\u0642\u0631\u064A\u0631\u2026) \u062B\u0645 \u0623\u062F\u0631\u062C\u0647\u0627 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0628\u0636\u063A\u0637\u0629 \u0648\u0627\u062D\u062F\u0629."],
  "prompts.est": ["est.", "\u062A\u0642\u062F\u064A\u0631"],
  "prompts.eyebrow": ["07 / PROMPTS", "\u0660\u0667 / \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A"],
  "prompts.flash.copied": ["copied", "\u0646\u064F\u0633\u062E"],
  "prompts.flash.saved": ["saved", "\u062D\u064F\u0641\u0638"],
  "prompts.flash.used": ["inserted", "\u0623\u064F\u062F\u0631\u062C"],
  "prompts.how": ["Every prompt is stored on this device only (prompts.json). Write a prompt once, then open this panel and press Insert anytime \u2014 or use the /prompts slash command in the chat.", "\u0643\u0644 \u062A\u0648\u062C\u064A\u0647 \u064A\u064F\u062D\u0641\u0638 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u0641\u0642\u0637 (prompts.json). \u0623\u0643\u062A\u0628 \u0627\u0644\u062A\u0648\u062C\u064A\u0647 \u0645\u0631\u0629\u060C \u062B\u0645 \u0627\u0641\u062A\u062D \u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u0648\u0627\u0636\u063A\u0637 \xAB\u0625\u062F\u0631\u0627\u062C\xBB \u0641\u064A \u0623\u064A \u0648\u0642\u062A \u2014 \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0623\u0645\u0631 \u0627\u0644\u0633\u0631\u064A\u0639 \u200E/prompts \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629."],
  "prompts.howTitle": ["How it works", "\u0643\u064A\u0641 \u062A\u0633\u062A\u062E\u062F\u0645\u0647\u0627"],
  "prompts.insert": ["Insert", "\u0625\u062F\u0631\u0627\u062C"],
  "prompts.inserted": ["Inserted into the composer", "\u0623\u064F\u062F\u0631\u062C \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "prompts.lines": ["lines", "\u0633\u0637\u0648\u0631"],
  "prompts.listLabel": ["Saved prompts", "\u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629"],
  "prompts.loading": ["Loading\u2026", "\u062C\u0627\u0631\u0650 \u0627\u0644\u062A\u062D\u0645\u064A\u0644\u2026"],
  "prompts.name": ["Name", "\u0627\u0644\u0627\u0633\u0645"],
  "prompts.nameRequired": ["A name is required", "\u0627\u0644\u0627\u0633\u0645 \u0645\u0637\u0644\u0648\u0628"],
  "prompts.new": ["New prompt", "\u062A\u0648\u062C\u064A\u0647 \u062C\u062F\u064A\u062F"],
  "prompts.noMatch": ["No matching prompts", "\u0644\u0627 \u0646\u062A\u0627\u0626\u062C \u0645\u0637\u0627\u0628\u0642\u0629"],
  "prompts.refresh": ["Refresh", "\u062A\u062D\u062F\u064A\u062B"],
  "prompts.save": ["Save to library", "\u062D\u0641\u0638 \u0641\u064A \u0627\u0644\u0645\u0643\u062A\u0628\u0629"],
  "prompts.saved": ["Saved to the prompt library", "\u062D\u064F\u0641\u0638 \u0641\u064A \u0645\u0643\u062A\u0628\u0629 \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A"],
  "prompts.search": ["Search prompts\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A\u2026"],
  "prompts.text": ["Prompt text", "\u0646\u0635 \u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "prompts.textRequired": ["Prompt text is required", "\u0646\u0635 \u0627\u0644\u062A\u0648\u062C\u064A\u0647 \u0645\u0637\u0644\u0648\u0628"],
  "prompts.title": ["Prompt Library", "\u0645\u0643\u062A\u0628\u0629 \u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A"],
  "prompts.tokens": ["tokens", "\u0631\u0645\u0632"],
  "prompts.unit": ["PROMPTS", "\u062A\u0648\u062C\u064A\u0647"],
  "prompts.validation": ["A name and text are required.", "\u0627\u0644\u0627\u0633\u0645 \u0648\u0627\u0644\u0646\u0635 \u0645\u0637\u0644\u0648\u0628\u0627\u0646."],
  "prompts.varHint": ["Tip: write {{path}}-style placeholders to reuse this prompt with different values.", "\u0646\u0635\u064A\u062D\u0629: \u0627\u0643\u062A\u0628 \u0639\u0646\u0627\u0635\u0631 \u0646\u0627\u0626\u0628\u0629 \u0645\u062B\u0644 {{path}} \u0644\u062A\u0639\u064A\u062F \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u062A\u0648\u062C\u064A\u0647 \u0645\u0639 \u0642\u064A\u0645 \u0645\u062E\u062A\u0644\u0641\u0629."],
  "rail.files": ["Files \xB7 project files", "\u0627\u0644\u0645\u0644\u0641\u0627\u062A \xB7 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0634\u0631\u0648\u0639"],
  "rail.home": ["Home", "\u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629"],
  "rail.more": ["More views", "\u0627\u0644\u0645\u0632\u064A\u062F \u0645\u0646 \u0627\u0644\u0639\u0631\u0648\u0636"],
  "rail.more.title": ["All views", "\u0643\u0644 \u0627\u0644\u0623\u0642\u0633\u0627\u0645"],
  "rail.more.utilities": ["Utilities", "\u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "remote.copied": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "remote.copyUrl": ["Copy pairing link", "\u0646\u0633\u062E \u0631\u0627\u0628\u0637 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u0646"],
  "remote.enabled": ["Enable SADEEM Remote", "\u062A\u0641\u0639\u064A\u0644 \u0633\u062F\u064A\u0645 \u0639\u0646 \u0628\u064F\u0639\u062F"],
  "remote.port": ["Port", "\u0627\u0644\u0645\u0646\u0641\u0630"],
  "s1.eyebrow.agent": ["05 / AGENT", "\u0660\u0665 / \u0627\u0644\u0648\u0643\u064A\u0644"],
  "s1.eyebrow.appearance": ["02 / APPEARANCE", "\u0660\u0662 / \u0627\u0644\u0645\u0638\u0647\u0631"],
  "s1.eyebrow.general": ["01 / GENERAL", "\u0660\u0661 / \u0639\u0627\u0645"],
  "s1.eyebrow.notifications": ["11 / NOTIFICATIONS", "\u0661\u0661 / \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062A"],
  "s1.eyebrow.privacy": ["12 / PRIVACY & SECURITY", "\u0661\u0662 / \u0627\u0644\u062E\u0635\u0648\u0635\u064A\u0629 \u0648\u0627\u0644\u0623\u0645\u0627\u0646"],
  "s1.eyebrow.voice": ["04 / VOICE INPUT", "\u0660\u0664 / \u0627\u0644\u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0635\u0648\u062A\u064A"],
  "s4.account.desc": ["Everything stays on this device \u2014 keys never leave SADEEM.", "\u0643\u0644 \u0634\u064A\u0621 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u2014 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0644\u0627 \u062A\u063A\u0627\u062F\u0631 \u0633\u062F\u064A\u0645."],
  "s4.account.eyebrow": ["ACCOUNT \xB7 LOCAL", "\u0627\u0644\u062D\u0633\u0627\u0628 \xB7 \u0645\u062D\u0644\u064A"],
  "s4.advanced.eyebrow": ["13 / ADVANCED", "\u0661\u0663 / \u0645\u062A\u0642\u062F\u0645"],
  "s4.approvals.eyebrow": ["25 / APPROVALS", "\u0662\u0665 / \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "s4.billing.eyebrow": ["14 / ACCOUNT & DATA", "\u0661\u0664 / \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"],
  "s4.evidence.eyebrow": ["19 / PROOF", "\u0661\u0669 / \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "s4.feedback.eyebrow": ["20 / SUGGESTIONS", "\u0662\u0660 / \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A"],
  "s4.git.eyebrow": ["16 / SOURCE CONTROL", "\u0661\u0666 / \u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631"],
  "s4.logs.eyebrow": ["22 / DIAGNOSTICS", "\u0662\u0662 / \u0627\u0644\u0633\u062C\u0644\u0627\u062A"],
  "s4.plans.eyebrow": ["SADEEM / FREE SEASON", "\u0633\u062F\u064A\u0645 / \u0645\u0648\u0633\u0645 \u0645\u062C\u0627\u0646\u064A"],
  "s4.shortcuts.eyebrow": ["18 / KEYBOARD", "\u0661\u0668 / \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "s4.updates.eyebrow": ["21 / UPDATES", "\u0662\u0661 / \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A"],
  "sa.plate.a11y": ["Orbital team plate", "\u0644\u0648\u062D\u0629 \u0627\u0644\u0641\u0631\u064A\u0642 \u0627\u0644\u0645\u062F\u0627\u0631\u064A\u0629"],
  "sa.plate.hint": ["each node opens a detail \xB7 arcs use real progress", "\u0643\u0644 \u0639\u0642\u062F\u0629 \u062A\u0641\u062A\u062D \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \xB7 \u0627\u0644\u0623\u0642\u0648\u0627\u0633 \u0645\u0646 \u0627\u0644\u062A\u0642\u062F\u0645 \u0627\u0644\u062D\u0642\u064A\u0642\u064A"],
  "sb.ring.copied": ["Copied", "\u062A\u0645 \u0627\u0644\u0646\u0633\u062E"],
  "sb.ring.copy": ["Copy breakdown", "\u0646\u0633\u062E \u0627\u0644\u062A\u0641\u0635\u064A\u0644"],
  "sb.ring.copyHint": ["Copy a text summary of this context breakdown", "\u0646\u0633\u062E \u0645\u0644\u062E\u0635 \u0646\u0635\u064A \u0644\u062A\u0641\u0635\u064A\u0644 \u0627\u0644\u0633\u064A\u0627\u0642 \u0647\u0630\u0627"],
  "sb.ring.ctxUnknownShort": ["NO WINDOW", "\u0646\u0627\u0641\u0630\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641\u0629"],
  "sb.ring.freshInput": ["Fresh input", "\u0625\u062F\u062E\u0627\u0644 \u062C\u062F\u064A\u062F"],
  "sb.ring.generated": ["Generated", "\u0645\u064F\u0648\u0644\u064E\u0651\u062F"],
  "sb.ring.remaining": ["Remaining", "\u0627\u0644\u0645\u062A\u0628\u0642\u064A"],
  "sc.explain": ["Explain selection to chat (editor)", "\u0634\u0631\u062D \u0627\u0644\u0645\u062D\u062F\u062F \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 (\u0627\u0644\u0645\u062D\u0631\u0631)"],
  "sch.addNote": ["Approvals are auto-denied on headless runs; a failing test gate suppresses the result.", "\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062A \u062A\u064F\u0631\u0641\u0636 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0641\u064A \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u062F\u0648\u0646 \u0648\u0627\u062C\u0647\u0629\u061B \u0628\u0648\u0627\u0628\u0629 \u0627\u062E\u062A\u0628\u0627\u0631 \u0641\u0627\u0634\u0644\u0629 \u062A\u064F\u062E\u0641\u064A \u0627\u0644\u0646\u062A\u064A\u062C\u0629."],
  "sch.cad.cron": ["Cron", "cron"],
  "sch.cad.day": ["Every day", "\u0643\u0644 \u064A\u0648\u0645"],
  "sch.cad.day0": ["Every day \xB7 midnight", "\u0643\u0644 \u064A\u0648\u0645 \xB7 \u0645\u0646\u062A\u0635\u0641 \u0627\u0644\u0644\u064A\u0644"],
  "sch.cad.every": ["Every", "\u0643\u0644"],
  "sch.cad.hour": ["Every hour", "\u0643\u0644 \u0633\u0627\u0639\u0629"],
  "sch.cad.hourAt": ["Every hour", "\u0643\u0644 \u0633\u0627\u0639\u0629"],
  "sch.cad.min": ["Every minute", "\u0643\u0644 \u062F\u0642\u064A\u0642\u0629"],
  "sch.cad.week": ["Every week", "\u0643\u0644 \u0623\u0633\u0628\u0648\u0639"],
  "sch.cad.weekdays": ["Weekdays", "\u0623\u064A\u0627\u0645 \u0627\u0644\u0639\u0645\u0644"],
  "sch.copyFail": ["Could not copy to clipboard", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0646\u0633\u062E \u0625\u0644\u0649 \u0627\u0644\u062D\u0627\u0641\u0638\u0629"],
  "sch.editFailed": ["Update failed \u2014 the original job was kept", "\u0641\u0634\u0644 \u0627\u0644\u062A\u062D\u062F\u064A\u062B \u2014 \u0627\u062D\u062A\u064F\u0641\u0638 \u0628\u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0623\u0635\u0644\u064A\u0629"],
  "sch.editNote": ["Editing recreates the job \u2014 run history, advanced triggers and the transcript link reset.", "\u0627\u0644\u062A\u0639\u062F\u064A\u0644 \u064A\u064F\u0646\u0634\u0626 \u0627\u0644\u0645\u0647\u0645\u0629 \u0645\u0646 \u062C\u062F\u064A\u062F \u2014 \u064A\u064F\u0639\u0627\u062F \u0636\u0628\u0637 \u0633\u062C\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0648\u0627\u0644\u0645\u0634\u063A\u0644\u0627\u062A \u0627\u0644\u0645\u062A\u0642\u062F\u0645\u0629 \u0648\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629."],
  "sch.editor.sub": ["Name \xB7 prompt \xB7 cadence \xB7 permission ceiling", "\u0627\u0644\u0627\u0633\u0645 \xB7 \u0627\u0644\u0637\u0644\u0628 \xB7 \u0627\u0644\u0648\u062A\u064A\u0631\u0629 \xB7 \u0633\u0642\u0641 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "sch.enabled": ["Enabled", "\u0645\u0641\u0639\u0651\u0644\u0629"],
  "sch.eyebrow": ["AUTOMATION \xB7 SCHEDULE", "\u0627\u0644\u0623\u062A\u0645\u062A\u0629 \xB7 \u0627\u0644\u062C\u062F\u0648\u0644\u0629"],
  "sch.hero.empty": ["Nothing scheduled yet", "\u0644\u0627 \u0634\u064A\u0621 \u0645\u062C\u062F\u0648\u0644 \u0628\u0639\u062F"],
  "sch.hero.emptySub": ["Add a job to see a live countdown here.", "\u0623\u0636\u0641 \u0645\u0647\u0645\u0629 \u0644\u062A\u0631\u0649 \u0639\u062F\u0651\u0627\u062F\u0627\u064B \u062D\u064A\u0627\u064B \u0647\u0646\u0627."],
  "sch.hero.label": ["NEXT SCHEDULED RUN", "\u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u062C\u062F\u0648\u0644 \u0627\u0644\u062A\u0627\u0644\u064A"],
  "sch.hero.left": ["left", "\u0645\u062A\u0628\u0642\u064A\u0629"],
  "sch.hero.progress": ["COUNTDOWN", "\u0627\u0644\u0639\u062F \u0627\u0644\u062A\u0646\u0627\u0632\u0644\u064A"],
  "sch.history.empty": ["No job has run yet. Results will collect here.", "\u0644\u0645 \u062A\u0639\u0645\u0644 \u0623\u064A \u0645\u0647\u0645\u0629 \u0628\u0639\u062F. \u0633\u062A\u062C\u0645\u0639 \u0627\u0644\u0646\u062A\u0627\u0626\u062C \u0647\u0646\u0627."],
  "sch.history.note": ["last run per job", "\u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644 \u0644\u0643\u0644 \u0645\u0647\u0645\u0629"],
  "sch.history.title": ["Recent runs", "\u0627\u0644\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u0644\u0623\u062E\u064A\u0631\u0629"],
  "sch.job1": ["job", "\u0645\u0647\u0645\u0629"],
  "sch.jobs": ["jobs", "\u0645\u0647\u0627\u0645"],
  "sch.kpi.active": ["Active", "\u0646\u0634\u0637\u0629"],
  "sch.kpi.errors": ["Last-run errors", "\u0623\u062E\u0637\u0627\u0621 \u0622\u062E\u0631 \u062A\u0634\u063A\u064A\u0644"],
  "sch.kpi.paused": ["Paused", "\u0645\u062A\u0648\u0642\u0641\u0629"],
  "sch.kpi.ran": ["Jobs with a run", "\u0645\u0647\u0627\u0645 \u0644\u0647\u0627 \u062A\u0634\u063A\u064A\u0644"],
  "sch.list": ["Jobs", "\u0627\u0644\u0645\u0647\u0627\u0645"],
  "sch.mode": ["Permission ceiling", "\u0633\u0642\u0641 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A"],
  "sch.mode.auto": ["Auto-edit", "\u062A\u0639\u062F\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A"],
  "sch.mode.full": ["Full access", "\u0648\u0635\u0648\u0644 \u0643\u0627\u0645\u0644"],
  "sch.mode.read": ["Read-only", "\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637"],
  "sch.preset.day": ["Every day", "\u0643\u0644 \u064A\u0648\u0645"],
  "sch.preset.hour": ["Every hour", "\u0643\u0644 \u0633\u0627\u0639\u0629"],
  "sch.preset.min": ["Every minute", "\u0643\u0644 \u062F\u0642\u064A\u0642\u0629"],
  "sch.preset.weekday": ["Weekdays", "\u0623\u064A\u0627\u0645 \u0627\u0644\u0639\u0645\u0644"],
  "sch.presets": ["Quick presets", "\u0642\u0648\u0627\u0644\u0628 \u0633\u0631\u064A\u0639\u0629"],
  "sch.readOnly": ["READ-ONLY", "\u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637"],
  "sch.recreated": ["Job updated \u2014 run history and advanced triggers were reset", "\u062D\u064F\u062F\u0651\u062B\u062A \u0627\u0644\u0645\u0647\u0645\u0629 \u2014 \u0623\u064F\u0639\u064A\u062F \u0636\u0628\u0637 \u0633\u062C\u0644 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u0648\u0627\u0644\u0645\u0634\u063A\u0644\u0627\u062A \u0627\u0644\u0645\u062A\u0642\u062F\u0645\u0629"],
  "sch.sub": ["Headless agent jobs on a cron clock \u2014 quiet, repeatable, verifiable.", "\u0645\u0647\u0627\u0645 \u0648\u0643\u064A\u0644 \u062F\u0648\u0646 \u0648\u0627\u062C\u0647\u0629 \u0639\u0644\u0649 \u062C\u062F\u0648\u0644 \u0632\u0645\u0646\u064A \u2014 \u0647\u0627\u062F\u0626\u0629 \u0648\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u0643\u0631\u0627\u0631 \u0648\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u062D\u0642\u0642."],
  "sch.webhook.copyJob": ["Copy this job\u2019s webhook URL", "\u0646\u0633\u062E \u0631\u0627\u0628\u0637 webhook \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0647\u0645\u0629"],
  "sch.webhook.copyToken": ["Copy token", "\u0646\u0633\u062E \u0627\u0644\u0631\u0645\u0632"],
  "sch.webhook.copyUrl": ["Copy URL template", "\u0646\u0633\u062E \u0642\u0627\u0644\u0628 \u0627\u0644\u0631\u0627\u0628\u0637"],
  "sch.webhook.desc": ["Loopback-only POST /trigger/<jobId>?token=\u2026 \u2014 fires the job without the cron clock.", "POST \u0639\u0644\u0649 \u0627\u0644\u0645\u0636\u064A\u0641 \u0627\u0644\u0645\u062D\u0644\u064A \u0641\u0642\u0637 /trigger/<jobId>?token=\u2026 \u2014 \u064A\u0634\u063A\u0651\u0644 \u0627\u0644\u0645\u0647\u0645\u0629 \u062F\u0648\u0646 \u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062C\u062F\u0648\u0644."],
  "sch.webhook.live": ["LISTENER READY", "\u0627\u0644\u0645\u0633\u062A\u0645\u0639 \u062C\u0627\u0647\u0632"],
  "sch.webhook.off": ["UNAVAILABLE", "\u063A\u064A\u0631 \u0645\u062A\u0627\u062D"],
  "sch.webhook.title": ["Webhook trigger", "\u0645\u064F\u0634\u063A\u0650\u0651\u0644 Webhook"],
  "sch.webhook.tokenNote": ["Keep the token private \u2014 it grants trigger access.", "\u0627\u062D\u062A\u0641\u0638 \u0628\u0627\u0644\u0631\u0645\u0632 \u0633\u0631\u0627\u064B \u2014 \u064A\u0645\u0646\u062D \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."],
  "sched.edit": ["Edit job", "\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0645\u0647\u0645\u0629"],
  "sched.empty.sub": ["Automate reviews, digests or maintenance \u2014 the agent runs them on a cron.", "\u0623\u062A\u0645\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0627\u062A \u0648\u0627\u0644\u0645\u0644\u062E\u0635\u0627\u062A \u0648\u0627\u0644\u0635\u064A\u0627\u0646\u0629 \u2014 \u0627\u0644\u0648\u0643\u064A\u0644 \u064A\u0646\u0641\u0651\u0630\u0647\u0627 \u062D\u0633\u0628 \u062C\u062F\u0648\u0644 \u0632\u0645\u0646\u064A."],
  "sched.empty.title": ["No scheduled jobs yet", "\u0644\u0627 \u0645\u0647\u0627\u0645 \u0645\u062C\u062F\u0648\u0644\u0629 \u0628\u0639\u062F"],
  "sched.state.running": ["RUNNING", "\u0642\u064A\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "sess.desc": ["Every conversation, archived and resumable \u2014 with a timeline of recent activity.", "\u0643\u0644 \u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u0624\u0631\u0634\u0641\u0629 \u0648\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0627\u0633\u062A\u0626\u0646\u0627\u0641 \u2014 \u0645\u0639 \u062E\u0637 \u0632\u0645\u0646\u064A \u0644\u0644\u0646\u0634\u0627\u0637 \u0627\u0644\u0623\u062E\u064A\u0631."],
  "set.account.activatedAt": ["Activated", "\u0627\u0644\u062A\u0641\u0639\u064A\u0644"],
  "set.account.data": ["Your data", "\u0628\u064A\u0627\u0646\u0627\u062A\u0643"],
  "set.account.data.note": ["Everything SADEEM knows lives in ~/.surnia on this machine. The suggestions box below and the Advanced section keep their own local actions.", "\u0643\u0644 \u0645\u0627 \u062A\u0639\u0631\u0641\u0647 \u0633\u062F\u064A\u0645 \u064A\u0639\u064A\u0634 \u0641\u064A \u200E~/.surnia \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632. \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u062D\u0627\u062A \u0623\u062F\u0646\u0627\u0647 \u0648\u0642\u0633\u0645 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A \u0627\u0644\u0645\u062A\u0642\u062F\u0645\u0629 \u064A\u0628\u0642\u064A\u0627\u0646 \u0623\u0641\u0639\u0627\u0644\u0647\u0645\u0627 \u0627\u0644\u0645\u062D\u0644\u064A\u0629."],
  "set.account.desc": ["SADEEM is local-first: your profile, license and usage live on this device. Nothing here talks to a payment server.", "\u0633\u062F\u064A\u0645 \u0645\u062D\u0644\u064A\u0629 \u0623\u0648\u0644\u0627\u064B: \u0645\u0644\u0641\u0643 \u0648\u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0648\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062A\u0639\u064A\u0634 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632. \u0644\u0627 \u0634\u064A\u0621 \u0647\u0646\u0627 \u064A\u062A\u062D\u062F\u062B \u0645\u0639 \u062E\u0627\u062F\u0645 \u062F\u0641\u0639."],
  "set.account.expires": ["Expiry", "\u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629"],
  "set.account.export": ["Export data (ZIP)", "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A (ZIP)"],
  "set.account.export.done": ["Exported \u2014 revealing the ZIP", "\u062A\u0645 \u0627\u0644\u062A\u0635\u062F\u064A\u0631 \u2014 \u064A\u064F\u0643\u0634\u0641 \u0645\u0644\u0641 ZIP \u0627\u0644\u0622\u0646"],
  "set.account.export.failed": ["Could not create the export", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0646\u0634\u0627\u0621 \u0645\u0644\u0641 \u0627\u0644\u062A\u0635\u062F\u064A\u0631"],
  "set.account.export.go": ["Export", "\u062A\u0635\u062F\u064A\u0631"],
  "set.account.export.hint": ["Bundles settings (API keys redacted), sessions, memory, usage and audit into one ZIP \u2014 saved locally, then revealed in your file manager.", "\u064A\u062C\u0645\u0639 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A (\u0645\u0641\u0627\u062A\u064A\u062D API \u0645\u064F\u0646\u0642\u064E\u0651\u062D\u0629) \u0648\u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0648\u0627\u0644\u0630\u0627\u0643\u0631\u0629 \u0648\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0648\u0627\u0644\u062A\u062F\u0642\u064A\u0642 \u0641\u064A \u0645\u0644\u0641 ZIP \u2014 \u064A\u064F\u062D\u0641\u0638 \u0645\u062D\u0644\u064A\u0627\u064B \u062B\u0645 \u064A\u064F\u0643\u0634\u0641 \u0641\u064A \u0645\u062F\u064A\u0631 \u0627\u0644\u0645\u0644\u0641\u0627\u062A."],
  "set.account.licensedTo": ["Licensed to", "\u0645\u0631\u062E\u0651\u0635 \u0644\u0640"],
  "set.account.mode": ["Mode", "\u0627\u0644\u0648\u0636\u0639"],
  "set.account.mode.local": ["Local \u2014 no servers involved", "\u0645\u062D\u0644\u064A \u2014 \u0628\u0644\u0627 \u062E\u0648\u0627\u062F\u0645"],
  "set.account.perpetual": ["Perpetual \u2014 never expires", "\u062F\u0627\u0626\u0645 \u2014 \u0644\u0627 \u064A\u0646\u062A\u0647\u064A"],
  "set.account.plan": ["Plan & license", "\u0627\u0644\u062E\u0637\u0629 \u0648\u0627\u0644\u062A\u0631\u062E\u064A\u0635"],
  "set.account.probe.failed": ["Could not verify the license on this device \u2014 showing the last known state.", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u062A\u0631\u062E\u064A\u0635 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u2014 \u062A\u064F\u0639\u0631\u0636 \u0622\u062E\u0631 \u062D\u0627\u0644\u0629 \u0645\u0639\u0631\u0648\u0641\u0629."],
  "set.account.profile": ["Local account", "\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u062D\u0644\u064A"],
  "set.account.recheck": ["Re-check", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0641\u062D\u0635"],
  "set.account.source": ["Source", "\u0627\u0644\u0645\u0635\u062F\u0631"],
  "set.account.title": ["Account & Data", "\u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A"],
  "set.account.trialDays": ["{n} trial days left", "\u0645\u062A\u0628\u0642\u064D {n} \u064A\u0648\u0645 \u062A\u062C\u0631\u0628\u0629"],
  "set.account.usage.note": ["Counted locally from your own run history \u2014 nothing is reported anywhere.", "\u064A\u064F\u062D\u0633\u0628 \u0645\u062D\u0644\u064A\u0627\u064B \u0645\u0646 \u0633\u062C\u0644 \u062A\u0634\u063A\u064A\u0644\u0627\u062A\u0643 \u2014 \u0644\u0627 \u064A\u064F\u0628\u0644\u064E\u0651\u063A \u0639\u0646\u0647 \u0644\u0623\u064A \u062C\u0647\u0629."],
  "set.account.usage.session": ["This session: {n} tokens \xB7 {c}", "\u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629: {n} \u062A\u0648\u0643\u0646 \xB7 {c}"],
  "set.group.evidence": ["Evidence", "\u0627\u0644\u0623\u062F\u0644\u0629"],
  "set.group.evidence.desc": ["The honest-agent artifacts: signed proof packages and the False-Done ledger \u2014 real data from this device, read-only.", "\u0623\u062F\u0644\u0629 \u0635\u062F\u0642 \u0627\u0644\u0648\u0643\u064A\u0644: \u062D\u0632\u0645 \u0627\u0644\u0625\u062B\u0628\u0627\u062A \u0627\u0644\u0645\u0648\u0642\u0651\u0639\u0629 \u0648\u0633\u062C\u0644 \xAB\u0627\u0644\u0625\u0646\u062C\u0627\u0632 \u0627\u0644\u0643\u0627\u0630\u0628\xBB \u2014 \u0628\u064A\u0627\u0646\u0627\u062A \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632\u060C \u0644\u0644\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637."],
  "set.group.logs": ["Logs", "\u0627\u0644\u0633\u062C\u0644\u0627\u062A"],
  "set.group.logs.desc": ["The local diagnostics log (main.log) \u2014 always secret-redacted before it is written.", "\u0633\u062C\u0644 \u0627\u0644\u062A\u0634\u062E\u064A\u0635 \u0627\u0644\u0645\u062D\u0644\u064A (main.log) \u2014 \u0645\u0646\u0642\u0651\u062D \u0645\u0646 \u0627\u0644\u0623\u0633\u0631\u0627\u0631 \u0642\u0628\u0644 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u062F\u0648\u0645\u0627\u064B."],
  "set.group.remote": ["SADEEM REMOTE", "\u0633\u062F\u064A\u0645 \u0639\u0646 \u0628\u064F\u0639\u062F"],
  "set.posture.custom": ["Custom mix", "\u0645\u0632\u064A\u062C \u0645\u062E\u0635\u0635"],
  "set.posture.title": ["Posture", "\u0627\u0644\u0646\u0645\u0637"],
  "set.rail.sections": ["Sections", "\u0627\u0644\u0623\u0642\u0633\u0627\u0645"],
  "set.updates.autoCheck": ["Quiet automatic check", "\u0641\u062D\u0635 \u062A\u0644\u0642\u0627\u0626\u064A \u0647\u0627\u062F\u0626"],
  "set.updates.autoCheck.hint": ["Once, 10 minutes after boot \u2014 never downloads", "\u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0628\u0639\u062F \u0627\u0644\u0625\u0642\u0644\u0627\u0639 \u0628\u064010 \u062F\u0642\u0627\u0626\u0642 \u2014 \u062F\u0648\u0646 \u0623\u064A \u062A\u0646\u0632\u064A\u0644"],
  "set.updates.check": ["Check now", "\u0641\u062D\u0635 \u0627\u0644\u0622\u0646"],
  "set.updates.current": ["Current version", "\u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u062D\u0627\u0644\u064A"],
  "set.updates.download": ["Download update", "\u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "set.updates.feed": ["Update feed", "\u062E\u0644\u0627\u0635\u0629 \u0627\u0644\u062A\u062D\u062F\u064A\u062B\u0627\u062A"],
  "set.updates.feed.hint": ["HTTPS only \u2014 or leave empty for the official feed", "HTTPS \u0641\u0642\u0637 \u2014 \u0623\u0648 \u0627\u062A\u0631\u0643\u0647 \u0641\u0627\u0631\u063A\u0627\u064B \u0644\u0644\u062E\u0644\u0627\u0635\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629"],
  "set.updates.install": ["Install and restart", "\u062B\u0628\u0651\u062A \u0648\u0623\u0639\u062F \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "settings.advanced.danger.hint": ["These actions are immediate and local \u2014 they cannot be undone.", "\u0647\u0630\u0647 \u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A \u0641\u0648\u0631\u064A\u0629 \u0648\u0645\u062D\u0644\u064A\u0629 \u2014 \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639 \u0639\u0646\u0647\u0627."],
  "settings.advanced.profile": ["Portable profile", "\u0645\u0644\u0641 \u0645\u062D\u0645\u0648\u0644"],
  "settings.advanced.profile.export": ["Export profile", "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A"],
  "settings.advanced.profile.exported": ["Profile exported \u2014 keep this file private (it contains API keys)", "\u0635\u064F\u062F\u0651\u0631 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A \u2014 \u0627\u062D\u062A\u0641\u0638 \u0628\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0633\u0631\u0627\u064B (\u064A\u062D\u062A\u0648\u064A \u0645\u0641\u0627\u062A\u064A\u062D API)"],
  "settings.advanced.profile.exportFailed": ["Profile export failed", "\u0641\u0634\u0644 \u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A"],
  "settings.advanced.profile.hint": ["Back up or move your whole setup in one file: settings, learned DNA, your skills and saved prompts.", "\u0627\u0646\u0633\u062E \u0625\u0639\u062F\u0627\u062F\u0627\u062A\u0643 \u0643\u0644\u0647\u0627 \u0623\u0648 \u0627\u0646\u0642\u0644\u0647\u0627 \u0641\u064A \u0645\u0644\u0641 \u0648\u0627\u062D\u062F: \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0648\u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u062A\u0639\u0644\u0651\u0645 \u0648\u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629."],
  "settings.advanced.profile.import": ["Import profile", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0645\u0644\u0641 \u0634\u062E\u0635\u064A"],
  "settings.advanced.profile.imported": ["Profile restored: {n} skills, {p} prompts", "\u0627\u0633\u062A\u064F\u0639\u064A\u062F \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A: {n} \u0645\u0647\u0627\u0631\u0629\u060C {p} \u062A\u0648\u062C\u064A\u0647\u0627\u064B"],
  "settings.advanced.profile.importFailed": ["Import failed \u2014 invalid profile file", "\u0641\u0634\u0644 \u0627\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u2014 \u0645\u0644\u0641 \u0634\u062E\u0635\u064A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D"],
  "settings.advanced.profile.privacy": ["Exported JSON contains API keys \u2014 store it somewhere private. Import merges skills/prompts and restores settings/DNA.", "\u0645\u0644\u0641 JSON \u0627\u0644\u0645\u064F\u0635\u062F\u064E\u0651\u0631 \u064A\u062D\u062A\u0648\u064A \u0645\u0641\u0627\u062A\u064A\u062D API \u2014 \u062E\u0632\u0651\u0646\u0647 \u0641\u064A \u0645\u0643\u0627\u0646 \u062E\u0627\u0635. \u0627\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u064A\u062F\u0645\u062C \u0627\u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0648\u0627\u0644\u062A\u0648\u062C\u064A\u0647\u0627\u062A \u0648\u064A\u0633\u062A\u0639\u064A\u062F \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0648\u0627\u0644\u0630\u0627\u0643\u0631\u0629."],
  "settings.agent.embeddings": ["Real embeddings (semantic search)", "\u062A\u0645\u062B\u064A\u0644\u0627\u062A \u062D\u0642\u064A\u0642\u064A\u0629 (\u0628\u062D\u062B \u062F\u0644\u0627\u0644\u064A)"],
  "settings.agent.embeddings.hint": ["Use the configured provider\u2019s /embeddings endpoint for meaning-based code search instead of the offline hasher. Re-indexes on change; falls back to offline if unavailable.", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0646\u0642\u0637\u0629 /embeddings \u0644\u0644\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u0645\u0636\u0628\u0648\u0637 \u0644\u0644\u0628\u062D\u062B \u0627\u0644\u062F\u0644\u0627\u0644\u064A \u0641\u064A \u0627\u0644\u0643\u0648\u062F \u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0627\u0644\u0645\u062C\u0632\u0651\u0626 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644. \u064A\u064F\u0639\u0627\u062F \u0627\u0644\u0641\u0647\u0631\u0633\u0629 \u0639\u0646\u062F \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u061B \u0648\u064A\u0639\u0648\u062F \u0644\u0648\u0636\u0639 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644 \u0639\u0646\u062F \u0639\u062F\u0645 \u0627\u0644\u062A\u0648\u0641\u0631."],
  "settings.agent.inventory": ["Tool inventory", "\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "settings.agent.inventory.hint": ["Every tool below is registered in the engine and callable by the model. Internet set: web_search, web_fetch, http_request, download_file, search_web, open_path (opens URLs in your real browser) + the 8 browser_* automation tools.", "\u0643\u0644 \u0623\u062F\u0627\u0629 \u0623\u062F\u0646\u0627\u0647 \u0645\u0633\u062C\u0651\u0644\u0629 \u0641\u064A \u0627\u0644\u0645\u062D\u0631\u0643 \u0648\u064A\u0645\u0643\u0646 \u0644\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0633\u062A\u062F\u0639\u0627\u0624\u0647\u0627. \u0645\u062C\u0645\u0648\u0639\u0629 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A: web_search \u0648web_fetch \u0648http_request \u0648download_file \u0648search_web \u0648open_path (\u062A\u0641\u062A\u062D \u0631\u0648\u0627\u0628\u0637 \u0641\u064A \u0645\u062A\u0635\u0641\u062D\u0643 \u0627\u0644\u062D\u0642\u064A\u0642\u064A) \u0648\u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062B\u0645\u0627\u0646\u064A\u0629 browser_*."],
  "settings.agent.inventory.total": ["Tools available to the agent", "\u0623\u062F\u0648\u0627\u062A \u0645\u062A\u0627\u062D\u0629 \u0644\u0644\u0648\u0643\u064A\u0644"],
  "settings.agent.router.autoVerify": ["Auto-pick different provider for Verify", "\u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0632\u0648\u0651\u062F \u0645\u062E\u062A\u0644\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0644\u0644\u062A\u062D\u0642\u0642"],
  "settings.agent.router.autoVerify.done": ["Verify now uses a different provider", "\u0627\u0644\u062A\u062D\u0642\u0642 \u064A\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0622\u0646 \u0645\u0632\u0648\u0651\u062F\u0627\u064B \u0645\u062E\u062A\u0644\u0641\u0627\u064B"],
  "settings.agent.router.autoVerify.none": ["No second provider configured \u2014 add one under Providers first.", "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0632\u0648\u0651\u062F \u062B\u0627\u0646\u064D \u2014 \u0623\u0636\u0641 \u0648\u0627\u062D\u062F\u0627\u064B \u0645\u0646 \u0642\u0633\u0645 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u064A\u0646 \u0623\u0648\u0644\u0627\u064B."],
  "settings.agent.router.clearRole": ["Clear override", "\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u062A\u062C\u0627\u0648\u0632"],
  "settings.agent.router.useActive": ["use active model", "\u0627\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0646\u0634\u0637"],
  "settings.agent.router.useActive.hint": ["Pin this role to the active session model", "\u062B\u0628\u0651\u062A \u0647\u0630\u0627 \u0627\u0644\u062F\u0648\u0631 \u0639\u0644\u0649 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0646\u0634\u0637"],
  "settings.agent.taskBudget": ["Cost guardrail per run ($)", "\u0633\u0642\u0641 \u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0644\u0643\u0644 \u062A\u0634\u063A\u064A\u0644 ($)"],
  "settings.agent.taskBudget.hint": ["Hard spend ceiling for ONE run (USD, 0 = unlimited). When the run crosses it, the agent stops and reports honestly instead of burning tokens overnight.", "\u0633\u0642\u0641 \u0625\u0646\u0641\u0627\u0642 \u0635\u0627\u0631\u0645 \u0644\u062A\u0634\u063A\u064A\u0644 \u0648\u0627\u062D\u062F (\u062F\u0648\u0644\u0627\u0631\u060C 0 = \u063A\u064A\u0631 \u0645\u062D\u062F\u0648\u062F). \u0639\u0646\u062F \u062A\u062C\u0627\u0648\u0632\u0647 \u064A\u062A\u0648\u0642\u0641 \u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u064A\u064F\u0628\u0644\u0651\u063A \u0628\u0635\u062F\u0642 \u0628\u062F\u0644 \u062D\u0631\u0642 \u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A \u0637\u0648\u0627\u0644 \u0627\u0644\u0644\u064A\u0644."],
  "settings.agent.toolProfile": ["Tool profile", "\u0645\u0644\u0641 \u0627\u0644\u0623\u062F\u0648\u0627\u062A"],
  "settings.agent.toolProfile.balanced": ["balanced", "\u0645\u062A\u0648\u0627\u0632\u0646"],
  "settings.agent.toolProfile.balanced.desc": ["balanced (default) \u2014 most tools; only the deepest specialists are hidden from the list (they remain callable).", "\u0645\u062A\u0648\u0627\u0632\u0646 (\u0627\u0641\u062A\u0631\u0627\u0636\u064A) \u2014 \u0645\u0639\u0638\u0645 \u0627\u0644\u0623\u062F\u0648\u0627\u062A\u061B \u062A\u064F\u062E\u0641\u0649 \u0639\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0623\u0639\u0645\u0642 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u062A\u062E\u0635\u0635\u064A\u0629 \u0641\u0642\u0637 (\u062A\u0628\u0642\u0649 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0627\u0633\u062A\u062F\u0639\u0627\u0621)."],
  "settings.agent.toolProfile.essential": ["essential", "\u0623\u0633\u0627\u0633\u064A"],
  "settings.agent.toolProfile.essential.desc": ["essential \u2014 ~30 core tools (files, run, search, plan, todos, checkpoints, web). Best for weak/local models.", "\u0623\u0633\u0627\u0633\u064A \u2014 \u0646\u062D\u0648 30 \u0623\u062F\u0627\u0629 \u062C\u0648\u0647\u0631\u064A\u0629 (\u0645\u0644\u0641\u0627\u062A\u060C \u062A\u0634\u063A\u064A\u0644\u060C \u0628\u062D\u062B\u060C \u062E\u0637\u0629\u060C \u0645\u0647\u0627\u0645\u060C \u0646\u0642\u0627\u0637 \u0627\u0633\u062A\u0639\u0627\u062F\u0629\u060C \u0648\u064A\u0628). \u0627\u0644\u0623\u0641\u0636\u0644 \u0644\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0645\u062D\u0644\u064A\u0629 \u0627\u0644\u0636\u0639\u064A\u0641\u0629."],
  "settings.agent.toolProfile.full": ["full", "\u0643\u0627\u0645\u0644"],
  "settings.agent.toolProfile.full.desc": ["full \u2014 all 134 tools are advertised, including LSP, debugger, notebooks and the media/office builders.", "\u0643\u0627\u0645\u0644 \u2014 \u062A\u064F\u0639\u0631\u0636 \u062C\u0645\u064A\u0639 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0640134\u060C \u0628\u0645\u0627 \u0641\u064A\u0647\u0627 LSP \u0648\u0627\u0644\u0645\u0635\u062D\u0651\u062D \u0648\u062F\u0641\u0627\u062A\u0631 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0648\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0648\u0633\u0627\u0626\u0637 \u0648\u0627\u0644\u0645\u0643\u0627\u062A\u0628."],
  "settings.agent.toolProfile.hint": ["Weak models choose better from a short list. No tool is removed \u2014 every tool stays callable; this only changes what is advertised.", "\u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u0636\u0639\u064A\u0641\u0629 \u062A\u062E\u062A\u0627\u0631 \u0628\u0634\u0643\u0644 \u0623\u0641\u0636\u0644 \u0645\u0646 \u0642\u0627\u0626\u0645\u0629 \u0642\u0635\u064A\u0631\u0629. \u0644\u0627 \u062A\u064F\u062D\u0630\u0641 \u0623\u062F\u0627\u0629 \u2014 \u0643\u0644 \u0623\u062F\u0627\u0629 \u062A\u0628\u0642\u0649 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0627\u0633\u062A\u062F\u0639\u0627\u0621\u061B \u0647\u0630\u0627 \u064A\u063A\u064A\u0651\u0631 \u0627\u0644\u0645\u0639\u0631\u0648\u0636 \u0641\u0642\u0637."],
  "settings.agent.toolProfile.label": ["Tools advertised to the model", "\u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u0644\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.editor.fontSize": ["Editor font size", "\u062D\u062C\u0645 \u062E\u0637 \u0627\u0644\u0645\u062D\u0631\u0631"],
  "settings.editor.fontSize.hint": ["10\u201322 px \u2014 applied live.", "10\u201322 \u0628\u0643\u0633\u0644 \u2014 \u064A\u064F\u0637\u0628\u064E\u0651\u0642 \u0641\u0648\u0631\u0627\u064B."],
  "settings.editor.indentGuides": ["Indent guides", "\u0623\u062F\u0644\u0629 \u0627\u0644\u0645\u0633\u0627\u0641\u0627\u062A \u0627\u0644\u0628\u0627\u062F\u0626\u0629"],
  "settings.editor.indentGuides.hint": ["Vertical rulers marking indentation levels.", "\u062E\u0637\u0648\u0637 \u0631\u0623\u0633\u064A\u0629 \u062A\u064F\u0638\u0647\u0631 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0627\u0644\u0625\u0632\u0627\u062D\u0629."],
  "settings.editor.minimap": ["Minimap", "\u0627\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0645\u0635\u063A\u0631\u0629"],
  "settings.editor.minimap.hint": ["The code overview \u2014 the editor toolbar button drives the same field.", "\u0627\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0645\u0635\u063A\u0631\u0629 \u2014 \u062A\u064F\u0632\u0627\u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u062D\u0642\u0644 \u0645\u0639 \u0632\u0631 \u0634\u0631\u064A\u0637 \u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0631."],
  "settings.editor.tabSize": ["Tab size", "\u062D\u062C\u0645 \u0627\u0644\u062C\u062F\u0648\u0644\u0629"],
  "settings.editor.tabSize.hint": ["Indent width the editor inserts.", "\u0639\u0631\u0636 \u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0628\u0627\u062F\u0626\u0629 \u0627\u0644\u0630\u064A \u064A\u064F\u062F\u0631\u062C\u0647 \u0627\u0644\u0645\u062D\u0631\u0631."],
  "settings.editor.wordWrap": ["Word wrap", "\u0627\u0644\u062A\u0641\u0627\u0641 \u0627\u0644\u0623\u0633\u0637\u0631"],
  "settings.editor.wordWrap.hint": ["Wrap long lines inside the editor view (off by default).", "\u0627\u0644\u062A\u0641\u0627\u0641 \u0627\u0644\u0623\u0633\u0637\u0631 \u0627\u0644\u0637\u0648\u064A\u0644\u0629 \u062F\u0627\u062E\u0644 \u0639\u0631\u0636 \u0627\u0644\u0645\u062D\u0631\u0631 (\u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0627\u064B \u0645\u0639\u0637\u0651\u0644)."],
  "settings.editor.wordWrap.off": ["Off", "\u0625\u064A\u0642\u0627\u0641"],
  "settings.editor.wordWrap.on": ["On", "\u062A\u0634\u063A\u064A\u0644"],
  "settings.evidence.claimed": ["Runs claimed done", "\u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0627\u062F\u0651\u0639\u062A \u0627\u0644\u0625\u0646\u062C\u0627\u0632"],
  "settings.evidence.counts": ["Counts", "\u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A"],
  "settings.evidence.empty": ["No proof packages yet \u2014 they land here after the first verified agent run.", "\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0632\u0645 \u0625\u062B\u0628\u0627\u062A \u0628\u0639\u062F \u2014 \u062A\u064F\u0643\u062A\u0628 \u0647\u0646\u0627 \u0628\u0639\u062F \u0623\u0648\u0644 \u062A\u0634\u063A\u064A\u0644 \u064A\u062C\u062A\u0627\u0632 \u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u062A\u062D\u0642\u0642."],
  "settings.evidence.falseDone": ["Overruled by gates", "\u0645\u064F\u0633\u0642\u064E\u0637\u0629 \u0628\u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A"],
  "settings.evidence.falseDoneEmpty": ["The ledger is empty \u2014 every run that claims success and is overruled by the proof gates lands here.", "\u0627\u0644\u0633\u062C\u0644 \u0641\u0627\u0631\u063A \u2014 \u064A\u064F\u0633\u062C\u064E\u0651\u0644 \u0641\u064A\u0647 \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u0627\u062F\u0651\u0639\u0649 \u0627\u0644\u0646\u062C\u0627\u062D \u0648\u062D\u0643\u0645\u062A \u0639\u0644\u064A\u0647 \u0628\u0648\u0627\u0628\u0627\u062A \u0627\u0644\u0625\u062B\u0628\u0627\u062A."],
  "settings.evidence.falseDoneLedger": ["False-Done ledger (published)", "\u0633\u062C\u0644 \u0627\u0644\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0632\u0627\u0626\u0641 (\u0645\u064F\u0646\u0634\u064E\u0631)"],
  "settings.evidence.falseDoneNo": ["verified", "\u0645\u064F\u062A\u062D\u0642\u064E\u0651\u0642"],
  "settings.evidence.falseDoneNote": ["The false-done rate is published as-is \u2014 claimed-success runs the proof gates overrule are counted, never hidden.", "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u0646\u062C\u0627\u0632 \u0627\u0644\u0643\u0627\u0630\u0628 \u064A\u064F\u0646\u0634\u0631 \u0643\u0645\u0627 \u0647\u0648 \u2014 \u0627\u0644\u0625\u062E\u0641\u0627\u0621 \u0644\u064A\u0633 \u062E\u064A\u0627\u0631\u0627\u064B: \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u0627\u062F\u0651\u0639\u0649 \u0627\u0644\u0646\u062C\u0627\u062D \u0648\u0631\u0641\u0636\u062A\u0647 \u0627\u0644\u0628\u0648\u0627\u0628\u0627\u062A \u064A\u064F\u062D\u062A\u0633\u0628."],
  "settings.evidence.falseDoneYes": ["false done", "\u0625\u062A\u0645\u0627\u0645 \u0632\u0627\u0626\u0641"],
  "settings.evidence.latestProofs": ["Latest proof packages", "\u0623\u062D\u062F\u062B \u062D\u0632\u0645 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "settings.evidence.openFolder": ["Open artifacts folder", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0627\u0644\u0623\u062F\u0644\u0629"],
  "settings.evidence.proofs": ["Signed proofs", "\u0625\u062B\u0628\u0627\u062A\u0627\u062A \u0645\u0648\u0642\u064E\u0651\u0639\u0629"],
  "settings.evidence.rate": ["False-done rate", "\u0645\u0639\u062F\u0644 \u0627\u0644\u0625\u062A\u0645\u0627\u0645 \u0627\u0644\u0632\u0627\u0626\u0641"],
  "settings.evidence.readFailed": ["Could not read the artifacts from disk \u2014 try again.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0623\u062F\u0644\u0629 \u0645\u0646 \u0627\u0644\u0642\u0631\u0635 \u2014 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."],
  "settings.git.desc": ["Source control and isolated parallel work: each worktree is a full checkout with its own branch \u2014 the agent (or a chat pinned to it) works there without touching your main tree.", "\u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631 \u0648\u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A \u0627\u0644\u0645\u0639\u0632\u0648\u0644: \u0643\u0644 \u0634\u062C\u0631\u0629 \u0639\u0645\u0644 \u0646\u0633\u062E\u0629 \u0643\u0627\u0645\u0644\u0629 \u0628\u0641\u0631\u0639\u0647\u0627 \u0627\u0644\u062E\u0627\u0635 \u2014 \u064A\u0639\u0645\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 (\u0623\u0648 \u0645\u062D\u0627\u062F\u062B\u0629 \u0645\u062B\u0628\u064E\u0651\u062A\u0629 \u0639\u0644\u064A\u0647\u0627) \u0641\u064A\u0647\u0627 \u062F\u0648\u0646 \u0627\u0644\u0645\u0633\u0627\u0633 \u0628\u0634\u062C\u0631\u062A\u0643 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629."],
  "settings.logs.actions": ["Actions", "\u0627\u0644\u0625\u062C\u0631\u0627\u0621\u0627\u062A"],
  "settings.logs.clear": ["Clear log", "\u0645\u0633\u062D \u0627\u0644\u0633\u062C\u0644"],
  "settings.logs.clear.go": ["Clear", "\u0645\u0633\u062D"],
  "settings.logs.clear.hint": ["Truncates main.log and its rotations on this device \u2014 nothing is sent anywhere.", "\u064A\u062C\u0631\u062F main.log \u0648\u064A\u062F\u0648\u0631\u0627\u062A\u0647 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632 \u2014 \u0644\u0627 \u064A\u064F\u0631\u0633\u0644 \u0634\u064A\u0626\u0627\u064B \u0644\u0623\u064A \u062C\u0647\u0629."],
  "settings.logs.export": ["Export log", "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0633\u062C\u0644"],
  "settings.logs.export.go": ["Export", "\u062A\u0635\u062F\u064A\u0631"],
  "settings.logs.export.hint": ["Downloads the sanitized log tail (last 256KB) as a text file.", "\u064A\u0646\u0632\u0651\u0644 \u0630\u064A\u0644 \u0627\u0644\u0633\u062C\u0644 (\u0622\u062E\u0631 256KB) \u0643\u0645\u0644\u0641 \u0646\u0635\u064A \u0645\u0646\u0642\u0651\u062D \u0645\u0646 \u0627\u0644\u0623\u0633\u0631\u0627\u0631."],
  "settings.logs.file": ["main.log \xB7 512KB \xD7 4 rotations", "main.log \xB7 512KB \xD7 4 \u062A\u062F\u0648\u064A\u0631\u0627\u062A"],
  "settings.logs.level": ["Log level", "\u0645\u0633\u062A\u0648\u0649 \u0627\u0644\u0633\u062C\u0644"],
  "settings.logs.level.hint": ["Minimum level written to main.log \u2014 applied live to the main-process logger.", "\u0623\u062F\u0646\u0649 \u0645\u0633\u062A\u0648\u0649 \u064A\u064F\u0643\u062A\u0628 \u0641\u064A main.log \u2014 \u064A\u064F\u0637\u0628\u064E\u0651\u0642 \u0641\u0648\u0631\u0627\u064B \u0639\u0644\u0649 \u0645\u0631\u0633\u0644 \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0641\u064A \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629."],
  "settings.logs.note": ["Every line is scanned for credential patterns (sk-\u2026, Bearer, AKIA\u2026, ghp_\u2026) before it lands \u2014 matches are replaced with \xABredacted\xBB and counted in the audit.", "\u0643\u0644 \u0633\u0637\u0631 \u064A\u064F\u0641\u062D\u0635 \u0636\u062F \u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u0623\u0633\u0631\u0627\u0631 (sk-\u2026\u060C Bearer\u060C AKIA\u2026\u060C ghp_\u2026) \u0642\u0628\u0644 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u2014 \u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0627\u062A \u062A\u064F\u0633\u062A\u0628\u062F\u0644 \u0628\u0640\xABredacted\xBB \u0648\u062A\u064F\u0639\u062F\u0651 \u0641\u064A \u0627\u0644\u062A\u062F\u0642\u064A\u0642."],
  "settings.logs.openFolder": ["Open log folder", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0627\u0644\u0633\u062C\u0644\u0627\u062A"],
  "settings.logs.openFolder.go": ["Open", "\u0641\u062A\u062D"],
  "settings.logs.openFolder.hint": ["Reveals the logs directory in your OS file manager.", "\u064A\u0643\u0634\u0641 \u0645\u062C\u0644\u062F \u0627\u0644\u0633\u062C\u0644\u0627\u062A \u0641\u064A \u0645\u062F\u064A\u0631 \u0645\u0644\u0641\u0627\u062A \u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."],
  "settings.nav.git": ["Git & Worktrees", "Git \u0648\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "settings.nav.shortcuts": ["Keyboard shortcuts", "\u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0644\u0648\u062D\u0629 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D"],
  "settings.plugins.add": ["Install", "\u062A\u062B\u0628\u064A\u062A"],
  "settings.plugins.added": ["Plugin installed", "\u062B\u064F\u0628\u0651\u062A\u062A \u0627\u0644\u0625\u0636\u0627\u0641\u0629"],
  "settings.plugins.empty": ["No plugins installed yet \u2014 add one below or install a starter pack.", "\u0644\u0627 \u0625\u0636\u0627\u0641\u0627\u062A \u0645\u062B\u0628\u0651\u062A\u0629 \u0628\u0639\u062F \u2014 \u0623\u0636\u0641 \u0648\u0627\u062D\u062F\u0629 \u0623\u062F\u0646\u0627\u0647 \u0623\u0648 \u062B\u0628\u0651\u062A \u062D\u0632\u0645\u0629 \u0628\u062F\u0627\u064A\u0629."],
  "settings.plugins.fromFile": ["From JSON file\u2026", "\u0645\u0646 \u0645\u0644\u0641 JSON\u2026"],
  "settings.plugins.fromUrl": ["From URL", "\u0645\u0646 \u0631\u0627\u0628\u0637"],
  "settings.plugins.import": ["Import", "\u0627\u0633\u062A\u064A\u0631\u0627\u062F"],
  "settings.plugins.installed": ["Installed", "\u0645\u062B\u0628\u0651\u062A\u0629"],
  "settings.plugins.installedOne": ["INSTALLED", "\u0645\u062B\u0628\u0651\u062A\u0629"],
  "settings.plugins.note": ["A plugin manifest is JSON: { id, name, version, mcpServers[], prompts[] } plus an optional skills/ folder beside it. Only https:// URLs are accepted; manifests are capped at 2MB; enabled plugin MCP servers join every agent run automatically.", "\u0628\u064A\u0627\u0646 \u0627\u0644\u0625\u0636\u0627\u0641\u0629 \u0645\u0644\u0641 JSON \u0628\u0645\u0641\u0627\u062A\u064A\u062D id \u0648name \u0648version \u0648\u0642\u0648\u0627\u0626\u0645 mcpServers \u0648prompts\u060C \u0645\u0639 \u0645\u062C\u0644\u062F skills/ \u0627\u062E\u062A\u064A\u0627\u0631\u064A \u0628\u062C\u0627\u0646\u0628\u0647. \u062A\u064F\u0642\u0628\u0644 \u0631\u0648\u0627\u0628\u0637 https:// \u0641\u0642\u0637\u061B \u0627\u0644\u062D\u062F 2MB\u061B \u0648\u062A\u0646\u0636\u0645 \u062E\u0648\u0627\u062F\u0645 MCP \u0644\u0644\u0625\u0636\u0627\u0641\u0627\u062A \u0627\u0644\u0645\u0641\u0639\u0651\u0644\u0629 \u0625\u0644\u0649 \u0643\u0644 \u062A\u0634\u063A\u064A\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B."],
  "settings.plugins.removed": ["Plugin removed", "\u0623\u064F\u0632\u064A\u0644\u062A \u0627\u0644\u0625\u0636\u0627\u0641\u0629"],
  "settings.plugins.reveal": ["Open plugin folder", "\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0627\u0644\u0625\u0636\u0627\u0641\u0629"],
  "settings.plugins.starters": ["Starter packs", "\u062D\u0632\u0645 \u0627\u0644\u0628\u062F\u0627\u064A\u0629"],
  "settings.plugins.uninstall": ["Uninstall", "\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062A\u062B\u0628\u064A\u062A"],
  "settings.preview.customCommand": ["Custom dev-server command", "\u0623\u0645\u0631 \u062E\u0627\u062F\u0645 \u062A\u0637\u0648\u064A\u0631 \u0645\u062E\u0635\u0635"],
  "settings.preview.customCommand.hint": ["ANY runtime \u2014 Go, Rust, PHP, Rails\u2026 run from the workspace root; the URL and port are auto-detected. Example: go run ./cmd/server", "\u0623\u064A \u0628\u064A\u0626\u0629 \u062A\u0634\u063A\u064A\u0644 \u2014 Go \u0648Rust \u0648PHP \u0648Rails\u2026 \u0645\u0646 \u062C\u0630\u0631 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644\u061B \u064A\u064F\u0643\u062A\u0634\u0641 \u0627\u0644\u0631\u0627\u0628\u0637 \u0648\u0627\u0644\u0645\u0646\u0641\u0630 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B. \u0645\u062B\u0627\u0644: go run ./cmd/server"],
  "settings.preview.runtime": ["Runtimes", "\u0628\u064A\u0626\u0627\u062A \u0627\u0644\u062A\u0634\u063A\u064A\u0644"],
  "settings.preview.runtimesHint": ["Detected automatically: npm/Node frameworks (Vite, Next, Nuxt, Angular, Astro, Expo) and Python (Django, FastAPI/uvicorn, Flask, app.py/main.py). No package.json required anymore.", "\u062A\u064F\u0643\u062A\u0634\u0641 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B: \u0623\u0637\u0631 npm/Node (Vite \u0648Next \u0648Nuxt \u0648Angular \u0648Astro \u0648Expo) \u0648Python (Django \u0648FastAPI/uvicorn \u0648Flask \u0648app.py/main.py). \u0644\u0645 \u064A\u0639\u062F package.json \u0645\u0637\u0644\u0648\u0628\u0627\u064B."],
  "settings.providers.empty.cta": ["Add provider key", "\u0625\u0636\u0627\u0641\u0629 \u0645\u0641\u062A\u0627\u062D \u0645\u0632\u0648\u0651\u062F"],
  "settings.providers.empty.hint": ["Add an API key to one provider below \u2014 live model lists and connections activate from that key. Keys stay on this device.", "\u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D API \u0644\u0623\u062D\u062F \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u064A\u0646 \u0623\u062F\u0646\u0627\u0647 \u2014 \u062A\u064F\u0641\u0639\u0651\u0644 \u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0646\u0645\u0627\u0630\u062C \u0627\u0644\u062D\u064A\u0629 \u0648\u0627\u0644\u0627\u062A\u0635\u0627\u0644\u0627\u062A \u0645\u0646 \u0647\u0630\u0627 \u0627\u0644\u0645\u0641\u062A\u0627\u062D. \u062A\u0628\u0642\u0649 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632."],
  "settings.providers.empty.title": ["No provider keys configured", "\u0644\u0627 \u0645\u0641\u0627\u062A\u064A\u062D \u0645\u0632\u0648\u0651\u062F\u064A\u0646 \u0645\u0636\u0628\u0648\u0637\u0629"],
  "settings.providers.state.off": ["Not configured", "\u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637"],
  "settings.shortcuts.cancel": ["Cancel", "\u0625\u0644\u063A\u0627\u0621"],
  "settings.shortcuts.change": ["Change", "\u062A\u063A\u064A\u064A\u0631"],
  "settings.shortcuts.desc": ["Every shortcut in SADEEM. Rebind the core actions \u2014 the binding applies app-wide instantly.", "\u0643\u0644 \u0627\u062E\u062A\u0635\u0627\u0631\u0627\u062A \u0633\u062F\u064A\u0645. \u0623\u0639\u062F \u0631\u0628\u0637 \u0627\u0644\u0623\u0641\u0639\u0627\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629\u060C \u0648\u064A\u064F\u0637\u0628\u064E\u0651\u0642 \u0627\u0644\u0631\u0628\u0637 \u0641\u0648\u0631\u0627\u064B \u0641\u064A \u0643\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642."],
  "settings.shortcuts.honestNote": ["The cheatsheet above shows the built-in keys; your overrides in the Rebindable actions card are what actually fire.", '\u0623\u0648\u0631\u0627\u0642 \u0627\u0644\u063A\u0634 \u0623\u0639\u0644\u0627\u0647 \u062A\u0639\u0631\u0636 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0645\u062F\u0645\u062C\u0629\u061B \u0631\u0628\u0637\u0643 \u0627\u0644\u0645\u062E\u0635\u0635 \u064A\u0638\u0647\u0631 \u0641\u064A \u0628\u0637\u0627\u0642\u0629 "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0631\u0628\u0637" \u0648\u0647\u0648 \u0627\u0644\u0645\u064F\u0641\u0639\u064E\u0651\u0644 \u0641\u0639\u0644\u064A\u0627\u064B.'],
  "settings.shortcuts.openOverlay": ["Prefer the floating cheatsheet?", "\u062A\u0641\u0636\u0651\u0644 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0639\u0627\u0626\u0645\u0629\u061F"],
  "settings.shortcuts.overridden": ["custom binding", "\u0631\u0628\u0637 \u0645\u062E\u0635\u0635"],
  "settings.shortcuts.press": ["Press the keys now (Esc to cancel)", "\u0627\u0636\u063A\u0637 \u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u0622\u0646 (Esc \u0644\u0644\u0625\u0644\u063A\u0627\u0621)"],
  "settings.shortcuts.rebind": ["Rebindable actions", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0631\u0628\u0637"],
  "settings.shortcuts.rebindNote": ["Bindings must include Ctrl/Alt (or an F-key). Shell- and menu-handled actions keep their stock keys until you override them.", "\u0627\u0644\u0631\u0628\u0637 \u064A\u062C\u0628 \u0623\u0646 \u064A\u062A\u0636\u0645\u0646 Ctrl/Alt (\u0623\u0648 \u0645\u0641\u062A\u0627\u062D F). \u0627\u0644\u0623\u0641\u0639\u0627\u0644 \u0627\u0644\u0645\u0631\u0628\u0648\u0637\u0629 \u0641\u064A \u0647\u064A\u0643\u0644 \u0627\u0644\u062A\u0637\u0628\u064A\u0642 \u0623\u0648 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u062A\u062D\u062A\u0641\u0638 \u0628\u0645\u0641\u0627\u062A\u064A\u062D\u0647\u0627 \u0627\u0644\u0623\u0635\u0644\u064A\u0629 \u062D\u062A\u0649 \u062A\u064F\u063A\u064A\u064E\u0651\u0631."],
  "settings.shortcuts.resetAll": ["Reset all", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u0627\u0644\u0643\u0644"],
  "settings.shortcuts.resetOne": ["Reset", "\u0627\u0633\u062A\u0639\u0627\u062F\u0629"],
  "settings.shortcuts.show": ["Show cheatsheet", "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0628\u0637\u0627\u0642\u0629"],
  "settings.terminal.scrollback": ["Scrollback", "\u0633\u062C\u0644 \u0627\u0644\u062A\u0645\u0631\u064A\u0631"],
  "settings.terminal.scrollback.hint": ["Kept terminal lines (1000\u201350000) \u2014 also raises the main-process terminal output cap to match.", "\u062D\u062F \u0623\u0633\u0637\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 (1000\u201350000) \u2014 \u064A\u0631\u0641\u0639 \u0623\u064A\u0636\u0627\u064B \u0633\u0642\u0641 \u0645\u062E\u0631\u062C\u0627\u062A \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0641\u064A \u0627\u0644\u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629."],
  "settings.terminal.shell": ["Shell", "\u0627\u0644\u0637\u0631\u0641\u064A\u0629"],
  "settings.terminal.shell.bashNote": ["bash \u2014 native on Linux/macOS; on Windows it needs bash.exe on PATH.", "bash \u2014 \u0645\u0633\u062A\u062E\u062F\u0645 \u0639\u0644\u0649 \u0644\u064A\u0646\u0643\u0633/\u0645\u0627\u0643\u061B \u0639\u0644\u0649 Windows \u064A\u062A\u0637\u0644\u0628 bash.exe \u0639\u0644\u0649 PATH."],
  "settings.terminal.shell.default": ["Default", "\u0627\u0641\u062A\u0631\u0627\u0636\u064A"],
  "settings.terminal.shell.defaultNote": ["Default: the OS shell.", "\u0627\u0641\u062A\u0631\u0627\u0636\u064A: \u0635\u062F\u0641\u0629 \u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."],
  "settings.terminal.shell.hint": ["The shell that runs integrated-terminal commands. Default follows the OS.", "\u0627\u0644\u0635\u062F\u0641\u0629 \u0627\u0644\u062A\u064A \u062A\u064F\u0634\u063A\u0651\u0644 \u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629 \u0627\u0644\u0645\u062A\u0643\u0627\u0645\u0644\u0629. \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u064A\u062A\u0628\u0639 \u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."],
  "settings.terminal.shell.newTermNote": ["Applies from the next command the terminal runs.", "\u064A\u064F\u0637\u0628\u064E\u0651\u0642 \u0639\u0644\u0649 \u0627\u0644\u0623\u0645\u0631 \u0627\u0644\u062A\u0627\u0644\u064A \u0627\u0644\u0630\u064A \u062A\u0634\u063A\u0651\u0644\u0647 \u0641\u064A \u0627\u0644\u0637\u0631\u0641\u064A\u0629."],
  "settings.terminal.shell.winNote": ["A Windows choice \u2014 on other systems SADEEM falls back to the OS bash.", "\u062E\u064A\u0627\u0631 Windows \u2014 \u0639\u0644\u0649 \u0627\u0644\u0623\u0646\u0638\u0645\u0629 \u0627\u0644\u0623\u062E\u0631\u0649 \u064A\u064F\u0633\u062A\u062E\u062F\u0645 bash \u062A\u0648\u0627\u0645\u0627\u064B \u0645\u0639 \u0646\u0638\u0627\u0645 \u0627\u0644\u062A\u0634\u063A\u064A\u0644."],
  "settings.voice.asrModel": ["Model override", "\u062A\u062C\u0627\u0648\u0632 \u0627\u0644\u0646\u0645\u0648\u0630\u062C"],
  "settings.voice.asrModel.hint": ["Leave empty for the preset model of the chosen provider.", "\u0627\u062A\u0631\u0643\u0647 \u0641\u0627\u0631\u063A\u0627\u064B \u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0645\u064F\u0639\u062F\u0651 \u0644\u0644\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u0645\u062E\u062A\u0627\u0631."],
  "settings.voice.asrProvider": ["Transcription provider", "\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u062A\u0641\u0631\u064A\u063A \u0627\u0644\u0635\u0648\u062A\u064A"],
  "settings.voice.asrProvider.hint": ["Auto uses the active provider when it supports speech-to-text. Z.AI uses GLM-ASR, Groq uses Whisper-large-v3, OpenAI uses Whisper-1.", "\u062A\u0644\u0642\u0627\u0626\u064A \u064A\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u0646\u0634\u0637 \u0639\u0646\u062F \u062F\u0639\u0645\u0647 \u0644\u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0643\u0644\u0627\u0645 \u0625\u0644\u0649 \u0646\u0635. Z.AI \u064A\u0633\u062A\u062E\u062F\u0645 GLM-ASR \u0648Groq \u064A\u0633\u062A\u062E\u062F\u0645 Whisper-large-v3 \u0648OpenAI \u064A\u0633\u062A\u062E\u062F\u0645 Whisper-1."],
  "settings.voice.autoSend": ["Auto-send transcript", "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0646\u0635 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B"],
  "settings.voice.autoSend.hint": ["Send the transcript automatically when dictation finishes (consumed by the transcription pipeline).", "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0641\u0631\u0651\u063A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0625\u0645\u0644\u0627\u0621 (\u064A\u062A\u0639\u064A\u0651\u0646\u0647 \u062E\u0637 \u0623\u0646\u0627\u0628\u064A\u0628 \u0627\u0644\u062A\u0641\u0631\u064A\u063A)."],
  "settings.voice.copy": ["Copy transcript", "\u0646\u0633\u062E \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0646\u0642\u0648\u0644"],
  "settings.voice.desc": ["Microphone dictation in the composer \u2014 speech to text through your provider.", "\u0627\u0644\u0625\u0645\u0644\u0627\u0621 \u0639\u0628\u0631 \u0627\u0644\u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646 \u0641\u064A \u0627\u0644\u0645\u062D\u0631\u0651\u0631 \u2014 \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0643\u0644\u0627\u0645 \u0625\u0644\u0649 \u0646\u0635 \u0639\u0628\u0631 \u0645\u0632\u0648\u0651\u062F\u0643."],
  "settings.voice.device": ["Microphone", "\u0627\u0644\u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646"],
  "settings.voice.device.hint": ["Click the list to enumerate connected microphones. Labels appear once mic permission is granted. Default = system microphone.", "\u0627\u0646\u0642\u0631 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0644\u0639\u0631\u0636 \u0627\u0644\u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646\u0627\u062A \u0627\u0644\u0645\u062A\u0635\u0644\u0629. \u0627\u0644\u0623\u0633\u0645\u0627\u0621 \u062A\u0638\u0647\u0631 \u0628\u0639\u062F \u0645\u0646\u062D \u0627\u0644\u0625\u0630\u0646. \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A = \u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646 \u0627\u0644\u0646\u0638\u0627\u0645."],
  "settings.voice.language": ["Dictation language", "\u0644\u063A\u0629 \u0627\u0644\u0625\u0645\u0644\u0627\u0621"],
  "settings.voice.language.hint": ["BCP-47 language hint (e.g. en-US or ar-SA) \u2014 passed to the transcription pipeline.", "\u0644\u063A\u0629 \u0627\u0644\u0625\u0645\u0644\u0627\u0621 \u0628\u0635\u064A\u063A\u0629 BCP-47 (\u0645\u062B\u0644 en-US \u0623\u0648 ar-SA) \u2014 \u062A\u064F\u0645\u0631\u064E\u0651\u0631 \u0644\u062E\u0637 \u0623\u0646\u0627\u0628\u064A\u0628 \u0627\u0644\u062A\u0641\u0631\u064A\u063A."],
  "settings.voice.note": ["Recording stays local; only the short audio clip is sent to the transcription endpoint you choose. Voice works with OpenAI-compatible providers and Z.AI/GLM. Anthropic and local Ollama expose no transcription route \u2014 pick Auto with another provider, or pin one here. The mic records 16 kHz mono WAV.", "\u064A\u0628\u0642\u0649 \u0627\u0644\u062A\u0633\u062C\u064A\u0644 \u0645\u062D\u0644\u064A\u0627\u064B\u061B \u062A\u064F\u0631\u0633\u0644 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629 \u0627\u0644\u0635\u0648\u062A\u064A\u0629 \u0627\u0644\u0642\u0635\u064A\u0631\u0629 \u0641\u0642\u0637 \u0625\u0644\u0649 \u0646\u0642\u0637\u0629 \u0627\u0644\u062A\u0641\u0631\u064A\u063A \u0627\u0644\u062A\u064A \u062A\u062E\u062A\u0627\u0631\u0647\u0627. \u064A\u0639\u0645\u0644 \u0627\u0644\u0635\u0648\u062A \u0645\u0639 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0627\u062A \u0627\u0644\u0645\u062A\u0648\u0627\u0641\u0642\u0629 \u0645\u0639 OpenAI \u0648Z.AI/GLM. \u0644\u0627 \u064A\u0648\u0641\u0651\u0631 Anthropic \u0648\u0644\u0627 Ollama \u0627\u0644\u0645\u062D\u0644\u064A \u0645\u0633\u0627\u0631 \u062A\u0641\u0631\u064A\u063A \u2014 \u0627\u062E\u062A\u0631 Auto \u0645\u0639 \u0645\u0632\u0648\u0651\u062F \u0622\u062E\u0631 \u0623\u0648 \u062B\u0628\u0651\u062A \u0648\u0627\u062D\u062F\u0627\u064B \u0647\u0646\u0627. \u064A\u0633\u062C\u0651\u0644 \u0627\u0644\u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646 WAV \u0623\u062D\u0627\u062F\u064A 16 kHz."],
  "settings.voice.record": ["Record 3s and transcribe", "\u062A\u0633\u062C\u064A\u0644 3 \u062B\u0648\u0627\u0646\u064D \u0648\u062A\u0641\u0631\u064A\u063A\u0647\u0627"],
  "settings.voice.stop": ["Stop", "\u0625\u064A\u0642\u0627\u0641"],
  "settings.voice.test": ["Live test", "\u0627\u062E\u062A\u0628\u0627\u0631 \u062D\u064A\u0651"],
  "settings.voice.testHint": ["Speaks through the exact production pipeline the composer mic uses.", "\u064A\u0645\u0631\u0651 \u0639\u0628\u0631 \u0645\u0633\u0627\u0631 \u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0630\u0627\u062A\u0647 \u0627\u0644\u0630\u064A \u064A\u0633\u062A\u062E\u062F\u0645\u0647 \u0645\u064A\u0643\u0631\u0648\u0641\u0648\u0646 \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0643\u062A\u0627\u0628\u0629."],
  "settings.wt.create": ["Create worktree", "\u0625\u0646\u0634\u0627\u0621 \u0634\u062C\u0631\u0629 \u0639\u0645\u0644"],
  "settings.wt.dirty": ["has changes", "\u062A\u0648\u062C\u062F \u062A\u063A\u064A\u064A\u0631\u0627\u062A"],
  "settings.wt.empty": ["Not a git repository, or no worktrees yet \u2014 create one above to try isolated parallel work.", "\u0644\u064A\u0633 \u0645\u0633\u062A\u0648\u062F\u0639 git\u060C \u0623\u0648 \u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0634\u062C\u0627\u0631 \u0639\u0645\u0644 \u0628\u0639\u062F \u2014 \u0623\u0646\u0634\u0626 \u0648\u0627\u062D\u062F\u0629 \u0623\u0639\u0644\u0627\u0647 \u0644\u062A\u062C\u0631\u0628\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A \u0627\u0644\u0645\u0639\u0632\u0648\u0644."],
  "settings.wt.how": ["How worktrees work", "\u0643\u064A\u0641 \u062A\u0639\u0645\u0644 \u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "settings.wt.list": ["Worktrees in this workspace", "\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629"],
  "settings.wt.merge": ["Merge", "\u062F\u0645\u062C"],
  "settings.wt.mergeHint": ["Merge this worktree back into the current branch", "\u062F\u0645\u062C \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647 \u0641\u064A \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062D\u0627\u0644\u064A"],
  "settings.wt.noWs": ["Open a project first \u2014 worktrees live inside a git repository.", "\u0627\u0641\u062A\u062D \u0645\u0634\u0631\u0648\u0639\u0627\u064B \u0623\u0648\u0644\u0627\u064B \u2014 \u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644 \u062A\u0639\u0645\u0644 \u062F\u0627\u062E\u0644 \u0645\u0633\u062A\u0648\u062F\u0639 git."],
  "settings.wt.placeholder": ["feature-name", "\u0627\u0633\u0645-\u0627\u0644\u0645\u064A\u0632\u0629"],
  "settings.wt.remove": ["Remove this worktree", "\u0625\u0632\u0627\u0644\u0629 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647"],
  "settings.wt.step1": ["Create one below or from the Worktree chip under the composer \u2014 SADEEM adds a sibling folder + branch sadeem/<name>.", "\u0623\u0646\u0634\u0626 \u0648\u0627\u062D\u062F\u0629 \u0623\u062F\u0646\u0627\u0647 \u0623\u0648 \u0645\u0646 \u0634\u0631\u064A\u0637 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u062A\u062D\u062A \u0635\u0646\u062F\u0648\u0642 \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u2014 \u064A\u0636\u064A\u0641 \u0633\u062F\u064A\u0645 \u0645\u062C\u0644\u062F\u0627\u064B \u0648\u0641\u0631\u0639\u0627\u064B \u0628\u062C\u0648\u0627\u0631\u0647\u0627 \u0628\u0627\u0633\u0645 sadeem/<name>."],
  "settings.wt.step2": ["Pin a chat to it (Worktree chip): the agent, its tools and the live preview all run inside that tree \u2014 parallel tasks never collide.", "\u062B\u0628\u0651\u062A \u0645\u062D\u0627\u062F\u062B\u0629 \u0639\u0644\u064A\u0647\u0627 (\u0634\u0631\u064A\u0637 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644): \u0627\u0644\u0648\u0643\u064A\u0644 \u0648\u0623\u062F\u0648\u0627\u062A\u0647 \u0648\u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u0627\u0644\u062D\u064A\u0629 \u0643\u0644\u0647\u0627 \u062A\u0639\u0645\u0644 \u062F\u0627\u062E\u0644 \u062A\u0644\u0643 \u0627\u0644\u0634\u062C\u0631\u0629 \u2014 \u0644\u0627 \u062A\u062A\u0635\u0627\u062F\u0645 \u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A\u0629."],
  "settings.wt.step3": ["Merge back from the Git panel when the work is done; ignored files listed in .worktreeinclude are copied into new trees automatically.", "\u0627\u062F\u0645\u062C\u0647\u0627 \u0645\u0646 \u0644\u0648\u062D\u0629 Git \u0639\u0646\u062F \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0639\u0645\u0644\u061B \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u064F\u0647\u0645\u064E\u0644\u0629 \u0627\u0644\u0645\u062F\u0631\u062C\u0629 \u0641\u064A .worktreeinclude \u062A\u064F\u0646\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B."],
  "skills.desc": ["Reusable instructions the agent loads on demand, stored as plain files.", "\u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0642\u0627\u0628\u0644\u0629 \u0644\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u064A\u062D\u0645\u0651\u0644\u0647\u0627 \u0627\u0644\u0648\u0643\u064A\u0644 \u0639\u0646\u062F \u0627\u0644\u0637\u0644\u0628\u060C \u0645\u062D\u0641\u0648\u0638\u0629 \u0643\u0645\u0644\u0641\u0627\u062A \u0639\u0627\u062F\u064A\u0629."],
  "skills.market.empty": ["No marketplace skills available.", "\u0644\u0627 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u062A\u0627\u062D\u0629 \u0641\u064A \u0627\u0644\u0633\u0648\u0642."],
  "skills.market.failed": ["Could not remove", "\u062A\u0639\u0630\u0651\u0631\u062A \u0627\u0644\u0625\u0632\u0627\u0644\u0629"],
  "skills.market.install": ["Install", "\u062A\u062B\u0628\u064A\u062A"],
  "skills.market.installed": ["Installed", "\u0645\u062B\u0628\u0651\u062A\u0629"],
  "skills.market.loading": ["Loading catalog\u2026", "\u062C\u0627\u0631\u064D \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C\u2026"],
  "skills.market.remove": ["Remove", "\u0625\u0632\u0627\u0644\u0629"],
  "skills.market.removed": ["Removed", "\u0623\u064F\u0632\u064A\u0644\u062A"],
  "skills.market.title": ["Marketplace", "\u0627\u0644\u0633\u0648\u0642"],
  "skills.trust.body": ["Workspace skills can instruct the agent. Trust them if you wrote them or reviewed them.", "\u064A\u0645\u0643\u0646 \u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u062A\u0648\u062C\u064A\u0647 \u0627\u0644\u0648\u0643\u064A\u0644. \u0627\u0645\u0646\u062D\u0647\u0627 \u0627\u0644\u062B\u0642\u0629 \u0625\u0646 \u0643\u0646\u062A \u0643\u062A\u0628\u062A\u0647\u0627 \u0623\u0648 \u0631\u0627\u062C\u0639\u062A\u0647\u0627."],
  "skills.trust.btn": ["Trust workspace skills", "\u0648\u062B\u0651\u0642 \u0628\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "skills.trust.title": ["Trust this workspace\u2019s skills?", "\u0645\u0646\u062D \u0627\u0644\u062B\u0642\u0629 \u0644\u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644\u061F"],
  "slash.arg.goal": ["objective", "\u0627\u0644\u0647\u062F\u0641"],
  "slash.arg.topic": ["topic", "\u0627\u0644\u0645\u0648\u0636\u0648\u0639"],
  "slash.custom.noDesc": ["Workspace command", "\u0623\u0645\u0631 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644"],
  "slash.grill.desc": ["Interview me before coding (recommended options first)", "\u0645\u0642\u0627\u0628\u0644\u0629 \u0623\u0633\u0626\u0644\u0629 \u0642\u0628\u0644 \u0627\u0644\u0628\u0631\u0645\u062C\u0629 (\u062E\u064A\u0627\u0631\u0627\u062A \u0645\u0648\u0635\u0649 \u0628\u0647\u0627)"],
  "slash.handoff.desc": ["Session handoff note (HANDOFF.md) for resuming later", "\u0645\u0630\u0643\u0631\u0629 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u062C\u0644\u0633\u0629 (HANDOFF.md) \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0644\u0627\u062D\u0642\u0627\u064B"],
  "slash.menu": ["Slash commands", "\u0623\u0648\u0627\u0645\u0631 \u0627\u0644\u0634\u0631\u0637\u0629 \u0627\u0644\u0645\u0627\u0626\u0644\u0629"],
  "status.guestPass": ["Guest pass \u2014 click to manage the account", "\u0648\u0636\u0639 \u0627\u0644\u0636\u064A\u0641 \u2014 \u0627\u0636\u063A\u0637 \u0644\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u062D\u0633\u0627\u0628"],
  "term.stripEyebrow": ["PTY / SESSION", "PTY / \u0627\u0644\u062C\u0644\u0633\u0629"],
  "usage.cachedTokens": ["Cache-read tokens", "\u062A\u0648\u0643\u0646\u0627\u062A \u0645\u0642\u0631\u0648\u0621\u0629 \u0645\u0646 \u0627\u0644\u0643\u0627\u0634"],
  "usage.cacheHit": ["Cache hit rate", "\u0645\u0639\u062F\u0644 \u0625\u0635\u0627\u0628\u0629 \u0627\u0644\u0643\u0627\u0634"],
  "usage.caching": ["caching", "\u0643\u0627\u0634"],
  "usage.cachingHint": ["Prompt caching across requests", "\u062A\u062E\u0632\u064A\u0646 \u0627\u0644\u0633\u064A\u0627\u0642 \u0645\u0624\u0642\u062A\u0627\u064B \u0628\u064A\u0646 \u0627\u0644\u0637\u0644\u0628\u0627\u062A"],
  "usage.compact": ["auto-compact", "\u0636\u063A\u0637 \u062A\u0644\u0642\u0627\u0626\u064A"],
  "usage.compactHint": ["Auto-compact long sessions before the window fills", "\u0636\u063A\u0637 \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0637\u0648\u064A\u0644\u0629 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0642\u0628\u0644 \u0628\u0644\u0648\u063A \u0627\u0644\u0646\u0627\u0641\u0630\u0629"],
  "usage.economy": ["Token economy", "\u0627\u0642\u062A\u0635\u0627\u062F \u0627\u0644\u062A\u0648\u0643\u0646\u0627\u062A"],
  "usage.empty": ["No runs in this window yet \u2014 usage appears here as you work", "\u0644\u0627 \u062A\u0634\u063A\u064A\u0644\u0627\u062A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0641\u062A\u0631\u0629 \u0628\u0639\u062F \u2014 \u064A\u0638\u0647\u0631 \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0647\u0646\u0627 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0639\u0645\u0644"],
  "usage.savedTokens": ["Saved by cache (billed at 0.1x)", "\u0645\u0627 \u0648\u0641\u0651\u0631\u0647 \u0627\u0644\u0643\u0627\u0634 (\u062A\u0648\u0643\u0646\u0627\u062A \u0645\u064F\u062D\u0627\u0633\u064E\u0628\u0629 \xD70.1)"],
  "whatsnew.close": ["Close", "\u0625\u063A\u0644\u0627\u0642"],
  "whatsnew.got": ["Great \u2014 let\u2019s go", "\u0631\u0627\u0626\u0639 \u2014 \u0644\u0646\u0628\u062F\u0623"],
  "whatsnew.title": ["What's new", "\u062C\u062F\u064A\u062F \u0641\u064A \u0633\u062F\u064A\u0645"],
  "wiki.spread.index": ["Index", "\u0627\u0644\u0641\u0647\u0631\u0633"],
  "ws.emptyFolder": ["Empty folder", "\u0645\u062C\u0644\u062F \u0641\u0627\u0631\u063A"],
  "ws.emptyFolderHint": ["This workspace has no files yet \u2014 ask the agent or create one", "\u0644\u0627 \u0645\u0644\u0641\u0627\u062A \u0641\u064A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u0628\u0639\u062F \u2014 \u0627\u0637\u0644\u0628 \u0645\u0646 \u0627\u0644\u0648\u0643\u064A\u0644 \u0623\u0648 \u0623\u0646\u0634\u0626 \u0645\u0644\u0641\u0627\u064B"],
  "ws.emptyHint": ["Open a folder to browse and edit its files", "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0644\u062A\u0635\u0641\u062D \u0645\u0644\u0641\u0627\u062A\u0647 \u0648\u062A\u062D\u0631\u064A\u0631\u0647\u0627"],
  "ws.searchContents": ["Search file contents\u2026", "\u0627\u0628\u062D\u062B \u0641\u064A \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u0644\u0641\u0627\u062A\u2026"],
  "ws.stAdded": ["Added", "\u0645\u0636\u0627\u0641"],
  "ws.stDeleted": ["Deleted", "\u0645\u062D\u0630\u0648\u0641"],
  "ws.stModified": ["Modified", "\u0645\u0639\u062F\u064E\u0651\u0644"],
  "ws.stRenamed": ["Renamed", "\u0645\u064F\u0639\u0627\u062F \u062A\u0633\u0645\u064A\u062A\u0647"],
  "ws.stUntracked": ["Untracked", "\u063A\u064A\u0631 \u0645\u062A\u062A\u0628\u064E\u0651\u0639"],
  "wscc.wtRunHere": ["Run THIS chat in this worktree (hand-off)", "\u0634\u063A\u0651\u0644 \u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0641\u064A \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0647\u0630\u0647 (\u062A\u0633\u0644\u064A\u0645)"],
  "wscc.wtThisChat": ["THIS CHAT", "\u0647\u0630\u0647 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629"],
  "wt.chipMain": ["Main tree", "\u0627\u0644\u0634\u062C\u0631\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629"],
  "wt.create": ["Create", "\u0625\u0646\u0634\u0627\u0621"],
  "wt.foot": ["Each worktree is an isolated checkout \u2014 the agent works and runs there, then you merge with one click.", "\u0643\u0644 \u0634\u062C\u0631\u0629 \u0639\u0645\u0644 \u0646\u0633\u062E\u0629 \u0645\u0639\u0632\u0648\u0644\u0629 \u0644\u0644\u0645\u0633\u062A\u0648\u062F\u0639 \u2014 \u0627\u0644\u0639\u0645\u0644 \u0648\u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u064A\u062C\u0631\u064A\u0627\u0646 \u0641\u064A\u0647\u0627 \u062B\u0645 \u064A\u064F\u062F\u0645\u064E\u062C \u0628\u0636\u063A\u0637\u0629."],
  "wt.mainTree": ["Main tree", "\u0627\u0644\u0634\u062C\u0631\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629"],
  "wt.menu": ["Worktrees", "\u0623\u0634\u062C\u0627\u0631 \u0627\u0644\u0639\u0645\u0644"],
  "wt.new": ["New worktree\u2026", "\u0634\u062C\u0631\u0629 \u0639\u0645\u0644 \u062C\u062F\u064A\u062F\u0629\u2026"],
  "wt.none": ["No worktrees yet", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0623\u0634\u062C\u0627\u0631 \u0639\u0645\u0644 \u0628\u0639\u062F"],
  "wt.where": ["Where this chat runs", "\u0623\u064A\u0646 \u062A\u0639\u0645\u0644 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629"]
};
Object.assign(D, D_V1121_FINAL);
var D_V1121_TALLY = {
  "proof.tally.pass": ["PASS", "\u0646\u0627\u062C\u062D"],
  "proof.tally.fail": ["FAIL", "\u0641\u0627\u0634\u0644"],
  "proof.tally.warn": ["WARN", "\u062A\u062D\u0630\u064A\u0631"],
  "proof.copy.done": ["Evidence copied", "\u062A\u0645 \u0646\u0633\u062E \u0627\u0644\u0623\u062F\u0644\u0629"],
  "proof.copy.fail": ["Could not copy evidence", "\u062A\u0639\u0630\u0651\u0631 \u0646\u0633\u062E \u0627\u0644\u0623\u062F\u0644\u0629"],
  "proof.copy.tip": ["Copy evidence", "\u0646\u0633\u062E \u0627\u0644\u0623\u062F\u0644\u0629"],
  "proof.copySummary": ["proof evidence: {p} passed / {f} failed / {w} warnings", "\u0625\u062B\u0628\u0627\u062A: {p} \u0646\u0627\u062C\u062D / {f} \u0641\u0627\u0634\u0644 / {w} \u062A\u062D\u0630\u064A\u0631"]
};
Object.assign(D, D_V1121_TALLY);
var D_ERR_I18N = {
  "err.run.badParams": [
    "Run not started \u2014 the request had no messages or no model selected. Open Settings \u2192 AI providers, choose a model, and send your message again.",
    "\u0644\u0645 \u064A\u0628\u062F\u0623 \u0627\u0644\u062A\u0634\u063A\u064A\u0644 \u2014 \u0627\u0644\u0637\u0644\u0628 \u0628\u0644\u0627 \u0631\u0633\u0627\u0626\u0644 \u0623\u0648 \u062F\u0648\u0646 \u0627\u062E\u062A\u064A\u0627\u0631 \u0646\u0645\u0648\u0630\u062C. \u0627\u0641\u062A\u062D \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A\u060C \u0627\u062E\u062A\u0631 \u0646\u0645\u0648\u0630\u062C\u0627\u064B\u060C \u062B\u0645 \u0623\u0639\u062F \u0625\u0631\u0633\u0627\u0644 \u0631\u0633\u0627\u0644\u062A\u0643."
  ],
  "err.run.noUserMessage": [
    "Nothing to send \u2014 your message is empty. Type a task in the composer and press Send.",
    "\u0644\u0627 \u0634\u064A\u0621 \u0644\u0644\u0625\u0631\u0633\u0627\u0644 \u2014 \u0631\u0633\u0627\u0644\u062A\u0643 \u0641\u0627\u0631\u063A\u0629. \u0627\u0643\u062A\u0628 \u0645\u0647\u0645\u0629 \u0641\u064A \u062D\u0642\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u062B\u0645 \u0627\u0636\u063A\u0637 \u0625\u0631\u0633\u0627\u0644."
  ],
  "err.run.rateLimited": [
    "The provider is rate-limiting requests right now. Wait a moment and try again, or add another provider/model in Settings \u2192 AI providers.",
    "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u064A\u062D\u062F\u0651\u062F \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u062D\u0627\u0644\u064A\u0627\u064B. \u0627\u0646\u062A\u0638\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u060C \u0623\u0648 \u0623\u0636\u0641 \u0645\u0632\u0648\u0651\u062F\u0627\u064B/\u0646\u0645\u0648\u0630\u062C\u0627\u064B \u0622\u062E\u0631 \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A."
  ],
  "err.run.providerUnavailable": [
    "The provider is unavailable right now. Check your connection, then try again or switch the provider/model in Settings \u2192 AI providers.",
    "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u0627\u064B. \u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u062A\u0635\u0627\u0644\u0643\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F/\u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A."
  ],
  "err.setup.noModel": [
    "No model is selected. Open Settings \u2192 AI providers and choose a model, then send your message again.",
    "\u0644\u0627 \u064A\u0648\u062C\u062F \u0646\u0645\u0648\u0630\u062C \u0645\u062E\u062A\u0627\u0631. \u0627\u0641\u062A\u062D \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0648\u0627\u062E\u062A\u0631 \u0646\u0645\u0648\u0630\u062C\u0627\u064B\u060C \u062B\u0645 \u0623\u0639\u062F \u0625\u0631\u0633\u0627\u0644 \u0631\u0633\u0627\u0644\u062A\u0643."
  ],
  "err.setup.noWorkspace": [
    "No workspace is open. Open a project folder first, then send your message again.",
    "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0633\u0627\u062D\u0629 \u0639\u0645\u0644 \u0645\u0641\u062A\u0648\u062D\u0629. \u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0645\u0634\u0631\u0648\u0639 \u0623\u0648\u0644\u0627\u064B\u060C \u062B\u0645 \u0623\u0639\u062F \u0625\u0631\u0633\u0627\u0644 \u0631\u0633\u0627\u0644\u062A\u0643."
  ],
  "err.setup.noApiKey": [
    "This provider has no API key. Open Settings \u2192 AI providers and add a key for the provider, then try again.",
    "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0641\u062A\u0627\u062D API \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0632\u0648\u0651\u062F. \u0627\u0641\u062A\u062D \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0648\u0623\u0636\u0641 \u0645\u0641\u062A\u0627\u062D\u0627\u064B \u0644\u0644\u0645\u0632\u0648\u0651\u062F\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."
  ],
  "err.setup.noCredits": [
    "Insufficient credits: add balance to the provider account or switch the provider/key in Settings \u2192 Providers.",
    "\u0631\u0635\u064A\u062F \u063A\u064A\u0631 \u0643\u0627\u0641\u064D: \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0644\u064A\u0633 \u0644\u062F\u064A\u0647 \u0631\u0635\u064A\u062F. \u0623\u0636\u0641 \u0631\u0635\u064A\u062F\u0627\u064B \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F/\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0648\u0646."
  ]
};
Object.assign(D, D_ERR_I18N);
var D_V1131_I18N_SWEEP = {
  "chat.copyFailed": ["Could not copy", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0646\u0633\u062E"],
  "dna.fbShown": ["last {n} shown", "\u0622\u062E\u0631 {n} \u0645\u0639\u0631\u0648\u0636\u0629"],
  "mv.compaction": ["CTX compaction {before}% \u2192 {after}%", "\u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642 {before}\u066A \u2190 {after}\u066A"],
  "mv.findings.count": ["{n} FINDINGS", "{n} \u0645\u0644\u0627\u062D\u0638\u0629"],
  "mv.findings.none": ["NO FINDINGS", "\u0644\u0627 \u0645\u0644\u0627\u062D\u0638\u0627\u062A"],
  "mv.meta.inspect": ["Engine meta payload \u2014 click to inspect", "\u0628\u064A\u0627\u0646\u0627\u062A \u0648\u0635\u0641\u064A\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0631\u0643 \u2014 \u0627\u0646\u0642\u0631 \u0644\u0644\u0641\u062D\u0635"],
  "mv.unit.hits": ["hits", "\u0646\u062A\u0627\u0626\u062C"],
  "mv.unit.lines": ["lines", "\u0623\u0633\u0637\u0631"],
  "sa.retrying": ["Re-running\u2026", "\u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u2026"]
};
Object.assign(D, D_V1131_I18N_SWEEP);
var D_V1131_WAVE_COORD = {
  "hgs.git.local": ["LOCAL", "\u0645\u062D\u0644\u064A"],
  "hgs.git.upstream": ["UPSTREAM", "\u0645\u0646\u0628\u0639"],
  "hgs.git.unknown": ["upstream distance unavailable in this build", "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0645\u0646 \u0627\u0644\u0645\u0646\u0628\u0639 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631"],
  "mcp.activity.clearFailed": ["Could not clear the call log.", "\u062A\u0639\u0630\u0651\u0631 \u062A\u0641\u0631\u064A\u063A \u0633\u062C\u0644 \u0627\u0644\u0627\u0633\u062A\u062F\u0639\u0627\u0621\u0627\u062A."],
  "mcp.healthCheckUnavailable": ["Health check is unavailable in this build.", "\u0641\u062D\u0635 \u0627\u0644\u0635\u062D\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631."],
  "mcp.toolToggleFailed": ["Could not change this tool \u2014 the change was reverted.", "\u062A\u0639\u0630\u0651\u0631 \u062A\u063A\u064A\u064A\u0631 \u0647\u0630\u0647 \u0627\u0644\u0623\u062F\u0627\u0629 \u2014 \u0623\u064F\u0644\u063A\u064A \u0627\u0644\u062A\u063A\u064A\u064A\u0631."],
  "mcp.releaseFailed": ["Could not release this server from quarantine.", "\u062A\u0639\u0630\u0651\u0631 \u0625\u062E\u0631\u0627\u062C \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645 \u0645\u0646 \u0627\u0644\u062D\u062C\u0631."],
  "mcp.released": ["Released from quarantine.", "\u0623\u064F\u062E\u0631\u062C \u0645\u0646 \u0627\u0644\u062D\u062C\u0631."],
  "mcp.copyFailed": ["Clipboard unavailable \u2014 copy the text manually.", "\u0627\u0644\u062D\u0627\u0641\u0638\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D\u0629 \u2014 \u0627\u0646\u0633\u062E \u0627\u0644\u0646\u0635 \u064A\u062F\u0648\u064A\u0627\u064B."],
  "mcp.autoQuarantineFailed": ["Could not save the auto-quarantine setting.", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0625\u0639\u062F\u0627\u062F \u0627\u0644\u062D\u062C\u0631 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A."],
  "mcp.approvalResetFailed": ["Could not reset the remembered approval.", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629."],
  "mcp.registry.addFailed": ["Could not add this server.", "\u062A\u0639\u0630\u0651\u0631\u062A \u0625\u0636\u0627\u0641\u0629 \u0647\u0630\u0627 \u0627\u0644\u062E\u0627\u062F\u0645."],
  "mcp.registry.noConfig": ["The registry returned no server configuration.", "\u0644\u0645 \u064A\u064F\u0631\u062C\u0639 \u0627\u0644\u0633\u062C\u0644 \u0623\u064A \u0625\u0639\u062F\u0627\u062F \u0644\u0644\u062E\u0627\u062F\u0645."],
  "mcp.registry.added": ['Added "{name}" from the registry.', '\u0623\u064F\u0636\u064A\u0641 "{name}" \u0645\u0646 \u0627\u0644\u0633\u062C\u0644.'],
  "mcp.deleteFailed": ["Could not delete the server on disk \u2014 removed from the list only.", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0627\u0644\u062E\u0627\u062F\u0645 \u0645\u0646 \u0627\u0644\u0642\u0631\u0635 \u2014 \u0623\u064F\u0632\u064A\u0644 \u0645\u0646 \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0641\u0642\u0637."],
  "tl.restoreFailed": ["Restore failed \u2014 files were not changed", "\u062A\u0639\u0630\u0651\u0631\u062A \u0627\u0644\u0627\u0633\u062A\u0639\u0627\u062F\u0629 \u2014 \u0644\u0645 \u062A\u062A\u063A\u064A\u0631 \u0627\u0644\u0645\u0644\u0641\u0627\u062A"],
  "tl.rel.now": ["now", "\u0627\u0644\u0622\u0646"],
  "tl.rel.m": ["m", "\u062F"],
  "tl.rel.h": ["h", "\u0633"],
  "tl.rel.d": ["d", "\u064A"],
  "sch.createFailed": ["Could not create the job \u2014 nothing was saved", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0647\u0645\u0629 \u2014 \u0644\u0645 \u064A\u064F\u062D\u0641\u0638 \u0634\u064A\u0621"],
  "sch.refresh": ["Refresh jobs", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0647\u0627\u0645"],
  "sb.led.state": ["agent running", "\u0627\u0644\u0648\u0643\u064A\u0644 \u064A\u0639\u0645\u0644"],
  "usage.refresh": ["Refresh live stats", "\u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0625\u062D\u0635\u0627\u0621\u0627\u062A \u0627\u0644\u062D\u064A\u0629"],
  "usage.rowsDiffer": ["{n} billing rows \xB7 \u03A3 {a} tok vs session {b} tok", "{n} \u0635\u0641 \u0645\u062D\u0627\u0633\u0628\u0629 \xB7 \u03A3 {a} \u0631\u0645\u0632 \u0645\u0642\u0627\u0628\u0644 {b} \u0631\u0645\u0632 \u0644\u0644\u062C\u0644\u0633\u0629"],
  "onboard.caps": ["145 real tools \xB7 tool profiles \xB7 Living Playbook \xB7 MCP & subagents \xB7 bring your own key \u2014 no subscription.", "145 \u0623\u062F\u0627\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \xB7 \u0645\u0644\u0641\u0627\u062A \u0623\u062F\u0648\u0627\u062A \xB7 \u062F\u0644\u064A\u0644 \u062D\u064A\u0651 \xB7 \u0648\u0643\u0644\u0627\u0621 \u062E\u0627\u0631\u062C\u064A\u0648\u0646 \u0648\u0641\u0631\u0648\u0639 \xB7 \u0628\u0645\u0641\u062A\u0627\u062D\u0643 \u0627\u0644\u062E\u0627\u0635 \u0628\u0644\u0627 \u0627\u0634\u062A\u0631\u0627\u0643."],
  "pal.openPreviewUrl.hint": ["Preview opened \u2014 run this again to launch the URL", "\u0627\u0628\u062F\u0623 \u0627\u0644\u0645\u0639\u0627\u064A\u0646\u0629 \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0623\u0645\u0631 \u0644\u0641\u062A\u062D \u0627\u0644\u0631\u0627\u0628\u0637"],
  "palette.closeTab.none": ["No tab is open", "\u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u0644\u0627\u0645\u0629 \u062A\u0628\u0648\u064A\u0628 \u0645\u0641\u062A\u0648\u062D\u0629"],
  "sc.quickOpen": ["Quick open", "\u0641\u062A\u062D \u0633\u0631\u064A\u0639"],
  "skills.forkFailed": ["Could not copy this built-in skill.", "\u062A\u0639\u0630\u0651\u0631 \u0646\u0633\u062E \u0647\u0630\u0647 \u0627\u0644\u0645\u0647\u0627\u0631\u0629 \u0627\u0644\u0645\u062F\u0645\u062C\u0629."],
  "skills.market.loadFailed": ["Could not load the marketplace.", "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0633\u0648\u0642."],
  "git.nothingToCommit": ["Nothing to commit \u2014 stage your changes first", "\u0644\u0627 \u0634\u064A\u0621 \u0644\u0644\u0625\u064A\u062F\u0627\u0639 \u2014 \u062C\u0647\u0651\u0632 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0623\u0648\u0644\u0627\u064B"],
  "np.createFailed": ["Could not create the folder", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u062C\u0644\u062F"],
  "skills.trust.unavailable": ["Trust is unavailable in this build \u2014 workspace skills stay untrusted.", "\u0645\u0646\u062D \u0627\u0644\u062B\u0642\u0629 \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u2014 \u062A\u0628\u0642\u0649 \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642\u0629."],
  "artifacts.exportFailed": ["Could not export the proof page", "\u062A\u0639\u0630\u0651\u0631 \u062A\u0635\u062F\u064A\u0631 \u0635\u0641\u062D\u0629 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "artifacts.copied": ["Proof page copied to clipboard", "\u0646\u064F\u0633\u062E\u062A \u0635\u0641\u062D\u0629 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "artifacts.copyFailed": ["Clipboard is unavailable on this device", "\u0627\u0644\u0646\u0633\u062E \u063A\u064A\u0631 \u0645\u062A\u0627\u062D \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "artifacts.copy": ["Copy proof HTML", "\u0646\u0633\u062E \u0635\u0641\u062D\u0629 \u0627\u0644\u0625\u062B\u0628\u0627\u062A"],
  "artifacts.copyShort": ["Copy", "\u0646\u0633\u062E"],
  "lib.openFailed": ["Could not open the item", "\u062A\u0639\u0630\u0651\u0631 \u0641\u062A\u062D \u0627\u0644\u0639\u0646\u0635\u0631"],
  "lib.forget.confirm": ["Remove this entry from the library? The file itself stays on disk.", "\u0625\u0632\u0627\u0644\u0629 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0635\u0631 \u0645\u0646 \u0627\u0644\u0645\u0643\u062A\u0628\u0629\u061F \u0627\u0644\u0645\u0644\u0641 \u0646\u0641\u0633\u0647 \u064A\u0628\u0642\u0649 \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635."],
  "lib.forget.done": ["Removed from the library \u2014 the file stays on disk", "\u0623\u064F\u0632\u064A\u0644 \u0645\u0646 \u0627\u0644\u0645\u0643\u062A\u0628\u0629 \u2014 \u0627\u0644\u0645\u0644\u0641 \u0628\u0627\u0642\u064D \u0639\u0644\u0649 \u0627\u0644\u0642\u0631\u0635"],
  "prompts.storageFailed": ["Could not save on this device", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062D\u0641\u0638 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "prompts.saveFailed": ["Could not save the prompt", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0641\u0638 \u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "prompts.renameCleanupFailed": ["New name saved, but the old row could not be removed", "\u062D\u064F\u0641\u0638 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u062C\u062F\u064A\u062F \u0644\u0643\u0646 \u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0627\u0644\u0642\u062F\u064A\u0645"],
  "prompts.deleteFailed": ["Could not delete the prompt", "\u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "prompts.deleted": ["Prompt deleted", "\u062D\u064F\u0630\u0641 \u0627\u0644\u062A\u0648\u062C\u064A\u0647"],
  "sa.plate.countTip": ["first five shown of all matching subagents", "\u0623\u0648\u0644 \u062E\u0645\u0633\u0629 \u0648\u0643\u0644\u0627\u0621 \u0645\u0646 \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0645\u0637\u0627\u0628\u0642\u064A\u0646"],
  "sa.cleared": ["Subagent history cleared", "\u062A\u0645 \u0645\u0633\u062D \u0633\u062C\u0644 \u0627\u0644\u0648\u0643\u0644\u0627\u0621 \u0627\u0644\u0641\u0631\u0639\u064A\u064A\u0646"],
  "sa.failedTip": ["Errors + aborted subagents", "\u0623\u062E\u0637\u0627\u0621 + \u0648\u0643\u0644\u0627\u0621 \u0623\u064F\u0644\u063A\u0648\u0627"],
  "wiki.generated": ["Wiki generated \u2014 ", "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0648\u064A\u0643\u064A \u2014 "],
  "wiki.genFailed": ["Generation failed.", "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0648\u0644\u064A\u062F"],
  "wiki.loadFailed": ["Could not read the wiki for this workspace.", "\u062A\u0639\u0630\u0651\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0648\u064A\u0643\u064A \u0644\u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0627\u062D\u0629"],
  "settings.billing.endpointPh.v1131": ["https://licenses.example.com/verify", "https://licenses.example.com/verify"],
  "set.updates.feed.hint.v1131": ["HTTPS only \u2014 or leave empty for the official feed", "HTTPS \u0641\u0642\u0637 \u2014 \u0623\u0648 \u0627\u062A\u0631\u0643\u0647 \u0641\u0627\u0631\u063A\u0627\u064B \u0644\u0644\u062E\u0644\u0627\u0635\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629"],
  "set.appear.specularHint.v1131": ["Subtle light-catching highlights on window and panel edges.", "\u0628\u0631\u064A\u0642 \u0636\u0648\u0626\u064A \u062E\u0641\u064A\u0641 \u0639\u0644\u0649 \u062D\u0648\u0627\u0641 \u0627\u0644\u0646\u0648\u0627\u0641\u0630 \u0648\u0627\u0644\u0644\u0648\u062D\u0627\u062A."],
  "settings.agent.failover.honest.v1131": ["Automatic provider failover is OFF by default \u2014 SADEEM never silently switches your run to another provider or model.", "\u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A \u0628\u064A\u0646 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u064A\u0646 \u0645\u064F\u0639\u0637\u064E\u0651\u0644 \u0627\u0641\u062A\u0631\u0627\u0636\u064A\u0627\u064B \u2014 \u0644\u0627 \u064A\u062D\u0648\u0651\u0644 \u0633\u062F\u064A\u0645 \u062A\u0634\u063A\u064A\u0644\u0643 \u0625\u0644\u0649 \u0645\u0632\u0648\u0651\u062F \u0622\u062E\u0631 \u062F\u0648\u0646 \u0637\u0644\u0628 \u0635\u0631\u064A\u062D \u0645\u0646\u0643."],
  "settings.agent.router.title.v1131": ["Model router", "\u0645\u0648\u062C\u0651\u0647 \u0627\u0644\u0646\u0645\u0627\u0630\u062C"],
  "set.ctl.decrease.v1131": ["Decrease", "\u0625\u0646\u0642\u0627\u0635"],
  "settings.appearance.reset.hint.v1131": ["Restores glass, glow, type, layout and motion (the accent is fixed, not a setting).", "\u062A\u0633\u062A\u0639\u064A\u062F \u0627\u0644\u0632\u062C\u0627\u062C \u0648\u0627\u0644\u062A\u0648\u0647\u062C \u0648\u0627\u0644\u062E\u0637\u0648\u0637 \u0648\u0627\u0644\u062A\u062E\u0637\u064A\u0637 \u0648\u0627\u0644\u062D\u0631\u0643\u0629 (\u0644\u0627 \u064A\u0648\u062C\u062F \u0625\u0639\u062F\u0627\u062F \u0644\u0648\u0646 \u0645\u0645\u064A\u0651\u0632)."],
  "set.ctl.increase.v1131": ["Increase", "\u0632\u064A\u0627\u062F\u0629"],
  "set.ctl.value.v1131": ["Value", "\u0642\u064A\u0645\u0629"]
};
Object.assign(D, D_V1131_WAVE_COORD);
var D_V1133_MONETIZATION = {
  "auth.licenseKey": ["License key", "\u0645\u0641\u062A\u0627\u062D \u0627\u0644\u062A\u0631\u062E\u064A\u0635"],
  "auth.licenseOffline": ["Use a license key offline", "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u0641\u062A\u0627\u062D \u062A\u0631\u062E\u064A\u0635 \u062F\u0648\u0646 \u0627\u062A\u0635\u0627\u0644"],
  "auth.or.local": ["or on this device", "\u0623\u0648 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632"],
  "auth.signedInAs": ["Signed in as", "\u062A\u0645 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0628\u0627\u0633\u0645"],
  "auth.web.eyebrow": ["ACCOUNT", "\u0627\u0644\u062D\u0633\u0627\u0628"],
  "auth.web.note": ["Sign in on the website to sync your account and license.", "\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639 \u0644\u0645\u0632\u0627\u0645\u0646\u0629 \u062D\u0633\u0627\u0628\u0643 \u0648\u062A\u0631\u062E\u064A\u0635\u0643."],
  "auth.web.opened": ["Opened the website to sign in", "\u062A\u0645 \u0641\u062A\u062D \u0627\u0644\u0645\u0648\u0642\u0639 \u0644\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644"],
  "auth.web.signin": ["Sign in on the website", "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639"],
  "auth.web.signup": ["Create an account", "\u0625\u0646\u0634\u0627\u0621 \u062D\u0633\u0627\u0628"],
  "billing.owner.badge": ["OWNER LICENSE", "\u062A\u0631\u062E\u064A\u0635 \u0627\u0644\u0645\u0627\u0644\u0643"],
  "billing.owner.byok": ["Bring your own keys \u2014 free forever", "\u0623\u062D\u0636\u0631 \u0645\u0641\u0627\u062A\u064A\u062D\u0643 \u2014 \u0645\u062C\u0627\u0646\u0627\u064B \u0625\u0644\u0649 \u0627\u0644\u0623\u0628\u062F"],
  "billing.owner.entitlement": ["Your entitlement", "\u0635\u0644\u0627\u062D\u064A\u062A\u0643"],
  "billing.owner.eyebrow": ["OWNERSHIP", "\u0627\u0644\u0645\u0644\u0643\u064A\u0629"],
  "billing.owner.freeForever": ["BYOK stays free forever", "\u0627\u0644\u0645\u0641\u0627\u062A\u064A\u062D \u0627\u0644\u062E\u0627\u0635\u0629 \u062A\u0628\u0642\u0649 \u0645\u062C\u0627\u0646\u064A\u0629 \u0644\u0644\u0623\u0628\u062F"],
  "billing.owner.half": ["50% off the next major version", "\u062E\u0635\u0645 \u0665\u0660\u066A \u0639\u0644\u0649 \u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0631\u0626\u064A\u0633\u064A \u0627\u0644\u0642\u0627\u062F\u0645"],
  "billing.owner.label": ["Owner License (v11 series)", "\u062A\u0631\u062E\u064A\u0635 \u0627\u0644\u0645\u0627\u0644\u0643 (\u0633\u0644\u0633\u0644\u0629 \u0661\u0661)"],
  "billing.owner.nextMajor": ["Next major version", "\u0627\u0644\u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0631\u0626\u064A\u0633\u064A \u0627\u0644\u0642\u0627\u062F\u0645"],
  "billing.owner.scope": ["Perpetual for the v11 series and all v11.x updates", "\u062F\u0627\u0626\u0645 \u0644\u0633\u0644\u0633\u0644\u0629 \u0661\u0661 \u0648\u062C\u0645\u064A\u0639 \u062A\u062D\u062F\u064A\u062B\u0627\u062A \u0661\u0661.x"],
  "billing.owner.statement": ["One-time payment. No subscription, no credits, no resold inference.", "\u062F\u0641\u0639 \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629. \u0628\u0644\u0627 \u0627\u0634\u062A\u0631\u0627\u0643 \u0623\u0648 \u0631\u0635\u064A\u062F \u0623\u0648 \u0625\u0639\u0627\u062F\u0629 \u0628\u064A\u0639 \u0644\u0644\u0627\u0633\u062A\u062F\u0644\u0627\u0644."],
  "mv.img.open": ["Open full size", "\u0641\u062A\u062D \u0628\u0627\u0644\u062D\u062C\u0645 \u0627\u0644\u0643\u0627\u0645\u0644"],
  // v11.35 — calm app-error display (provider / rate limit / network).
  "err.display.eyebrow": ["APP ERROR", "\u062E\u0637\u0623 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"],
  "err.display.retry": ["Retry", "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629"],
  "err.display.details": ["Details", "\u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644"],
  "err.display.detailsHide": ["Hide details", "\u0625\u062E\u0641\u0627\u0621 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644"],
  "err.display.title.rateLimit": ["Rate limit reached", "\u062A\u0645 \u0628\u0644\u0648\u063A \u062D\u062F \u0627\u0644\u0637\u0644\u0628\u0627\u062A"],
  "err.display.reason.rateLimit": ["The provider is limiting requests right now.", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u064A\u062D\u062F\u0651\u062F \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u062D\u0627\u0644\u064A\u0627\u064B."],
  "err.display.next.rateLimit": ["Wait a moment, then retry \u2014 or switch models.", "\u0627\u0646\u062A\u0638\u0631 \u0642\u0644\u064A\u0644\u0627\u064B \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u2014 \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0646\u0645\u0648\u0630\u062C."],
  "err.display.title.quota": ["Credits exhausted", "\u0627\u0644\u0631\u0635\u064A\u062F \u0645\u0633\u062A\u0646\u0641\u062F"],
  "err.display.reason.quota": ["The provider account has no credits left.", "\u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0644\u064A\u0633 \u0644\u062F\u064A\u0647 \u0631\u0635\u064A\u062F \u0645\u062A\u0628\u0642\u064D."],
  "err.display.next.quota": ["Add credits or switch provider/key in Settings \u2192 AI providers.", "\u0623\u0636\u0641 \u0631\u0635\u064A\u062F\u0627\u064B \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F/\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A."],
  "err.display.title.provider": ["Provider unavailable", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u063A\u064A\u0631 \u0645\u062A\u0627\u062D"],
  "err.display.reason.provider": ["The provider did not answer this request.", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0644\u0645 \u064A\u062C\u0628 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628."],
  "err.display.next.provider": ["Check the connection, then retry or switch provider.", "\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0627\u062A\u0635\u0627\u0644\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F."],
  "err.display.title.network": ["Connection lost", "\u0627\u0646\u0642\u0637\u0639 \u0627\u0644\u0627\u062A\u0635\u0627\u0644"],
  "err.display.reason.network": ["The request never reached the provider.", "\u0644\u0645 \u064A\u0635\u0644 \u0627\u0644\u0637\u0644\u0628 \u0625\u0644\u0649 \u0627\u0644\u0645\u0632\u0648\u0651\u062F."],
  "err.display.next.network": ["Check your connection, then retry.", "\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u062A\u0635\u0627\u0644\u0643\u060C \u062B\u0645 \u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629."],
  "err.display.title.auth": ["API key needs attention", "\u0645\u0641\u062A\u0627\u062D API \u064A\u062D\u062A\u0627\u062C \u062A\u062D\u0642\u0642\u0627\u064B"],
  "err.display.reason.auth": ["The provider rejected the credentials.", "\u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0631\u0641\u0636 \u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F."],
  "err.display.next.auth": ["Check your API key in Settings \u2192 AI providers.", "\u062A\u062D\u0642\u0642 \u0645\u0646 \u0645\u0641\u062A\u0627\u062D API \u0641\u064A \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0645\u0632\u0648\u062F\u0648 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A."],
  "err.display.title.generic": ["Couldn't complete the request", "\u062A\u0639\u0630\u0651\u0631 \u0625\u0643\u0645\u0627\u0644 \u0627\u0644\u0637\u0644\u0628"],
  "err.display.reason.generic": ["The request stopped before an answer arrived.", "\u062A\u0648\u0642\u0651\u0641 \u0627\u0644\u0637\u0644\u0628 \u0642\u0628\u0644 \u0648\u0635\u0648\u0644 \u0627\u0644\u0625\u062C\u0627\u0628\u0629."],
  "err.display.next.generic": ["Retry, or check the provider settings.", "\u0623\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629\u060C \u0623\u0648 \u062A\u062D\u0642\u0642 \u0645\u0646 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0632\u0648\u0651\u062F."]
};
Object.assign(D, D_V1133_MONETIZATION);

// src/components/Toasts.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_lucide_react = require("lucide-react");
var import_jsx_runtime = require("react/jsx-runtime");
var MAX_TOASTS = 4;
var nextId = 1;
var toasts = [];
var listeners = /* @__PURE__ */ new Set();
var emit = () => {
  for (const l of listeners) l(toasts);
};
function pushToast(input) {
  const severity = input.severity ?? "info";
  const duration = input.duration ?? (severity === "error" ? 7e3 : 4e3);
  toasts = [...toasts, { id: nextId++, severity, title: input.title, actionLabel: input.actionLabel, onAction: input.onAction, duration }].slice(
    -MAX_TOASTS
  );
  emit();
}

// src/store.ts
function mergeSubagentToolCalls(prev, incoming) {
  const next = Array.isArray(prev) ? [...prev] : [];
  for (const c of incoming) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    const key = c.toolCallId ? `id:${c.toolCallId}` : `${c.name}:${c.at}`;
    const idx = next.findIndex((x) => (x.toolCallId ? `id:${x.toolCallId}` : `${x.name}:${x.at}`) === key);
    if (idx >= 0) next[idx] = { ...next[idx], ...c };
    else next.push(c);
  }
  return next.slice(-120);
}
var SLASH_PROMPT_TEMPLATES = {
  pr: () => "Draft a pull-request title + description from my current uncommitted changes (git diff). Format: Title, Summary, Changes bulleted, Screenshots/Testing notes sections.",
  changelog: () => "Generate release notes from the last 20 git commits: group by Added/Changed/Fixed, concise bullets, semantic-tone headings, bilingual not needed \u2014 match the repo language.",
  tests: (arg) => `Write focused unit tests for ${arg || "the most test-worthy file changed recently"} using the project's existing test framework and style. Create/update the test file and run the tests.`,
  // v6 — session handoff (original): solves "the session died / I'm leaving mid-task".
  // The agent writes a self-contained HANDOFF.md the next session (or a teammate)
  // can resume from — then keeps working if there is still work left.
  handoff: () => "Write a session HANDOFF note for whoever continues this work (a future me, or the user).\nRead the workspace state (git status/diff, MEMORY.md if present) and cover EXACTLY these sections:\n1) Task in one line \u2014 what was being built/fixed and why.\n2) DONE \u2014 changes already made, with file paths (and which of them are verified: build/tests run and passing).\n3) NOT DONE / NEXT \u2014 the precise remaining steps, ordered, each with the file to touch and how to verify it.\n4) HOW TO RUN \u2014 the exact commands to install, run and verify this project.\n5) WATCH OUT \u2014 gotchas discovered this session (failing tests, missing env vars, flaky steps).\nSave it as HANDOFF.md in the workspace root, then summarize it in 3 bullets in chat.",
  // v6 — grill-first planning (Antigravity /grill-me): interview BEFORE coding.
  grill: (arg) => `We are about to work on: ${arg || "the task I am about to describe"}. Before writing ANY code, interview me ONE question at a time using the ask_user tool \u2014 each question offers 2-4 concrete options, your recommended option FIRST and marked (Recommended), plus a free-text alternative. Ask ONLY questions the codebase cannot answer: first inspect the workspace (workspace_map / read_file), never ask what you can read. Each answer shapes the next question. After at most 5 questions, restate the final spec in 5 bullets and start implementing.`
};
function slashT(ar) {
  return makeT(ar ? "ar" : "en");
}
function appendAssistantRow(get, content, model) {
  const cur = get().session;
  if (!cur) return;
  const msg = {
    id: uid(),
    role: "assistant",
    // kind stays unset (plain text) — MessageView renders it as an answer row
    content,
    ...model ? { model } : {},
    timestamp: Date.now()
  };
  useStore.setState({ session: { ...cur, messages: [...cur.messages, msg] } });
  void get().persistSession();
}
function wsJoin(ws, ...parts) {
  return [ws.replace(/[\\/]+$/, ""), ...parts].join("/");
}
function clearedRunActivity() {
  return { runStartedAt: null, runActivity: null, runPhase: null };
}
function noCreditsToast(raw, ar) {
  if (!/Insufficient credits|no_credits|\b402\b/i.test(raw)) return null;
  return makeT(ar ? "ar" : "en")(
    "err.setup.noCredits",
    ar ? "\u0631\u0635\u064A\u062F \u063A\u064A\u0631 \u0643\u0627\u0641\u064D: \u062D\u0633\u0627\u0628 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0644\u064A\u0633 \u0644\u062F\u064A\u0647 \u0631\u0635\u064A\u062F. \u0623\u0636\u0641 \u0631\u0635\u064A\u062F\u0627\u064B \u0623\u0648 \u0628\u062F\u0651\u0644 \u0627\u0644\u0645\u0632\u0648\u0651\u062F/\u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0645\u0646 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A \u2190 \u0627\u0644\u0645\u0632\u0648\u0651\u062F\u0648\u0646." : "Insufficient credits: add balance to the provider account or switch the provider/key in Settings \u2192 Providers."
  );
}
function runErrorKey(raw, code) {
  if (code && code.startsWith("err.")) return code;
  if (code === "NO_PARAMS" || code === "BAD_SHAPE") return "err.run.badParams";
  if (code === "NO_MODEL") return "err.setup.noModel";
  if (code === "NO_USER_MESSAGE") return "err.run.noUserMessage";
  if (/invalid run parameters|missing messages/i.test(raw)) return "err.run.badParams";
  if (/Insufficient credits|no_credits|\b402\b|credit balance|out of credits/i.test(raw)) return "err.setup.noCredits";
  if (/rate.?limit|\b429\b|too many requests/i.test(raw)) return "err.run.rateLimited";
  if (/no api key|missing api key|invalid api key|no key configured|unauthorized|\b401\b|\b403\b/i.test(raw)) return "err.setup.noApiKey";
  if (/no model|model.*(?:missing|not selected|not configured)/i.test(raw)) return "err.setup.noModel";
  if (/no workspace|workspace.*(?:not open|missing)/i.test(raw)) return "err.setup.noWorkspace";
  if (/offline|unavailable|unreachable|econn|enotfound|network|fetch failed|timed? ?out|\b5\d\d\b/i.test(raw)) return "err.run.providerUnavailable";
  return null;
}
var ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
var LATIN_WORD_RE = /^[A-Za-z][A-Za-z0-9_.\/-]*$/;
var ERROR_TECH_TOKENS = /* @__PURE__ */ new Set([
  "api",
  "url",
  "http",
  "https",
  "www",
  "json",
  "jsonl",
  "npm",
  "git",
  "ide",
  "ai",
  "mcp",
  "llm",
  "openrouter",
  "anthropic",
  "openai",
  "deepseek",
  "ollama",
  "gemini",
  "claude",
  "settings",
  "providers",
  "dna",
  "sadeem",
  "kdx",
  "gpt",
  "glm",
  "qwen",
  "moonshot",
  "mistral",
  "html",
  "css",
  "sql",
  "cli",
  "pdf",
  "provider",
  "error",
  "code",
  "key",
  "model",
  "credits",
  "balance",
  "run"
]);
function hasLatinProse(s) {
  const clean = s.replace(/https?:\/\/\S+/g, " ").replace(/[\w.+-]+@[\w.-]+/g, " ");
  let streak = 0;
  for (const w of clean.split(/[^\p{L}\p{N}]+/u)) {
    if (!w || !LATIN_WORD_RE.test(w) || ERROR_TECH_TOKENS.has(w.toLowerCase()) || /^[A-Z0-9_.\/-]+$/.test(w)) {
      streak = 0;
      continue;
    }
    if (++streak >= 3) return true;
  }
  return false;
}
function machineReason(raw) {
  const s = typeof raw === "string" ? raw : "";
  const status = s.match(/\b([45]\d{2})\b/);
  if (status) return status[1];
  const posix = s.match(/\b(E[A-Z0-9]{2,}|KDX_[A-Z0-9_]+|NO_[A-Z_]+|BAD_SHAPE)\b/);
  if (posix) return posix[1];
  const upper = s.match(/\b([A-Z][A-Z0-9_.-]{2,24})\b/);
  if (upper && !/^(JSON|JSONL|HTTP|HTTPS|URL|API|AI|OK|EN|AR|UTF|GET|POST|MCP|LSP|PDF|CLI|IDE)$/.test(upper[1])) return upper[1];
  const quoted = s.match(/["']([A-Za-z0-9_.:/-]{3,40})["']/);
  if (quoted) return quoted[1];
  const keyed = s.match(/(?:error|reason|code|failed)\s*[:#=]\s*([A-Za-z0-9_.:/-]{3,40})/i);
  if (keyed) return keyed[1];
  return "";
}
function errorText(raw) {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof raw.message === "string") {
    return raw.message;
  }
  return "";
}
function localizeRunError(raw, ar, code) {
  const text = errorText(raw);
  const key = runErrorKey(text, code);
  if (key) return makeT(ar ? "ar" : "en")(key);
  const arabic = ARABIC_SCRIPT_RE.test(text);
  const latin = hasLatinProse(text);
  const mixed = arabic && latin;
  const wrongLanguage = ar ? !arabic && latin : arabic;
  if (mixed || wrongLanguage) {
    const base2 = makeT(ar ? "ar" : "en")("err.run.providerUnavailable");
    const reason = machineReason(text);
    return reason ? `${base2} (${reason})` : base2;
  }
  return text;
}
function localizePreviewError(raw, ar) {
  const text = errorText(raw);
  const key = runErrorKey(text);
  const base2 = key ? makeT(ar ? "ar" : "en")(key) : makeT(ar ? "ar" : "en")("preview.err.startFailed");
  const reason = machineReason(text);
  if (reason) return `${base2} (${reason})`;
  return key ? base2 : "";
}
function sanitizeLogLine(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/^[{[]/.test(s) && /[}\]]$/.test(s)) return "";
  return s.slice(0, 200);
}
function asStringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function asCommandArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((c) => !!c && typeof c === "object").map((c) => ({ cmd: typeof c.cmd === "string" ? c.cmd : "", ok: c.ok === true }));
}
function asFiniteMs(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}
function safeDetail(v, fallback = "") {
  if (typeof v === "string") return v.slice(0, 800);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}
function detectTestCommand(packageJson) {
  if (!packageJson) return "";
  try {
    const parsed = JSON.parse(packageJson);
    const scripts = parsed?.scripts ?? {};
    for (const name of ["test", "test:unit", "test:ci"]) {
      const v = scripts[name];
      if (typeof v === "string" && v.trim()) return `npm run ${name}`;
    }
  } catch {
  }
  return "";
}
function hasPythonTests(tree) {
  if (!tree) return false;
  const node = tree;
  const name = String(node.name ?? (node.path ? node.path.split(/[\\/]/).pop() : "") ?? "");
  if (/^test_.*\.py$/.test(name) || /^.*_test\.py$/.test(name) || name === "pytest.ini") return true;
  if (node.type === "dir" && Array.isArray(node.children)) {
    for (const c of node.children) if (hasPythonTests(c)) return true;
  }
  return false;
}
function resolveExplainPath(ws, arg) {
  const a = String(arg ?? "").trim().replace(/^["']|["']$/g, "");
  if (!a) return "";
  const absolute = /^[A-Za-z]:[\\/]/.test(a) || a.startsWith("/") || a.startsWith("\\");
  if (!absolute) return wsJoin(ws, a);
  const norm = a.replace(/\\/g, "/").toLowerCase();
  const wsn = String(ws ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return wsn && norm.startsWith(`${wsn}/`) ? a : "";
}
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
var clipMd = (s, max) => s.length > max ? s.slice(0, max) + "\n\u2026[truncated]" : s;
function lastUserTask(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user" || m.id.startsWith("sys:")) continue;
    if (m.model === "steer" || m.model === "queued" || m.model === "compaction") continue;
    const content = String(m.content ?? "").trim();
    if (!content || content.startsWith("/") || content.startsWith("[Compacted")) continue;
    return content;
  }
  return "";
}
function buildSessionMarkdown(s) {
  const header = [
    `# ${s.title || "SADEEM session"}`,
    "",
    `- Session: \`${s.id}\``,
    `- Created: ${new Date(s.createdAt).toISOString()}`,
    `- Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`,
    s.workspace ? `- Workspace: \`${s.workspace}\`` : null,
    s.model ? `- Model: ${s.model}` : null,
    `- Messages: ${s.messages.length}`
  ].filter((l) => !!l).join("\n");
  const body = s.messages.map((m) => {
    const time = new Date(m.timestamp).toISOString();
    if (m.kind === "tool_call") {
      return `### tool call \u2014 ${m.toolName ?? "unknown"}

_${time}_

\`\`\`
${clipMd(m.content ?? "", 2e3)}
\`\`\``;
    }
    if (m.kind === "tool_result") {
      const status = m.resultOk === false ? "error" : "ok";
      return `### tool result${m.toolName ? ` \u2014 ${m.toolName}` : ""} (${status})

_${time}_

\`\`\`
${clipMd(m.content ?? "", 2e3)}
\`\`\``;
    }
    const role = m.role === "user" ? "user" : "assistant";
    const model = m.model ? ` _(model: ${m.model})_` : "";
    return `### ${role}${model}

_${time}_

${clipMd(m.content ?? "", 2e4)}`;
  }).join("\n\n---\n\n");
  return `${header}

---

${body || "_(empty transcript)_"}
`;
}
var escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
var PROOF_DOT = { ok: "#a9be56", warn: "#fbbf24", bad: "#e8e4d8" };
var PROOF_LABEL = {
  redGreen: "red/green",
  mutation: "mutation",
  fakes: "fake tests",
  critic: "critic",
  verify: "verify",
  receipt: "receipt"
};
function buildShareHtml(s, opts) {
  const { ar, proof, usage } = opts;
  const t = slashT(ar);
  const esc = escapeHtml;
  const time = (at) => new Date(at).toLocaleString(ar ? "ar" : "en");
  const stats = /* @__PURE__ */ new Map();
  for (const m of s.messages) {
    if (m.kind === "tool_call") {
      const name = m.toolName ?? "unknown";
      const row = stats.get(name) ?? { calls: 0, ok: 0, fail: 0 };
      row.calls++;
      stats.set(name, row);
    } else if (m.kind === "tool_result" && m.toolName) {
      const row = stats.get(m.toolName) ?? { calls: 0, ok: 0, fail: 0 };
      if (m.resultOk === false) row.fail++;
      else row.ok++;
      stats.set(m.toolName, row);
    }
  }
  const statChips = [...stats.entries()].sort((a, b) => b[1].calls - a[1].calls).map(
    ([name, r]) => `<span class="chip"><b>${esc(name)}</b> \xD7${r.calls}${r.ok + r.fail > 0 ? ` \xB7 <i class="ok">${r.ok} ok</i>${r.fail ? ` \xB7 <i class="bad">${r.fail} err</i>` : ""}` : ""}</span>`
  ).join(" ");
  const gateRows = proof.gates.length ? proof.gates.map(
    (g) => `<li class="gate"><span class="dot" style="background:${PROOF_DOT[g.tone]}"></span><b>${esc(PROOF_LABEL[g.id] ?? g.id)}</b> \u2014 <span>${esc(g.detail)}</span><time>${esc(time(g.at))}</time></li>`
  ).join("") : `<li class="gate none">${esc(t("slash.share.noProof", "No gates ran in this session yet."))}</li>`;
  const msgRows = s.messages.map((m) => {
    const head = m.kind === "tool_call" ? `<span class="tag tool">${esc(t("slash.share.tool", "tool"))} \xB7 ${esc(m.toolName ?? "unknown")}</span>` : m.kind === "tool_result" ? `<span class="tag ${m.resultOk === false ? "err" : "okk"}">${m.resultOk === false ? "error" : "ok"}${m.toolName ? " \xB7 " + esc(m.toolName) : ""}</span>` : `<span class="tag ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? ar ? "\u0623\u0646\u062A" : "You" : "SADEEM"}</span>${m.model && m.model !== "error" ? `<span class="model">${esc(m.model)}</span>` : ""}`;
    const isCode = m.kind === "tool_call" || m.kind === "tool_result";
    const bodyHtml = isCode ? `<pre dir="ltr">${esc(clipMd(m.content ?? "", 4e3))}</pre>` : `<div class="content" dir="auto">${esc(clipMd(m.content ?? "", 2e4))}</div>`;
    return `<article class="msg ${m.role === "user" ? "user" : "ai"}"><header>${head}<time>${esc(
      time(m.timestamp)
    )}</time></header>${bodyHtml}</article>`;
  }).join("\n");
  const title = esc(s.title || (ar ? "\u062C\u0644\u0633\u0629 \u0633\u062F\u064A\u0645" : "SADEEM session"));
  return `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} \u2014 SADEEM</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0f14; color: #d8d4cb; font: 14px/1.6 'Inter', 'Cairo', system-ui, sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 6px; color: #f2f7fc; }
  .meta { color: #898986; font-size: 12px; margin: 0 0 18px; word-break: break-all; }
  .meta code { color: #aeaeab; font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
  .chip { background: #1b1b18; border: 1px solid #2e2e2b; border-radius: 999px; padding: 3px 10px; font-size: 11.5px; color: #babab7; }
  .chip i { font-style: normal; }
  .chip .ok { color: #a9be56; } .chip .bad { color: #e8e4d8; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #9f9f9c; margin: 22px 0 8px; }
  ul.gates { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .gate { background: #121922; border: 1px solid #2e2e2b; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .gate time { margin-inline-start: auto; color: #6f6f6c; font-size: 11px; }
  .gate.none { color: #6f6f6c; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  .msg { background: #121922; border: 1px solid #2e2e2b; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .msg.user { border-inline-start: 3px solid #c9a488; }
  .msg.ai { border-inline-start: 3px solid #a9be56; }
  .msg header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .tag { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 7px; border-radius: 4px; }
  .tag.user { background: rgba(217,119,6,.15); color: #f0a949; }
  .tag.ai { background: rgba(52,211,153,.14); color: #b7cf45; }
  .tag.tool { background: rgba(161,161,156,.14); color: #b5b5b2; text-transform: none; }
  .tag.okk { background: rgba(52,211,153,.14); color: #b7cf45; text-transform: none; }
  .tag.err { background: rgba(232,228,216,.14); color: #e8e4d8; text-transform: none; }
  .model { color: #6f6f6c; font-size: 10.5px; font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; }
  .msg time { margin-inline-start: auto; color: #6f6f6c; font-size: 11px; }
  .content { white-space: pre-wrap; overflow-wrap: anywhere; }
  pre { margin: 0; background: #0b0f14; border: 1px solid #262623; border-radius: 6px; padding: 8px 10px; overflow-x: auto; font: 12px/1.5 'IBM Plex Mono', Menlo, Consolas, monospace; color: #c2c2bf; white-space: pre-wrap; overflow-wrap: anywhere; }
  footer { margin-top: 28px; color: #6f6f6c; font-size: 11.5px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${title}</h1>
  <p class="meta">
    <code>${esc(s.id)}</code> \xB7 ${esc(new Date(s.createdAt).toISOString())} \xB7
    ${esc((/* @__PURE__ */ new Date()).toISOString())}${s.workspace ? ` \xB7 <code>${esc(s.workspace)}</code>` : ""}${s.model ? ` \xB7 ${esc(s.model)}` : ""} \xB7 ${s.messages.length} ${esc(t("slash.share.messages", "Messages"))} \xB7
    ${usage.inputTokens + usage.outputTokens} tok \xB7 $${usage.costUsd.toFixed(4)}
  </p>
  ${statChips ? `<h2>${esc(t("slash.share.toolCalls", "Tool calls"))}</h2><div class="stats">${statChips}</div>` : ""}
  <h2>${esc(t("slash.share.proof", "Proof & gates"))}</h2>
  <ul class="gates">${gateRows}</ul>
  ${msgRows}
  <footer>${ar ? "\u0623\u064F\u0646\u0634\u0626\u062A \u0628\u0648\u0627\u0633\u0637\u0629 \u0633\u062F\u064A\u0645 \u2014 \u0645\u062D\u0637\u0629 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0628\u0631\u0645\u062C\u064A\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A" : "Generated by SADEEM \u2014 the AI coding workstation"}</footer>
</div>
</body>
</html>
`;
}
function mapDevStartError(err) {
  const s = String(err ?? "");
  if (/no package\.json/i.test(s)) return "noPackage";
  if (/no dev\/start\/serve script/i.test(s)) return "noDevScript";
  if (/no python entry/i.test(s)) return "noPython";
  if (/no custom preview command/i.test(s)) return "noCustom";
  return "startFailed";
}
var EMPTY_PROOF = { status: "unproven", gates: [], updatedAt: 0, mutation: null };
var FOCUS_KEY = "surnia.focusMode";
function readFocusMode() {
  try {
    return localStorage.getItem(FOCUS_KEY) === "1";
  } catch {
    return false;
  }
}
var uid = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
var DEFAULT_SETTINGS = {
  language: "en",
  // v11.3 — the DEVICE decides: 'follow' mirrors the OS light/dark nature.
  // Light is the primary SADEEM design; dark themes stay secondary.
  theme: "follow",
  permissionMode: "default",
  model: { provider: "anthropic", model: "claude-sonnet-5.5" },
  providers: {},
  fontSize: 13,
  terminalFontSize: 12,
  autoApproveEdits: false,
  checkpointsEnabled: true,
  onboardingDone: false,
  localOnly: false,
  recentPaths: [],
  mcpServers: [],
  billing: {},
  usageLog: [],
  // v11.4 — additive settings defaults only (editor / terminal / logs /
  // voice / shortcuts groups; main-process storeService mirrors these).
  editor: { wordWrap: "off", tabSize: 2, minimap: false, fontSize: 13, indentGuides: true },
  terminal: { shell: "default", scrollback: 1e3 },
  logs: { level: "info" },
  voice: { asrProvider: "auto", language: "en-US", autoSend: false, deviceId: "" },
  shortcuts: {}
};
var PROVIDER_PRESETS = {
  anthropic: {
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
    models: [
      "claude-opus-5.5",
      "claude-sonnet-5.5",
      "claude-haiku-5.5",
      "claude-fable-5.1",
      "claude-opus-5",
      "claude-sonnet-5"
    ]
  },
  openai: {
    label: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    models: [
      "gpt-6.1-terra",
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-5.3-codex",
      "gpt-5.5",
      "gpt-5.5-mini"
    ]
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai",
    models: [
      "anthropic/claude-opus-5.5",
      "openai/gpt-6-astra",
      "openai/gpt-6.1-sol",
      "anthropic/claude-sonnet-5.5",
      "google/gemini-4-argon",
      "qwen/qwen3.8-max",
      "moonshotai/kimi-k3.1-pro",
      "openai/gpt-5.3-codex",
      "z-ai/glm-5.3",
      "minimax/minimax-m3.1-flash",
      "deepseek/deepseek-chat",
      "x-ai/grok-4.7"
    ]
  },
  ollama: {
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    protocol: "openai",
    keyless: true,
    models: ["qwen3-coder", "deepseek-v4-pro", "glm-5.2", "kimi-k3", "devstral-small-2", "gpt-oss:20b"]
  },
  gemini: {
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "openai",
    models: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]
  },
  zai: {
    label: "Z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    protocol: "openai",
    models: ["glm-5.3", "glm-5.3-prime", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2"]
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openai",
    models: ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]
  },
  xai: {
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    protocol: "openai",
    models: ["grok-4.7", "grok-4.6", "grok-build-0.1", "grok-4.20"]
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
    protocol: "openai",
    models: ["kimi-k3.1-pro", "kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"]
  },
  qwen: {
    label: "Qwen (DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    models: ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus", "qwen3-coder-next", "qwen3-coder-flash"]
  },
  mistral: {
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    protocol: "openai",
    models: ["mistral-large-4", "devstral-2512", "codestral-2508", "mistral-medium-3-5", "mistral-small-2603"]
  },
  custom: { label: "Custom (OpenAI-compatible)", baseUrl: "", protocol: "openai", models: [] }
};
function resolveModelRef(settings, raw) {
  const query = String(raw ?? "").trim();
  if (!query) return null;
  const lower = query.toLowerCase();
  const providers = Object.keys(PROVIDER_PRESETS).sort((a, b) => b.length - a.length);
  for (const pid of providers) {
    const prefix = `${pid}/`;
    if (lower.startsWith(prefix)) {
      const model = query.slice(prefix.length).trim();
      if (model) return { provider: pid, model };
    }
  }
  const current = settings.model.provider;
  const candidates = [];
  const add = (provider, model) => {
    const m = String(model ?? "").trim();
    if (m && !candidates.some((c) => c.provider === provider && c.model === m)) {
      candidates.push({ provider, model: m });
    }
  };
  for (const m of PROVIDER_PRESETS[current]?.models ?? []) add(current, m);
  for (const m of settings.providers?.[current]?.lastModels ?? []) add(current, m);
  for (const pid of providers) {
    for (const m of PROVIDER_PRESETS[pid].models) add(pid, m);
    for (const m of settings.providers?.[pid]?.lastModels ?? []) add(pid, m);
  }
  const exact = candidates.filter(
    (c) => c.model.toLowerCase() === lower || `${c.provider}/${c.model}`.toLowerCase() === lower
  );
  const pool = exact.length > 0 ? exact : candidates.filter((c) => c.model.toLowerCase().includes(lower));
  pool.sort((a, b) => Number(b.provider === current) - Number(a.provider === current));
  return pool[0] ?? null;
}
function isValidModelConfig(m) {
  if (!m || typeof m !== "object") return false;
  const c = m;
  return !!c.provider && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, c.provider) && typeof c.model === "string" && c.model.trim() !== "";
}
function resolveRunModel(settings) {
  const current = settings?.model;
  if (current && isValidModelConfig(current)) {
    const c = current;
    return { ...c, model: c.model.trim() };
  }
  const providers = settings?.providers ?? {};
  const currentProvider = current && Object.prototype.hasOwnProperty.call(PROVIDER_PRESETS, current.provider) ? current.provider : void 0;
  if (currentProvider && providers[currentProvider]?.enabled !== false) {
    const ids = providerModelIds(providers[currentProvider], PROVIDER_PRESETS[currentProvider].models);
    if (ids.length) return { ...current ?? {}, provider: currentProvider, model: ids[0] };
  }
  for (const pid of Object.keys(PROVIDER_PRESETS)) {
    const entry = providers[pid];
    if (entry?.enabled === false) continue;
    if (entry?.enabled !== true && !providerHasCredentials(entry, PROVIDER_PRESETS[pid])) continue;
    const ids = providerModelIds(entry, PROVIDER_PRESETS[pid].models);
    if (ids.length) return { provider: pid, model: ids[0] };
  }
  return null;
}
var todayStr = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var persistTimer = null;
var pendingDelta = "";
var pendingThink = "";
var deltaScheduled = false;
var deltaRaf = null;
var deltaFallbackTimer = null;
var deltaWatchdog = null;
var liveStreamChars = 0;
var DELTA_CADENCE_MS = 32;
var runClosed = false;
var closedSession = null;
var runFailed = false;
var runAborted = false;
function freshRunReport(firstAt = 0) {
  return {
    cardId: null,
    final: false,
    outcome: "completed",
    errorSummary: "",
    errorKey: null,
    stopReason: "",
    files: [],
    commands: [],
    firstAt,
    toastShown: false
  };
}
var runReport = freshRunReport();
var rrWriteByCall = {};
var rrCmdByCall = {};
var pendingWebPreview = null;
var enginePreviewRequested = false;
var previewUserClosed = false;
var RR_WEB_FILE_RE = /\.(html|tsx|jsx|vue|css|js)(?:[?#]|$)/i;
var RR_WRITE_TOOL = /^(?:write_file|edit_file|multi_edit|multi_file_edit|create_file|apply_patch|write_|edit_|notebook_|csv_)/i;
var RR_CMD_TOOL = /^(?:run_command|run_and_show|bash|shell|terminal_)/i;
var RR_BUILD_CMD = /\b(?:npm\s+(?:run\s+)?(?:build|dev|start|serve)|yarn\s+(?:build|dev|start)|pnpm\s+(?:build|dev|start)|vite\b|next\s+(?:dev|build|start)|webpack\b|ng\s+serve|python3?\s+-m\s+http\.server|go\s+run\b|serve\b)/i;
var RR_NON_WEB_CMD = /\b(?:test|lint|install|ci|typecheck|check)\b/i;
function rrArgString(args, keys) {
  if (typeof args === "string") return args.trim();
  if (!args || typeof args !== "object") return "";
  const o = args;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join(" ").trim();
  }
  return "";
}
function noteReportFile(path, ws) {
  if (typeof path !== "string") return;
  const p = path.trim().slice(0, 400);
  if (!p) return;
  if (!runReport.files.includes(p)) runReport.files.push(p);
  if (!RR_WEB_FILE_RE.test(p)) return;
  const ext = (p.toLowerCase().match(/\.(html|tsx|jsx|vue|css|js)(?:[?#]|$)/) ?? [])[1] ?? "";
  if (ext === "html") {
    const clean = p.replace(/\\/g, "/");
    const slash = clean.lastIndexOf("/");
    pendingWebPreview = { kind: "static", dir: slash >= 0 ? clean.slice(0, slash) : "", ws };
  } else {
    pendingWebPreview = { kind: "dev", runtime: "npm", ws };
  }
}
function noteBuildCommand(cmd, ws) {
  const c = typeof cmd === "string" ? cmd.trim() : "";
  if (!c) return;
  if (RR_NON_WEB_CMD.test(c) && !/\b(?:dev|start|serve|build)\b/i.test(c)) return;
  if (!RR_BUILD_CMD.test(c)) return;
  const runtime = /python/i.test(c) ? "python" : /\bgo\s+run\b/i.test(c) ? "go" : "npm";
  pendingWebPreview = { kind: "dev", runtime, ws };
}
function noteRunEvidence(e) {
  try {
    const state = useStore.getState();
    const ws = state.wsPath;
    if (!runReport.firstAt) runReport.firstAt = state.runStartedAt ?? Date.now();
    switch (e.type) {
      case "tool_start": {
        const name = String(e.name ?? "");
        const id = e.toolCallId;
        if (RR_WRITE_TOOL.test(name)) {
          const p = rrArgString(e.args, [
            "path",
            "file_path",
            "filePath",
            "filename",
            "file",
            "target"
          ]);
          if (p && typeof id === "string") rrWriteByCall[id] = p.slice(0, 400);
        } else if (RR_CMD_TOOL.test(name)) {
          const c = rrArgString(e.args, ["cmd", "command", "cmdline"]);
          if (c) {
            runReport.commands.push({ cmd: c.slice(0, 300), ok: false });
            if (typeof id === "string") rrCmdByCall[id] = c.slice(0, 300);
          }
        }
        break;
      }
      case "tool_result": {
        const id = e.toolCallId;
        if (typeof id !== "string") break;
        const written = rrWriteByCall[id];
        if (written) {
          delete rrWriteByCall[id];
          if (e.ok === true) noteReportFile(written, ws);
        }
        const cmd = rrCmdByCall[id];
        if (cmd) {
          delete rrCmdByCall[id];
          for (let i = runReport.commands.length - 1; i >= 0; i--) {
            if (runReport.commands[i].cmd === cmd) {
              runReport.commands[i] = { ...runReport.commands[i], ok: e.ok === true };
              break;
            }
          }
          if (e.ok === true) noteBuildCommand(cmd, ws);
        }
        break;
      }
      case "run_receipt": {
        const files = Array.isArray(e.files) ? e.files : [];
        for (const f of files) if (typeof f === "string") noteReportFile(f, ws);
        for (const c of asCommandArray(e.commands)) {
          if (!c.cmd) continue;
          if (!runReport.commands.some((x) => x.cmd === c.cmd)) {
            runReport.commands.push({ cmd: c.cmd.slice(0, 300), ok: c.ok });
          }
          if (c.ok) noteBuildCommand(c.cmd, ws);
        }
        break;
      }
      case "verify_run": {
        const c = typeof e.cmd === "string" ? String(e.cmd) : "";
        if (c) {
          if (!runReport.commands.some((x) => x.cmd === c)) {
            runReport.commands.push({ cmd: c.slice(0, 300), ok: e.exitCode === 0 });
          }
          if (e.exitCode === 0) noteBuildCommand(c, ws);
        }
        break;
      }
      case "message_end": {
        const sr = e.stopReason;
        if (typeof sr === "string") runReport.stopReason = sr;
        break;
      }
      case "error": {
        const raw = typeof e.message === "string" ? e.message : "";
        const ar = state.settings.language === "ar";
        const code = typeof e.code === "string" ? e.code : void 0;
        runReport.errorSummary = noCreditsToast(raw, ar) ?? localizeRunError(raw, ar, code);
        runReport.errorKey = runErrorKey(raw, code);
        runReport.outcome = "error";
        break;
      }
      case "aborted":
        runReport.outcome = "aborted";
        break;
      case "task_report": {
        const o = e.outcome;
        runReport.outcome = o === "aborted" ? "aborted" : o === "error" ? "error" : "completed";
        break;
      }
      case "preview_open":
        enginePreviewRequested = true;
        break;
      default:
        break;
    }
  } catch {
  }
}
function rrSynthesize(outcome, ar, override) {
  const t = makeT(ar ? "ar" : "en");
  const summary = override?.summary ?? (outcome === "error" ? runReport.errorSummary || t("chat.report.error") : outcome === "aborted" ? t("chat.report.aborted") : t("chat.report.done"));
  const nextSteps = outcome === "error" ? [summary] : outcome === "aborted" ? [t("chat.continue.error")] : [];
  const stopReason = override?.stopReason ?? runReport.stopReason ?? "";
  return {
    outcome,
    summary,
    files: [...runReport.files],
    commands: runReport.commands.map((c) => ({ ...c })),
    nextSteps,
    partial: outcome !== "completed",
    ...stopReason ? { stopReason } : {},
    durationMs: runReport.firstAt ? Math.max(0, Date.now() - runReport.firstAt) : 0,
    at: Date.now()
  };
}
function rrToastSummary(report, ar, t) {
  let s = String(report.summary ?? "").trim();
  if (!s || /^\s*[{[]/.test(s) || /["']\s*(?:message|error|code)\s*["']\s*:/i.test(s)) s = "";
  const firstClause = (v) => v.split(/[—–]/)[0].trim();
  if (s === t("chat.report.done") || s === t("chat.report.error") || s === t("chat.report.aborted")) {
    s = firstClause(s);
  }
  if (s) {
    const arabic = ARABIC_SCRIPT_RE.test(s);
    const latin = hasLatinProse(s);
    const wrong = ar ? !arabic && latin : arabic;
    if (!wrong) return s.slice(0, 200);
  }
  return report.outcome === "completed" ? firstClause(t("chat.report.done")) : report.outcome === "aborted" ? firstClause(t("chat.report.aborted")) : t("err.run.providerUnavailable");
}
function rrEmitReportToast(report, ar) {
  if (!report || runReport.toastShown) return;
  runReport.toastShown = true;
  const t = makeT(ar ? "ar" : "en");
  const firstClause = (v) => v.split(/[—–]/)[0].trim();
  const outcome = report.outcome === "completed" ? firstClause(t("chat.report.done")) : report.outcome === "aborted" ? firstClause(t("chat.report.aborted")) : firstClause(t("chat.report.error"));
  const summary = rrToastSummary(report, ar, t);
  const files = Array.isArray(report.files) ? report.files.length : 0;
  const cmds = Array.isArray(report.commands) ? report.commands : [];
  const failed = cmds.filter((c) => !!c && c.ok === false).length;
  const ms = Math.max(0, Math.floor(report.durationMs || 0));
  const dur = ms >= 1e3 ? `${(ms / 1e3).toFixed(1)}s` : `${ms}ms`;
  const counts = ar ? `${files} \u0645\u0644\u0641\u0627\u062A \xB7 ${cmds.length} \u0623\u0648\u0627\u0645\u0631${failed ? ` (${failed} \u0641\u0627\u0634\u0644\u0629)` : ""} \xB7 ${dur}` : `${files} files \xB7 ${cmds.length} commands${failed ? ` (${failed} failed)` : ""} \xB7 ${dur}`;
  const title = `${outcome}: ${summary} \xB7 ${counts}`;
  const severity = report.outcome === "completed" ? "success" : report.outcome === "aborted" ? "warn" : "error";
  try {
    pushToast({ title, severity, duration: severity === "error" ? 7e3 : 6e3 });
  } catch {
  }
  const seq = (useStore.getState().lastReportToast?.seq ?? 0) + 1;
  useStore.setState({ lastReportToast: { title, severity, seq } });
}
function rrPublish(report, ar, final) {
  if (!runReport.cardId) runReport.cardId = "report";
  if (final) runReport.final = true;
  useStore.setState({ lastTaskReport: report });
  if (final) rrEmitReportToast(report, ar);
}
function rrCommitInto(msgs, report, final, continueReason) {
  rrPublish(report, useStore.getState().settings.language === "ar", final);
  if (continueReason) {
    const task = lastUserTask(msgs);
    if (task) useStore.setState({ continueHint: { task, reason: continueReason } });
  }
}
function rrFlushAutoPreview() {
  const hint = pendingWebPreview;
  pendingWebPreview = null;
  if (!hint || enginePreviewRequested || previewUserClosed) return;
  const s = useStore.getState();
  if (hint.ws && s.wsPath && hint.ws !== s.wsPath) return;
  if (hint.kind === "static") {
    const clean = (hint.dir ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    const absolute = /^[A-Za-z]:[\\/]/.test(clean) || clean.startsWith("/");
    void s.startStaticPreview(clean ? absolute ? clean : wsJoin(s.wsPath, clean) : s.wsPath);
  } else {
    void s.startDevPreview(hint.runtime ?? "npm");
  }
}
var RESUME_MARKER_KEY = "sadeem.active-run-v12";
function writeResumeMarker(m) {
  try {
    localStorage.setItem(RESUME_MARKER_KEY, JSON.stringify({ ...m, at: Date.now() }));
  } catch {
  }
}
function clearResumeMarker() {
  try {
    localStorage.removeItem(RESUME_MARKER_KEY);
  } catch {
  }
}
function readResumeMarker() {
  try {
    const raw = localStorage.getItem(RESUME_MARKER_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw);
    if (!m?.task || !m.at) return null;
    return Date.now() - m.at > 8e3 ? m : null;
  } catch {
    return null;
  }
}
var RUN_STALL_MS = 2e4;
var RUN_HARD_TIMEOUT_MS = 10 * 6e4;
var lastAgentActivityAt = 0;
var runWatchdog = null;
function stopRunWatchdog() {
  if (runWatchdog) {
    clearInterval(runWatchdog);
    runWatchdog = null;
  }
}
function rrCommitWatchdog(quietMs) {
  if (runReport.final) return;
  const s = useStore.getState();
  const ar = s.settings.language === "ar";
  const t = makeT(ar ? "ar" : "en");
  const report = rrSynthesize("aborted", ar, {
    summary: t("err.run.providerUnavailable"),
    stopReason: "renderer_watchdog"
  });
  let session = s.session;
  if (session) {
    const msgs = [...session.messages].map((m) => m.streaming ? { ...m, streaming: false } : m);
    rrCommitInto(msgs, report, true, "error");
    session = { ...session, messages: msgs };
  } else {
    runReport.final = true;
    useStore.setState({ lastTaskReport: report });
  }
  stopRunWatchdog();
  clearResumeMarker();
  useStore.setState({
    ...session ? { session } : {},
    running: false,
    runRecovery: null,
    ...clearedRunActivity(),
    // Keep the watchdog's honest elapsed silence in the report detail.
    lastTaskReport: { ...report, durationMs: Math.max(report.durationMs, quietMs) }
  });
  void useStore.getState().persistSession();
  rrFlushAutoPreview();
}
function noteAgentActivity() {
  lastAgentActivityAt = Date.now();
  const s = useStore.getState();
  if (s.runRecovery) useStore.setState({ runRecovery: null });
}
function startRunWatchdog() {
  stopRunWatchdog();
  lastAgentActivityAt = Date.now();
  runWatchdog = setInterval(() => {
    const s = useStore.getState();
    if (!s.running) {
      stopRunWatchdog();
      return;
    }
    const quiet = Date.now() - lastAgentActivityAt;
    if (quiet > RUN_HARD_TIMEOUT_MS) {
      rrCommitWatchdog(quiet);
      return;
    }
    if (quiet > RUN_STALL_MS) {
      const phase = quiet > RUN_STALL_MS * 2 ? "recovering" : "stalled";
      if (s.runRecovery?.phase !== phase) useStore.setState({ runRecovery: { since: lastAgentActivityAt, phase } });
    }
  }, 2e3);
  try {
    runWatchdog.unref?.();
  } catch {
  }
}
var streamingMsgId = null;
function appendDeltaToMessages(msgs, text) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant") {
      if (m.kind === "text" && m.streaming) {
        msgs[i] = { ...m, content: m.content + text };
        return;
      }
      if (m.kind === "notice" || m.model === "compaction" || m.model === "sys") continue;
      break;
    }
    if (m.role === "user" && (m.model === "steer" || m.model === "queued")) continue;
    break;
  }
  const id = uid();
  msgs.push({
    id,
    role: "assistant",
    kind: "text",
    content: text,
    timestamp: Date.now(),
    streaming: true,
    model: `${useStore.getState().settings.model.provider}/${useStore.getState().settings.model.model}`
  });
  streamingMsgId = id;
}
function appendThinkToMessages(msgs, text) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant") {
      if (m.kind === "text" && m.streaming) {
        msgs[i] = { ...m, thinking: (m.thinking ?? "") + text };
        return;
      }
      break;
    }
    if (m.role === "user" && (m.model === "steer" || m.model === "queued")) continue;
    break;
  }
  const id = uid();
  msgs.push({
    id,
    role: "assistant",
    kind: "text",
    content: "",
    thinking: text,
    timestamp: Date.now(),
    streaming: true,
    model: `${useStore.getState().settings.model.provider}/${useStore.getState().settings.model.model}`
  });
  streamingMsgId = id;
}
function closeStreamingAssistant(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant") {
      if (m.kind === "text" && m.streaming) msgs[i] = { ...m, streaming: false };
      return;
    }
    if (m.role === "user" && (m.model === "steer" || m.model === "queued")) continue;
    return;
  }
}
function clearStreamingRows(msgs) {
  let cleared = false;
  if (streamingMsgId != null) {
    const i = msgs.findIndex((m) => m.id === streamingMsgId && m.streaming);
    if (i >= 0) {
      msgs[i] = { ...msgs[i], streaming: false };
      cleared = true;
    }
  }
  if (!cleared) {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].streaming) {
        msgs[i] = { ...msgs[i], streaming: false };
        cleared = true;
      }
    }
  }
  streamingMsgId = null;
  return cleared;
}
function stripGoalComplete(text) {
  if (!/^[ \t]*GOAL_COMPLETE\b/m.test(text)) return text;
  return text.replace(/^[ \t]*GOAL_COMPLETE\b.*$/gm, "").replace(/\s+$/, "");
}
function flushPendingDelta() {
  if (deltaRaf !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(deltaRaf);
    deltaRaf = null;
  }
  if (deltaFallbackTimer) {
    clearTimeout(deltaFallbackTimer);
    deltaFallbackTimer = null;
  }
  if (deltaWatchdog) {
    clearTimeout(deltaWatchdog);
    deltaWatchdog = null;
  }
  deltaScheduled = false;
  const text = pendingDelta;
  const think = pendingThink;
  pendingDelta = "";
  pendingThink = "";
  if (!text && !think) {
    if (liveStreamChars > 0 && useStore.getState().liveStreamChars !== liveStreamChars) {
      useStore.setState({ liveStreamChars });
    }
    return;
  }
  const session = useStore.getState().session;
  if (!session) return;
  const msgs = [...session.messages];
  if (think) appendThinkToMessages(msgs, think);
  if (text) appendDeltaToMessages(msgs, text);
  useStore.setState({ session: { ...session, messages: msgs }, liveStreamChars });
}
function scheduleDeltaFlush() {
  if (deltaScheduled) return;
  deltaScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    deltaRaf = requestAnimationFrame(() => {
      deltaRaf = null;
      flushPendingDelta();
    });
    deltaWatchdog = setTimeout(() => {
      deltaWatchdog = null;
      if (deltaScheduled) flushPendingDelta();
    }, DELTA_CADENCE_MS);
  } else {
    deltaFallbackTimer = setTimeout(() => {
      deltaFallbackTimer = null;
      flushPendingDelta();
    }, DELTA_CADENCE_MS);
  }
}
var USAGE_PERSIST_MS = 1e4;
var usagePersistTimer = null;
var usageDirty = false;
function scheduleUsagePersist() {
  usageDirty = true;
  if (usagePersistTimer) return;
  usagePersistTimer = setTimeout(() => {
    usagePersistTimer = null;
    flushUsageLog();
  }, USAGE_PERSIST_MS);
}
function flushUsageLog() {
  if (usagePersistTimer) {
    clearTimeout(usagePersistTimer);
    usagePersistTimer = null;
  }
  if (!usageDirty) return;
  usageDirty = false;
  try {
    void api.saveSettings(useStore.getState().settings);
  } catch {
  }
}
var CHAT_WIDTH_KEY = "surnia.chatWidth";
var CHAT_MIN = 320;
var CHAT_MAX = 720;
var CHAT_DEFAULT = 400;
function readChatWidth() {
  try {
    const n = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (Number.isFinite(n) && n > 0) return Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(n)));
  } catch {
  }
  return CHAT_DEFAULT;
}
var dnaReloadTimer = null;
var dnaLastLoad = 0;
var emptyTurnEvidence = () => ({ files: 0, commands: 0, tests: 0, receipt: false });
var turnEvidence = emptyTurnEvidence();
var PR_WRITE_TOOL = /^(?:write_file|edit_file|multi_edit|multi_file_edit|create_file|make_document|apply_patch|write_|edit_|notebook_|csv_)/i;
var PR_TEST_TOOL = /^(?:test_run|lint_check|verify_|coverage_|test_|lint_)/i;
var PR_CMD_TOOL = /^(?:run_command|run_and_show|bash|shell|terminal_)/i;
function noteProofToolName(name) {
  if (typeof name !== "string") return;
  let changed = false;
  if (PR_WRITE_TOOL.test(name)) {
    turnEvidence.files++;
    changed = true;
  }
  if (PR_TEST_TOOL.test(name)) {
    turnEvidence.tests++;
    changed = true;
  }
  if (PR_CMD_TOOL.test(name)) {
    turnEvidence.commands++;
    changed = true;
  }
  if (changed) syncProofVisible();
}
function syncProofVisible() {
  const ev = turnEvidence;
  const hasWork = ev.files > 0 || ev.commands > 0 || ev.tests > 0 || ev.receipt;
  const hasGates = useStore.getState().proof.gates.length > 0;
  const visible = hasWork && hasGates;
  if (useStore.getState().proofVisible !== visible) {
    useStore.setState({ proofVisible: visible });
  }
}
var upsertGate = (gates, g) => {
  const i = gates.findIndex((x) => x.id === g.id);
  if (i >= 0) {
    const next = [...gates];
    next[i] = g;
    return next;
  }
  return [...gates, g];
};
function ingestProofEvent(e) {
  if (e.type === "tool_start") noteProofToolName(e.name);
  else if (e.type === "tool_result" && e.meta && typeof e.meta === "object") {
    noteProofToolName(e.meta.toolName);
  }
  let patch = null;
  switch (e.type) {
    case "verify_run":
      turnEvidence.commands++;
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "verify",
          tone: e.exitCode === 0 ? "ok" : "bad",
          detail: safeDetail(e.cmd, "command") + ` \u2014 exit ${safeDetail(e.exitCode, "?")}`,
          at: Date.now()
        })
      };
      break;
    case "red_green":
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "redGreen",
          tone: e.compliant ? "ok" : "bad",
          detail: safeDetail(e.reason),
          at: Date.now()
        })
      };
      break;
    case "fake_tests":
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "fakes",
          tone: e.high > 0 ? "bad" : "ok",
          detail: safeDetail(e.summary) || `${e.high} high-severity findings of ${e.scanned} scanned`,
          at: Date.now()
        })
      };
      break;
    case "mutation_gate":
      turnEvidence.tests++;
      patch = {
        mutation: {
          verdict: e.verdict,
          ran: e.ran,
          killed: e.killed,
          inconclusive: e.inconclusive === true
        },
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "mutation",
          // 'killed-enough' / 'no-mutations' pass; survivors/weak = partial;
          // baseline-failed = bad; skipped stays unproven (no gate recorded).
          // The ribbon re-derives the HONEST v8.1 tone from `mutation` above;
          // this rollup tone only feeds proofTone()/status.
          tone: e.verdict === "killed-enough" || e.verdict === "no-mutations" ? "ok" : e.verdict === "survivors" ? "bad" : "warn",
          detail: safeDetail(e.detail) || safeDetail(e.verdict),
          at: Date.now()
        })
      };
      break;
    case "critic_verdict":
      turnEvidence.tests++;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "critic",
          tone: e.critical > 0 ? "bad" : e.findings > 0 ? "warn" : "ok",
          detail: safeDetail(e.summary) || `${e.findings} findings \xB7 ${e.critical} critical`,
          at: Date.now()
        })
      };
      break;
    case "run_receipt": {
      const files = Array.isArray(e.files) ? e.files : [];
      const commands = Array.isArray(e.commands) ? e.commands : [];
      const safeFiles = Array.isArray(files) ? files.filter((f) => typeof f === "string" || !!f && typeof f === "object") : [];
      const safeCommands = Array.isArray(commands) ? commands.filter((c) => !!c && typeof c === "object") : [];
      turnEvidence.receipt = true;
      turnEvidence.files += safeFiles.length;
      turnEvidence.commands += safeCommands.length;
      patch = {
        gates: upsertGate(useStore.getState().proof.gates, {
          id: "receipt",
          tone: e.verifyFailed ? "bad" : "ok",
          detail: `${safeFiles.length} files \xB7 ${safeCommands.filter((c) => c.ok === true).length}/${safeCommands.length} commands ok \xB7 ${e.rounds} rounds`,
          at: Date.now()
        })
      };
      break;
    }
    case "proof_package":
      patch = {
        status: e.verdict === "proven" ? "proven" : e.verdict === "failed" ? "failed" : "unproven",
        updatedAt: Date.now()
      };
      break;
    case "error":
      runFailed = true;
      patch = { status: "failed", updatedAt: Date.now() };
      break;
    case "aborted":
      runAborted = true;
      patch = { status: "unproven", updatedAt: Date.now() };
      break;
    case "task_report":
      if (e.outcome === "error") {
        runFailed = true;
        patch = { status: "failed", updatedAt: Date.now() };
      } else if (e.outcome === "aborted") {
        runAborted = true;
        patch = { status: "unproven", updatedAt: Date.now() };
      }
      break;
    case "turn_end": {
      const p = useStore.getState().proof;
      if (runFailed) {
        patch = { status: "failed", updatedAt: Date.now() };
      } else if (runAborted) {
        patch = { status: "unproven", updatedAt: Date.now() };
      } else if (p.gates.length > 0) {
        const bad = p.gates.some((g) => g.tone === "bad");
        const warn = p.gates.some((g) => g.tone === "warn");
        patch = { status: bad ? "failed" : warn ? "unproven" : "proven", updatedAt: Date.now() };
      }
      break;
    }
    default:
      break;
  }
  syncProofVisible();
  if (!patch) return;
  const cur = useStore.getState().proof;
  useStore.setState({ proof: { ...cur, ...patch, updatedAt: patch.updatedAt ?? Date.now() } });
  syncProofVisible();
}
function reportSliceFromEvent(e, ar, errorKeyOverride) {
  const outcome = e.outcome === "completed" ? "completed" : e.outcome === "aborted" ? "aborted" : "error";
  const summary = outcome === "completed" ? safeDetail(e.summary) : localizeRunError(e.summary, ar, errorKeyOverride ?? e.code);
  let nextSteps = asStringArray(e.nextSteps);
  const wrongLanguage = ar ? nextSteps.some((s) => !ARABIC_SCRIPT_RE.test(s) && hasLatinProse(s)) : nextSteps.some((s) => ARABIC_SCRIPT_RE.test(s));
  if (outcome === "error" && wrongLanguage) nextSteps = [summary];
  return {
    outcome,
    summary,
    files: asStringArray(e.files),
    commands: asCommandArray(e.commands),
    ...typeof e.howToRun === "string" && e.howToRun.trim() ? { howToRun: e.howToRun.slice(0, 500) } : {},
    nextSteps,
    ...Array.isArray(e.toolsUsed) ? { toolsUsed: e.toolsUsed.filter((t) => !!t && typeof t === "object") } : {},
    ...Array.isArray(e.notDone) ? { notDone: asStringArray(e.notDone) } : {},
    ...e.usage && typeof e.usage === "object" ? { usage: e.usage } : {},
    ...typeof e.partial === "boolean" ? { partial: e.partial } : {},
    ...typeof e.taskMode === "string" ? { taskMode: e.taskMode } : {},
    ...typeof e.stopReason === "string" ? { stopReason: e.stopReason } : {},
    durationMs: asFiniteMs(e.durationMs),
    at: Date.now()
  };
}
var useStore = (0, import_zustand.create)()((set, get) => ({
  booted: false,
  settings: DEFAULT_SETTINGS,
  license: { plan: "free", mode: "local" },
  wsPath: "",
  fileTree: null,
  treeLoading: false,
  tabs: [],
  activeTab: null,
  session: null,
  sessions: [],
  running: false,
  // v11.20 (A1) — no immediate activity until the user actually sends.
  runStartedAt: null,
  runActivity: null,
  runPhase: null,
  runRecovery: null,
  resumableRun: null,
  todos: [],
  pendingApproval: null,
  planProposal: null,
  sessionUsage: emptySessionUsage(),
  lastTurnUsage: null,
  activeGoal: null,
  queuedCount: 0,
  taskMode: "build",
  steerPending: false,
  queuedItems: [],
  subagentProgress: {},
  lastReview: null,
  skills: [],
  skillsOpen: false,
  ctxWindow: 0,
  ctxWindowEstimated: false,
  liveStreamChars: 0,
  // v7.1 — Proven Change: published honesty metric + verification budget chip.
  falseDoneStats: null,
  verificationBudgetLabel: "",
  // v11.11 (A4-CLOSURE) — the guaranteed completion report (reset per run).
  lastTaskReport: null,
  // v11.28 — the one written-report toast for the last settled run.
  lastReportToast: null,
  // v11.12 CHAT CAPABILITIES — nothing to continue until a turn ends early.
  continueHint: null,
  dna: null,
  dnaStats: null,
  dnaSuggestion: null,
  dnaLoading: false,
  skillsTrustNeeded: false,
  // v11.12 — Living Playbook + Subagent dashboard
  playbook: null,
  playbookHistory: [],
  playbookLoading: false,
  lastPlaybookLearning: null,
  subagents: [],
  subagentsLoading: false,
  subagentDetailId: null,
  subagentSteps: {},
  subagentToolCalls: {},
  flowSuggest: null,
  artifactComments: [],
  chatWidth: readChatWidth(),
  scheduledJobs: [],
  scheduledOpen: false,
  commitSuggestion: null,
  terminalId: null,
  terminalOpen: false,
  termHeight: 240,
  git: null,
  searchResults: null,
  searching: false,
  previewOpen: false,
  previewUrl: "",
  previewSource: "",
  previewError: null,
  previewStatus: null,
  previewWs: "",
  previewAuto: null,
  rail: "workspace",
  sidebarOpen: true,
  chatOpen: true,
  paletteOpen: false,
  modelPickerOpen: false,
  settingsOpen: false,
  settingsSection: "general",
  plansOpen: false,
  shortcutsOpen: false,
  onboardingOpen: false,
  diffView: null,
  capabilityPanel: null,
  rewindPicker: null,
  notice: null,
  account: null,
  webAuthPending: null,
  authChecked: false,
  newProjectOpen: false,
  cloneOpen: false,
  composerInsert: null,
  // v7.2 — focus mode (localStorage-persisted) + empty proof state
  focusMode: readFocusMode(),
  proof: EMPTY_PROOF,
  // v11.15 — hidden until THIS turn produces real, tool-backed evidence.
  proofVisible: false,
  // Run-wide gate tone for the diff trust map (green passed / amber partial /
  // red failed / unknown when no gate has run).
  proofTone: () => {
    const gates = get().proof.gates;
    if (gates.length === 0) return "unknown";
    if (gates.some((g) => g.tone === "bad")) return "bad";
    if (gates.some((g) => g.tone === "warn")) return "partial";
    return "ok";
  },
  // v11.15 — a fresh user turn starts with a CLEAN proof slate. Stale gates
  // from an earlier turn must never make a plain "salam" look proven.
  resetProofForTurn: () => {
    turnEvidence = emptyTurnEvidence();
    runClosed = false;
    closedSession = null;
    runFailed = false;
    runAborted = false;
    runReport = freshRunReport(Date.now());
    rrWriteByCall = {};
    rrCmdByCall = {};
    pendingWebPreview = null;
    enginePreviewRequested = false;
    previewUserClosed = false;
    useStore.setState({
      proof: { status: "unproven", gates: [], updatedAt: 0, mutation: null },
      proofVisible: false
    });
  },
  // ---------------- init ----------------
  init: async () => {
    try {
      const [settings, license, sessions] = await Promise.all([
        api.getSettings(),
        api.licenseGet(),
        api.listSessions()
      ]);
      const loaded = { ...DEFAULT_SETTINGS, ...settings || {} };
      if (settings?.theme === "soft") loaded.theme = "follow";
      set({
        settings: loaded,
        license: license || { plan: "free", mode: "local" },
        sessions: sessions || [],
        // v12 (RESUME) — a marker left by a run that never reached a terminal
        // event means the app closed/crashed mid-task. Offer a one-click resume.
        resumableRun: readResumeMarker()
      });
    } catch {
    }
    try {
      const account = await api.authCurrent() ?? null;
      set({ account, authChecked: true });
    } catch {
      set({ authChecked: true });
    }
    api.onAgentEvent((e) => get().ingestAgentEvent(e));
    if (api.onAuthChanged) {
      api.onAuthChanged((res) => {
        const r = res;
        if (r?.ok && r.account) {
          set({ account: r.account, webAuthPending: null });
          get().notify(
            get().settings.language === "ar" ? `\u062A\u0645 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639: ${r.account.email}` : `Account activated from the website: ${r.account.email}`
          );
          if (r.licenseError) get().notify(r.licenseError);
        } else {
          set({ webAuthPending: null });
          get().notify(
            get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u0641\u0639\u064A\u0644 \u0627\u0644\u062D\u0633\u0627\u0628 \u2014 \u0631\u0645\u0632 \u0627\u0644\u0627\u0642\u062A\u0631\u0627\u0646 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D \u0623\u0648 \u0645\u0646\u062A\u0647\u064A." : "Activation failed \u2014 the pair code is invalid or expired."
          );
        }
      });
    }
    api.onPreviewEvent((e) => {
      if (e.state === "error") {
        const raw = e.error || (Array.isArray(e.lines) ? e.lines.slice(-3).join(" ") : "");
        set({ previewOpen: true, previewError: { reason: "startFailed", detail: localizePreviewError(raw, get().settings.language === "ar") } });
      }
      void get().refreshPreviewStatus();
    });
    if (api.onTermBlocked) {
      api.onTermBlocked((e) => {
        const ar = get().settings.language === "ar";
        pushToast({
          title: (ar ? "\u0623\u0645\u0631 \u0645\u062D\u0638\u0648\u0631: " : "Blocked command: ") + e.cmd,
          severity: "error",
          actionLabel: ar ? "\u0627\u0633\u0645\u062D \u0645\u0631\u0629" : "Allow once",
          onAction: () => {
            void api.termAllowOnce(e.cmd).catch(() => void 0);
            get().notify(ar ? "\u0633\u064F\u0645\u062D \u0645\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u2014 \u0623\u0639\u062F \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0623\u0645\u0631" : "Allowed once \u2014 re-run the command");
          },
          duration: 8e3
        });
      });
    }
    if (api.onTermWarn) {
      api.onTermWarn((e) => {
        const ar = get().settings.language === "ar";
        pushToast({ title: (ar ? "\u062A\u062D\u0630\u064A\u0631 \u0623\u0645\u0631: " : "Command warning: ") + e.cmd, severity: "warn", duration: 2600 });
      });
    }
    if (api.onFsBlock) {
      api.onFsBlock((e) => {
        const ar = get().settings.language === "ar";
        pushToast({ title: (ar ? "\u0643\u062A\u0627\u0628\u0629 \u0645\u062D\u0638\u0648\u0631\u0629 \u062E\u0627\u0631\u062C \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644: " : "Write blocked outside workspace: ") + (e.path || ""), severity: "error" });
      });
    }
    if (typeof api.onDnaEvent === "function") {
      api.onDnaEvent((e) => {
        if (e.type === "updated" || e.type === "refined") {
          void get().loadDna();
        } else if (e.type === "suggestion") {
          const p = e.payload ?? {};
          const text = typeof p.text === "string" ? p.text : "";
          const patternId = typeof p.patternId === "string" ? p.patternId : void 0;
          if (text) set({ dnaSuggestion: { patternId, text } });
        } else if (e.type === "skills-trust") {
          set({ skillsTrustNeeded: true });
        }
      });
    }
    if (typeof api.onPlaybookEvent === "function") {
      api.onPlaybookEvent(() => {
        void get().loadPlaybook();
      });
    }
    if (typeof api.onSubagentsEvent === "function") {
      api.onSubagentsEvent((e) => {
        const rec = e.record;
        set((st) => {
          if (e.type === "cleared") {
            return { subagents: [], subagentSteps: {}, subagentToolCalls: {}, subagentDetailId: null };
          }
          if ((e.type === "toolcall" || e.type === "tool") && e.id) {
            const call = e.call ?? e.toolCall;
            const incoming = call ? [call] : [];
            return {
              subagentToolCalls: {
                ...st.subagentToolCalls,
                [e.id]: mergeSubagentToolCalls(st.subagentToolCalls[e.id], incoming)
              },
              subagents: st.subagents.map(
                (r) => r.id === e.id ? { ...r, toolCalls: mergeSubagentToolCalls(r.toolCalls, incoming) } : r
              )
            };
          }
          if (e.type === "retried" && rec) {
            return {
              subagents: [rec, ...st.subagents.filter((r) => r.id !== rec.id)].sort((a, b) => b.startedAt - a.startedAt),
              subagentSteps: { ...st.subagentSteps, [rec.id]: [{ at: rec.startedAt, done: 0, total: rec.total }] },
              subagentToolCalls: { ...st.subagentToolCalls, [rec.id]: [] }
            };
          }
          if (!rec) return {};
          const others = st.subagents.filter((r) => r.id !== rec.id);
          return {
            subagents: [rec, ...others].sort((a, b) => b.startedAt - a.startedAt),
            // Any ledger push may carry the authoritative persisted transcript.
            ...rec.toolCalls?.length ? { subagentToolCalls: { ...st.subagentToolCalls, [rec.id]: mergeSubagentToolCalls(st.subagentToolCalls[rec.id], rec.toolCalls) } } : {}
          };
        });
      });
    }
    window.addEventListener("surnia:run-review", () => {
      void get().runReview();
    });
    window.addEventListener("surnia:run-recap", () => {
      void get().exportRecap();
    });
    void get().loadJobs();
    api.onMenu((action) => {
      const s = get();
      if (action === "open-folder") s.openFolderDialog();
      else if (action === "new-session") s.newSession();
      else if (action === "toggle-terminal") s.toggleTerminal();
      else if (action === "toggle-preview") s.togglePreview();
      else if (action === "save") s.saveAll();
      else if (action === "settings") s.setSettings(true);
      else if (action === "palette") s.setPalette(true);
    });
    get().applyDoc();
    const recent = get().settings.recentPaths || [];
    if (recent.length > 0) await get().openWorkspace(recent[0]);
    const onboarded = get().settings.onboardingDone;
    if (!onboarded || !get().wsPath) set({ onboardingOpen: !onboarded });
    set({ booted: true });
  },
  applyDoc: () => {
    if (typeof document === "undefined") return;
    const { language, theme } = get().settings;
    const html = document.documentElement;
    html.lang = language;
    html.dir = language === "ar" ? "rtl" : "ltr";
    html.dataset.theme = theme;
  },
  updateSettings: (patch) => {
    const prev = get().settings;
    const patchProviders = patch.providers;
    const prevProviders = prev.providers ?? {};
    const mergedProviders = patchProviders ? Object.fromEntries(
      Object.entries({ ...prevProviders, ...patchProviders }).map(
        ([id, entry]) => [
          id,
          patchProviders[id] ? { ...prevProviders[id] ?? {}, ...patchProviders[id] } : entry
        ]
      )
    ) : prev.providers;
    const settings = {
      ...prev,
      ...patch,
      ...patchProviders ? { providers: mergedProviders } : {},
      // v1142 — clamp the subagent limit at the REAL settings write so a
      // hand-edited / hostile patch can never persist 0, NaN or 1e9. The engine
      // re-clamps on read; this is the first line of defence.
      ...patch.maxSubagents !== void 0 ? { maxSubagents: clampMaxSubagents(patch.maxSubagents) } : {}
    };
    set({ settings });
    get().applyDoc();
    void api.saveSettings?.(settings);
  },
  setLang: (l) => get().updateSettings({ language: l }),
  cycleTheme: () => {
    const order = ["follow", "light", "obsidian", "midnight", "soft", "high"];
    const cur = order.includes(get().settings.theme) ? get().settings.theme : "follow";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    get().updateSettings({ theme: next });
  },
  setMode: (m) => get().updateSettings({ permissionMode: m }),
  // ---------------- workspace ----------------
  openFolderDialog: async () => {
    const path = await api.openFolderDialog();
    if (path) await get().openWorkspace(path);
  },
  openWorkspace: async (path) => {
    pendingWebPreview = null;
    enginePreviewRequested = false;
    previewUserClosed = false;
    set({ wsPath: path, fileTree: null, searchResults: null, previewUrl: "", previewWs: "", previewStatus: null, previewSource: "", previewError: null, previewAuto: null });
    get().updateSettings({
      recentPaths: [path, ...(get().settings.recentPaths || []).filter((p) => p !== path)].slice(0, 8)
    });
    await get().refreshTree();
    void get().loadGit();
    void get().loadSkills();
    void get().loadDna();
    void get().loadPlaybook();
    void get().loadSubagents();
    void get().newSession();
  },
  refreshTree: async () => {
    const { wsPath } = get();
    if (!wsPath) return;
    set({ treeLoading: true });
    try {
      const tree = await api.readDir(wsPath);
      set({ fileTree: tree, treeLoading: false });
    } catch {
      set({ treeLoading: false });
    }
  },
  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTab: path, rail: "editor" });
      return;
    }
    try {
      const content = await api.readFile(path);
      const tab = { path, content, original: content, dirty: false };
      set({ tabs: [...get().tabs, tab], activeTab: path, rail: "editor" });
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0641\u062A\u062D \u0627\u0644\u0645\u0644\u0641" : "Cannot open file");
    }
  },
  closeTab: (path) => {
    const tabs = get().tabs.filter((t) => t.path !== path);
    const activeTab = get().activeTab === path ? tabs[tabs.length - 1]?.path ?? null : get().activeTab;
    set({ tabs, activeTab });
  },
  setActiveTab: (path) => set({ activeTab: path, rail: "editor" }),
  setTabContent: (path, content) => {
    set({
      tabs: get().tabs.map((t) => t.path === path ? { ...t, content, dirty: content !== t.original } : t)
    });
  },
  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    await api.writeFile(path, tab.content);
    set({ tabs: get().tabs.map((t) => t.path === path ? { ...t, original: t.content, dirty: false } : t) });
  },
  saveAll: async () => {
    const dirty = get().tabs.filter((t) => t.dirty);
    for (const t of dirty) await api.writeFile(t.path, t.content);
    set({ tabs: get().tabs.map((t) => ({ ...t, original: t.content, dirty: false })) });
    void get().loadGit();
  },
  createEntry: async (type, parentDir, name) => {
    if (!name) return;
    const p = `${parentDir}/${name}`.replace(/\/+/g, "/");
    try {
      if (type === "file") await api.createFile(p, "");
      else await api.createDir(p);
      await get().refreshTree();
      if (type === "file") void get().openFile(p);
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0625\u0646\u0634\u0627\u0621" : "Create failed");
    }
  },
  deleteEntry: async (path) => {
    try {
      await api.deletePath(path);
      set({ tabs: get().tabs.filter((t) => !t.path.startsWith(path)) });
      const at = get().activeTab;
      if (at && at.startsWith(path)) set({ activeTab: null });
      await get().refreshTree();
      void get().loadGit();
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062D\u0630\u0641" : "Delete failed");
    }
  },
  renameEntry: async (oldPath, newName) => {
    const parent = oldPath.split("/").slice(0, -1).join("/");
    const newPath = `${parent}/${newName}`;
    try {
      await api.renamePath(oldPath, newPath);
      set({
        tabs: get().tabs.map((t) => t.path === oldPath ? { ...t, path: newPath } : t),
        activeTab: get().activeTab === oldPath ? newPath : get().activeTab
      });
      await get().refreshTree();
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0633\u0645\u064A\u0629" : "Rename failed");
    }
  },
  runSearch: async (q) => {
    if (!q.trim() || !get().wsPath) {
      set({ searchResults: null });
      return;
    }
    set({ searching: true });
    try {
      const hits = await api.searchFiles(get().wsPath, q);
      set({ searchResults: hits, searching: false });
    } catch {
      set({ searchResults: [], searching: false });
    }
  },
  // ---------------- sessions ----------------
  newSession: async (title) => {
    const abandoningRun = get().running;
    flushPendingDelta();
    get().resetProofForTurn();
    if (abandoningRun) {
      stopRunWatchdog();
      clearResumeMarker();
    }
    const now = Date.now();
    const s = {
      id: uid(),
      title: title ?? (get().settings.language === "ar" ? "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629" : "New session"),
      createdAt: now,
      updatedAt: now,
      workspace: get().wsPath || void 0,
      model: `${get().settings.model.provider}/${get().settings.model.model}`,
      messageCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      messages: [],
      todos: []
    };
    set({
      session: s,
      todos: [],
      pendingApproval: null,
      running: false,
      ...clearedRunActivity(),
      sessionUsage: emptySessionUsage(),
      lastTurnUsage: null,
      liveStreamChars: 0,
      // v11.10 (A5) — no live estimate across sessions
      // v2.1 control surface resets per session
      taskMode: "build",
      steerPending: false,
      queuedItems: [],
      subagentProgress: {},
      subagentToolCalls: {},
      // v11.36 — transcripts belong to the old session
      lastReview: null,
      planProposal: null,
      continueHint: null
      // v11.12 — a fresh/restored session has nothing to continue
    });
    try {
      const sessions = await api.listSessions();
      set({ sessions: sessions || [] });
    } catch {
    }
  },
  // v10.2 — Codex-style worktree hand-off: pin this chat to an isolated
  // worktree (agent cwd + tools + preview all follow), or unpin to main tree.
  setSessionWorktree: async (name) => {
    const s = get();
    if (!s.session) return false;
    const cur = s.session;
    const ar = s.settings.language === "ar";
    if (!name) {
      if (!cur.worktree) return true;
      set({ session: { ...cur, worktree: void 0 } });
      s.notify(ar ? "\u0639\u0627\u062F\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u0625\u0644\u0649 \u0627\u0644\u0634\u062C\u0631\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629" : "Chat moved back to the main tree");
      return true;
    }
    if (!s.wsPath) {
      s.notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0623\u0648\u0644\u0627\u064B" : "Open a project folder first");
      return false;
    }
    try {
      const wt = await api.worktreeResolve(s.wsPath, name);
      if (!wt) {
        s.notify(ar ? `\u0648\u0631\u0643 \u062A\u0631\u064A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629: ${name}` : `Worktree not found: ${name}`);
        return false;
      }
      set({ session: { ...cur, worktree: { name: wt.name, path: wt.path, branch: wt.branch } } });
      s.notify(
        ar ? `\u062A\u0639\u0645\u0644 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0622\u0646 \u062F\u0627\u062E\u0644: ${wt.name} (${wt.branch})` : `This chat now runs in: ${wt.name} (${wt.branch})`
      );
      return true;
    } catch (err) {
      s.notify(localizeRunError(err, ar));
      return false;
    }
  },
  openSession: async (id) => {
    const abandoningRun = get().running;
    flushPendingDelta();
    const s = await api.loadSession(id);
    if (!s) return;
    get().resetProofForTurn();
    if (abandoningRun) {
      stopRunWatchdog();
      clearResumeMarker();
    }
    if (s.messages.some((m) => m.streaming)) {
      s.messages = s.messages.map((m) => m.streaming ? { ...m, streaming: false } : m);
    }
    streamingMsgId = null;
    let sessionUsage = emptySessionUsage();
    for (const m of s.messages) {
      if (m.usage) sessionUsage = accumulateUsage(sessionUsage, m.usage);
    }
    const footerTokens = sessionUsage.inputTokens + sessionUsage.outputTokens;
    const metaTokens = s.totalTokens || 0;
    const metaCost = s.totalCostUsd || 0;
    if (footerTokens <= 0 && (metaTokens > 0 || metaCost > 0)) {
      sessionUsage = { inputTokens: metaTokens, outputTokens: 0, costUsd: metaCost, estimated: true };
    }
    const lastUsageRow = [...s.messages].reverse().find((m) => m.usage)?.usage ?? null;
    set({
      session: s,
      todos: s.todos || [],
      running: false,
      ...clearedRunActivity(),
      pendingApproval: null,
      sessionUsage,
      lastTurnUsage: lastUsageRow,
      liveStreamChars: 0,
      // restored sessions are idle — no ≈ estimate
      activeGoal: null,
      queuedCount: 0,
      taskMode: "build",
      steerPending: false,
      queuedItems: [],
      subagentProgress: {},
      subagentToolCalls: {},
      // v11.36 — transcripts belong to the old session
      lastReview: null,
      planProposal: null,
      continueHint: null
      // v11.12 — a fresh/restored session has nothing to continue
    });
    try {
      const g = await api.goalGet(id);
      if (g && g.goal) set({ activeGoal: { goal: g.goal, pct: g.pct } });
    } catch {
    }
    try {
      const sessions = await api.listSessions();
      set({ sessions: sessions || [] });
    } catch {
    }
  },
  // ---------------- scheduled jobs (v2) ----------------
  loadJobs: async () => {
    try {
      const jobs = await api.scheduleList();
      set({ scheduledJobs: jobs || [] });
    } catch {
    }
  },
  scheduleAdd: async (job) => {
    try {
      await api.scheduleAdd(job);
      await get().loadJobs();
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629" : "Could not create the scheduled job");
    }
  },
  scheduleRemoveJob: async (id) => {
    try {
      await api.scheduleRemove(id);
      await get().loadJobs();
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0627\u0644\u0645\u0647\u0645\u0629" : "Could not delete the job");
    }
  },
  scheduleToggleJob: async (id, enabled) => {
    set({ scheduledJobs: get().scheduledJobs.map((j) => j.id === id ? { ...j, enabled } : j) });
    try {
      await api.scheduleToggle(id, enabled);
      await get().loadJobs();
    } catch {
      void get().loadJobs();
    }
  },
  scheduleRunJobNow: async (id) => {
    set({ scheduledJobs: get().scheduledJobs.map((j) => j.id === id ? { ...j, lastStatus: "running" } : j) });
    try {
      await api.scheduleRunNow(id);
      get().notify(get().settings.language === "ar" ? "\u0623\u064F\u0637\u0644\u0642\u062A \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0622\u0646" : "Job launched");
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0645\u0647\u0645\u0629" : "Could not run the job");
    } finally {
      await get().loadJobs();
    }
  },
  setScheduled: (o) => {
    set({ scheduledOpen: o });
    if (o) void get().loadJobs();
  },
  clearGoal: async () => {
    const sid = get().session?.id;
    set({ activeGoal: null });
    if (!sid) return;
    try {
      await api.goalClear(sid);
    } catch {
    }
  },
  deleteSession: async (id) => {
    flushPendingDelta();
    await api.deleteSession(id);
    const sessions = await api.listSessions();
    set({ sessions });
    if (get().session?.id === id) void get().newSession();
  },
  renameSession: async (id, title) => {
    if (get().session?.id === id) {
      const s = { ...get().session, title };
      set({ session: s });
      await get().persistSession();
    }
  },
  persistSession: async () => {
    const s = get().session;
    if (!s) return;
    const doSave = async () => {
      const cur = get().session;
      if (!cur) return;
      if (cur.messages.length === 0) return;
      const tokens = cur.messages.reduce((a, m) => a + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0), 0);
      const cost = cur.messages.reduce((a, m) => a + (m.usage?.costUsd ?? 0), 0);
      const data = {
        ...cur,
        // v11.9 S3 — never persist a torn stream: strip streaming:true in the
        // serialized copy (a saved live-looking row would resurrect the
        // blinking cursor on reload; S2 sanitizes the load path too).
        // thinkMs footers survive untouched.
        messages: cur.messages.some((m) => m.streaming) ? cur.messages.map((m) => m.streaming ? { ...m, streaming: false } : m) : cur.messages,
        todos: get().todos,
        messageCount: cur.messages.length,
        totalTokens: tokens,
        totalCostUsd: cost,
        updatedAt: Date.now()
      };
      await api.saveSession(data);
      const meta = {
        id: cur.id,
        title: cur.title,
        createdAt: cur.createdAt,
        updatedAt: data.updatedAt,
        workspace: cur.workspace,
        worktree: cur.worktree,
        model: cur.model,
        messageCount: data.messageCount,
        totalTokens: data.totalTokens,
        totalCostUsd: data.totalCostUsd
      };
      const prev = get().sessions;
      set({
        sessions: prev.some((m) => m.id === cur.id) ? prev.map((m) => m.id === cur.id ? meta : m) : [...prev, meta]
      });
    };
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void doSave(), 400);
  },
  // ---------------- agent ----------------
  resumeTask: async () => {
    const r = get().resumableRun;
    if (!r) return;
    const note = get().settings.language === "ar" ? "[\u0627\u0633\u062A\u0626\u0646\u0627\u0641 \u0628\u0639\u062F \u0627\u0646\u0642\u0637\u0627\u0639] \u0648\u0627\u0635\u0644 \u0645\u0646 \u062D\u064A\u062B \u062A\u0648\u0642\u0641\u062A \u2014 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u0646\u062C\u0632 \u0645\u062D\u0641\u0648\u0638\u060C \u0644\u0627 \u062A\u0639\u0650\u062F \u0645\u0627 \u062A\u0645." : "[RESUMED after interruption] Continue exactly where you stopped \u2014 completed work is saved, do not redo it.";
    set({ resumableRun: null, runRecovery: { since: Date.now(), phase: "recovered", note: "resumed from checkpoint" } });
    await get().sendMessage(`${note}

${r.task}`);
  },
  dismissResumable: () => {
    clearResumeMarker();
    set({ resumableRun: null });
  },
  sendMessage: async (text, images, displayAs) => {
    const raw = text.trim();
    if (!raw && !(images && images.length)) return;
    const s = get();
    void api.flowsHit?.(raw).then((r) => {
      if (r?.suggest) set({ flowSuggest: { text: raw } });
    }).catch(() => {
    });
    if (s.running) {
      if (raw.startsWith("/")) return;
      const sid = s.session?.id;
      if (!sid) return;
      try {
        await api.queueSend(sid, raw);
        flushPendingDelta();
        const cur = get().session;
        if (cur) {
          const msgs = [...cur.messages];
          closeStreamingAssistant(msgs);
          msgs.push({ id: uid(), role: "user", kind: "text", content: raw, model: "queued", timestamp: Date.now() });
          set({
            queuedItems: [...get().queuedItems, raw],
            queuedCount: get().queuedCount + 1,
            session: { ...cur, messages: msgs }
          });
        } else {
          set({ queuedItems: [...get().queuedItems, raw], queuedCount: get().queuedCount + 1 });
        }
        void get().persistSession();
      } catch {
        get().notify(s.settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0631\u0633\u0627\u0644\u0629 \u0644\u0644\u0637\u0627\u0628\u0648\u0631" : "Could not queue the message");
      }
      return;
    }
    if (raw.startsWith("/")) {
      const cmd = raw.slice(1).split(/\s+/)[0].toLowerCase();
      const ar = s.settings.language === "ar";
      if (cmd === "help") {
        const tt = slashT(ar);
        const msg = {
          id: uid(),
          role: "assistant",
          kind: "text",
          content: (ar ? "\u0623\u0648\u0627\u0645\u0631 \u0643\u0648\u062F\u0643\u0633 \u0627\u0644\u0645\u062A\u0627\u062D\u0629:\n" : "Available SADEEM commands:\n") + "/init \u2014 " + (ar ? "\u0625\u0646\u0634\u0627\u0621 \u0630\u0627\u0643\u0631\u0629 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 (MEMORY.md)" : "generate project memory (MEMORY.md)") + "\n/compact \u2014 " + (ar ? "\u062A\u0644\u062E\u064A\u0635 \u0648\u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642" : "summarize and compact context") + "\n/context \u2014 " + (ar ? "\u062A\u0641\u0635\u064A\u0644 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642" : "context window breakdown") + "\n/rewind \u2014 " + (ar ? "\u0627\u062E\u062A\u064A\u0627\u0631 \u0646\u0642\u0637\u0629 \u062A\u062D\u0642\u0642 \u0648\u0627\u0633\u062A\u0639\u0627\u062F\u062A\u0647\u0627 (\u0642\u0627\u0626\u0645\u0629)" : "pick a checkpoint to restore (chooser)") + "\n/effort \u2014 " + (ar ? "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0639\u0645\u064A\u0642" : "toggle deep thinking effort") + "\n/plan \u2014 " + (ar ? "\u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629 (\u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637)" : "plan mode (read-only)") + "\n/clear \u2014 " + (ar ? "\u062C\u0644\u0633\u0629 \u062C\u062F\u064A\u062F\u0629" : "start a fresh session") + "\n/model \u2014 " + (ar ? "\u062A\u063A\u064A\u064A\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C (\u0627\u0643\u062A\u0628 \u200E/model \u062B\u0645 \u0627\u0644\u0627\u0633\u0645)" : "change model (use /model <name>)") + "\n/profile \u2014 " + tt("slash.help.profile", "switch the tool profile (essential | balanced | full)") + "\n/undo \u2014 " + tt("slash.help.undo", "restore the newest checkpoint") + "\n/continue \u2014 " + tt("slash.help.continue", "continue the last interrupted task") + "\n/mode \u2014 " + (ar ? "\u062A\u0628\u062F\u064A\u0644 \u0648\u0636\u0639 \u0627\u0644\u0623\u0630\u0648\u0646\u0627\u062A" : "cycle permission mode") + "\n/theme \u2014 " + (ar ? "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0633\u0645\u0629" : "cycle theme") + "\n/lang \u2014 " + (ar ? "\u062A\u0628\u062F\u064A\u0644 \u0627\u0644\u0644\u063A\u0629" : "toggle language") + "\n/terminal \u2014 " + (ar ? "\u0625\u0638\u0647\u0627\u0631 \u0627\u0644\u0637\u0631\u0641\u064A\u0629" : "toggle terminal") + "\n/cost \u2014 " + (ar ? "\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u062C\u0644\u0633\u0629" : "session usage") + "\n/goal \u2014 " + (ar ? "\u062A\u0639\u064A\u064A\u0646 \u0647\u062F\u0641 \u0644\u0644\u0648\u0643\u064A\u0644 \u0648\u062A\u062A\u0628\u0639 \u062A\u0642\u062F\u0645\u0647" : "set a goal the agent tracks") + "\n/review \u2014 " + (ar ? "\u0645\u0631\u0627\u062C\u0639\u0629 \u0630\u0643\u064A\u0629 \u0644\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u063A\u064A\u0631 \u0627\u0644\u0645\u0648\u062F\u0639\u0629" : "AI review of uncommitted changes") + "\n/handoff \u2014 " + (ar ? "\u0645\u0630\u0643\u0631\u0629 \u062A\u0633\u0644\u064A\u0645 \u0627\u0644\u062C\u0644\u0633\u0629 (HANDOFF.md) \u0644\u0644\u0645\u062A\u0627\u0628\u0639\u0629 \u0644\u0627\u062D\u0642\u0627\u064B" : "session handoff note (HANDOFF.md) for resuming later") + "\n/grill \u2014 " + (ar ? "\u0645\u0642\u0627\u0628\u0644\u0629 \u0623\u0633\u0626\u0644\u0629 \u0642\u0628\u0644 \u0627\u0644\u0628\u0631\u0645\u062C\u0629 (\u062E\u064A\u0627\u0631\u0627\u062A \u0645\u0648\u0635\u0649 \u0628\u0647\u0627)" : "interview me before coding (recommended options first)") + "\n/dna \u2014 " + (ar ? "\u0645\u0644\u062E\u0635 \u0645\u0627 \u062A\u0639\u0644\u0651\u0645\u0647 \u0633\u062F\u064A\u0645 (\u200F/dna forget \u0644\u0644\u0646\u0633\u064A\u0627\u0646)" : "what SADEEM has learned (/dna forget to clear)") + "\n/commit \u2014 " + (ar ? "\u0627\u0642\u062A\u0631\u0627\u062D \u0631\u0633\u0627\u0644\u0629 \u0625\u064A\u062F\u0627\u0639 \u0630\u0643\u064A\u0629" : "AI-suggested commit message") + "\n/fork \u2014 " + (ar ? "\u062A\u0634\u0639\u064A\u0628 \u0647\u0630\u0647 \u0627\u0644\u062C\u0644\u0633\u0629" : "fork this session") + "\n/export \u2014 " + (ar ? "\u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u062C\u0644\u0633\u0629 \u0625\u0644\u0649 Markdown" : "export the session as Markdown") + "\n/status \u2014 " + (ar ? "\u062D\u0627\u0644\u0629 \u0627\u0644\u062C\u0644\u0633\u0629 (\u0627\u0644\u0646\u0645\u0648\u0630\u062C\u060C \u0627\u0644\u0648\u0636\u0639\u060C \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645)" : "session status (model, mode, usage)") + "\n/diff \u2014 " + (ar ? "\u0639\u0631\u0636 \u0641\u0631\u0642 \u0634\u062C\u0631\u0629 \u0627\u0644\u0639\u0645\u0644 \u0641\u064A \u0639\u0627\u0631\u0636 \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062A" : "open the working-tree diff in the diff viewer") + "\n/share \u2014 " + (ar ? "\u062A\u0648\u0644\u064A\u062F \u0635\u0641\u062D\u0629 HTML \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0645\u0646 \u0627\u0644\u062C\u0644\u0633\u0629" : "generate a shareable HTML report of the session") + "\n/schedule \u2014 " + (ar ? "\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u062C\u062F\u0648\u0644\u0629 (cron)" : "scheduled jobs (cron)") + "\n/plans \u2014 " + (ar ? "\u0627\u0644\u062E\u0637\u0637" : "plans"),
          timestamp: Date.now()
        };
        const session2 = s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null;
        set({ session: session2 });
        void get().persistSession();
        return;
      }
      if (cmd === "clear") {
        const tt = slashT(ar);
        if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(tt("slash.clear.confirm", "Start a new session? The current transcript stays saved in Sessions."))) {
          return;
        }
        await get().newSession();
        get().notify(tt("slash.clear.done", "New session started"));
        return;
      }
      if (cmd === "model") return void await get().switchModel(raw.slice(cmd.length + 1).trim());
      if (cmd === "profile") return void await get().switchToolProfile(raw.slice(cmd.length + 1).trim());
      if (cmd === "undo") return void await get().undoLastCheckpoint();
      if (cmd === "continue") return void await get().continueTask();
      if (cmd === "mode") {
        return get().setMode(nextIn(PERMISSION_MODES, s.settings.permissionMode));
      }
      if (cmd === "dna") {
        const arg = raw.slice(cmd.length + 1).trim().toLowerCase();
        if (arg.startsWith("forget")) {
          if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
          const userMsg3 = { id: uid(), role: "user", kind: "text", content: raw, timestamp: Date.now() };
          set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg3] } : null });
          const before = get().dna;
          const n = (before?.patterns.length ?? 0) + (before?.feedback.length ?? 0);
          try {
            await api.dnaClear("workspace", s.wsPath);
          } catch {
          }
          void get().loadDna();
          const out2 = {
            id: uid(),
            role: "assistant",
            kind: "text",
            content: ar ? `\u0646\u064F\u0633\u064A\u062A \u0630\u0627\u0643\u0631\u0629 \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644 \u2014 \u0645\u064F\u0633\u062D\u062A ${n} \u0645\u062F\u062E\u0644\u0629. \u0627\u0644\u062C\u0644\u0633\u0627\u062A \u0627\u0644\u0642\u0627\u062F\u0645\u0629 \u062A\u0628\u062F\u0623 \u0645\u0646 \u0635\u0641\u062D\u0629 \u062C\u062F\u064A\u062F\u0629.` : `Forgot the workspace DNA \u2014 ${n} entries cleared. Future sessions start fresh.`,
            timestamp: Date.now()
          };
          const cur2 = get().session;
          return set({ session: cur2 ? { ...cur2, messages: [...cur2.messages, out2] } : null });
        }
        const userMsg2 = { id: uid(), role: "user", kind: "text", content: raw, timestamp: Date.now() };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg2] } : null });
        const dna = get().dna;
        const stats = get().dnaStats;
        const patterns = dna?.patterns ?? [];
        const factsLearned = dna?.stats.factsRecorded ?? 0;
        const top3 = [...patterns].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, 3);
        const lines = [
          ar ? `\u0630\u0627\u0643\u0631\u0629 \u0633\u062F\u064A\u0645 \u2014 ${patterns.length} \u0623\u0646\u0645\u0627\u0637 \xB7 ${factsLearned} \u062D\u0642\u064A\u0642\u0629 \u0645\u062A\u0639\u0644\u064E\u0651\u0645\u0629 \xB7 ${dna?.stats.sessionsObserved ?? 0} \u062C\u0644\u0633\u0629 \u0645\u064F\u0644\u0627\u062D\u064E\u0638\u0629` : `SADEEM DNA \u2014 ${patterns.length} patterns \xB7 ${factsLearned} facts learned \xB7 ${dna?.stats.sessionsObserved ?? 0} sessions observed`
        ];
        if (top3.length > 0) {
          lines.push(ar ? "\u0623\u0628\u0631\u0632 \u0627\u0644\u0623\u0646\u0645\u0627\u0637:" : "Top patterns:");
          for (const p of top3) {
            lines.push(`\u2022 ${p.text} (${p.kind} \xD7${p.count})`);
          }
        } else {
          lines.push(ar ? "\u0644\u0627 \u0623\u0646\u0645\u0627\u0637 \u0628\u0639\u062F \u2014 \u0627\u0639\u0645\u0644 \u0645\u0639 \u0633\u062F\u064A\u0645 \u0648\u0639\u062F \u0644\u0627\u062D\u0642\u0627\u064B." : "No patterns yet \u2014 work with SADEEM and check back.");
        }
        lines.push(
          ar ? `\u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0646\u0634\u0637\u0629: ${patterns.length}/60 \u0646\u0645\u0637 \u2014 ${factsLearned} \u062D\u0642\u064A\u0642\u0629 \u062A\u0639\u0644\u0651\u0645\u0647\u0627 \u0633\u062F\u064A\u0645 \u0641\u064A \u0627\u0644\u0645\u062C\u0645\u0644. \u0623\u0642\u062F\u0645 \u0627\u0644\u0623\u0646\u0645\u0627\u0637 \u0627\u0644\u0645\u062A\u0643\u0631\u0631\u0629 \u062A\u064F\u0633\u062A\u0628\u062F\u0644 \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0628\u0623\u0646\u0645\u0627\u0637 \u062C\u062F\u064A\u062F\u0629\u061B \u0627\u0644\u062A\u0639\u0644\u0651\u0645 \u0644\u0627 \u064A\u062A\u0648\u0642\u0641.` : `Active window: ${patterns.length}/60 patterns \u2014 ${factsLearned} facts learned in total. Oldest reinforced patterns retire automatically as new ones arrive; learning never stops.`
        );
        if (typeof stats?.growth !== "undefined" && stats.growth.length > 0) {
          const week = stats.growth.slice(-7).reduce((a, g) => a + g.count, 0);
          lines.push(ar ? `\u0627\u0644\u0646\u0634\u0627\u0637 \u062E\u0644\u0627\u0644 7 \u0623\u064A\u0627\u0645: ${week}` : `Last 7 days: ${week} new facts`);
        }
        lines.push(ar ? "\u0627\u0641\u062A\u062D 06 \u2014 DNA \u0645\u0646 \u0627\u0644\u0634\u0631\u064A\u0637 \u0627\u0644\u062C\u0627\u0646\u0628\u064A \u0644\u0644\u062E\u0631\u064A\u0637\u0629 \u0627\u0644\u0643\u0627\u0645\u0644\u0629." : "Open 06 \u2014 DNA in the rail for the full map.");
        const out = { id: uid(), role: "assistant", kind: "text", content: lines.join("\n"), timestamp: Date.now() };
        const cur = get().session;
        return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
      }
      if (cmd === "theme") return get().cycleTheme();
      if (cmd === "lang") return get().setLang(ar ? "en" : "ar");
      if (cmd === "terminal") return void await get().toggleTerminal();
      if (cmd === "plans") return set({ plansOpen: true });
      if (cmd === "flows") return set({ rail: "flows", sidebarOpen: true });
      if (cmd === "pr" || cmd === "changelog" || cmd === "tests" || cmd === "handoff" || cmd === "grill") {
        const arg = raw.slice(cmd.length + 1).trim();
        return void get().sendMessage(SLASH_PROMPT_TEMPLATES[cmd](arg), images, raw);
      }
      if (cmd === "schedule") {
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        return get().setScheduled(true);
      }
      if (cmd === "goal") return void get().setGoal(raw.slice(cmd.length + 1).trim());
      if (cmd === "review") {
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        const reviewMsg = {
          id: uid(),
          role: "user",
          kind: "text",
          content: "/review",
          timestamp: Date.now()
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, reviewMsg] } : null });
        try {
          const res = await api.gitReview(s.wsPath);
          const out = {
            id: uid(),
            role: "assistant",
            kind: "text",
            content: res.ok && res.review ? res.review : res.error ?? (ar ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0645\u0631\u0627\u062C\u0639\u0629." : "No review notes."),
            model: "review",
            timestamp: Date.now()
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, out] } : null });
        } catch {
          const errMsg = {
            id: uid(),
            role: "assistant",
            kind: "text",
            content: ar ? "\u0641\u0634\u0644\u062A \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062A\u063A\u064A\u064A\u0631\u0627\u062A \u2014 \u062A\u0623\u0643\u062F \u0623\u0646 \u0627\u0644\u0645\u0633\u062A\u0648\u062F\u0639 git \u0648\u0633\u062C\u0651\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0644\u0644\u0645\u0632\u0648\u062F." : "Change review failed \u2014 make sure this is a git repo and a provider key is set.",
            model: "error",
            timestamp: Date.now()
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, errMsg] } : null });
        }
      }
      if (cmd === "fork") {
        if (!s.session) return;
        try {
          const res = await api.sessionFork(s.session.id);
          if (res.ok && res.sessionId) {
            get().notify(ar ? "\u062A\u0645 \u062A\u0634\u0639\u064A\u0628 \u0627\u0644\u062C\u0644\u0633\u0629" : "Session forked");
            const sessions = await api.listSessions();
            set({ sessions });
            return void await get().openSession(res.sessionId);
          }
          return get().notify(res.error ?? (ar ? "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0634\u0639\u064A\u0628" : "Fork failed"));
        } catch {
          return get().notify(ar ? "\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u062A\u0634\u0639\u064A\u0628" : "Fork failed");
        }
      }
      if (cmd === "export") {
        const sess = get().session;
        if (!sess) return;
        const tt = slashT(ar);
        const md = buildSessionMarkdown(sess);
        const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        const file = wsJoin(s.wsPath, ".surnia", "export", `session-${stamp}.md`);
        try {
          await api.writeFile(file, md);
          get().notify(tt("slash.export.written", "Session exported to {path}", { path: file }));
        } catch {
          downloadBlob(md, `session-${stamp}.md`, "text/markdown;charset=utf-8");
          get().notify(tt("slash.export.downloaded", "Session exported (Markdown download)"));
        }
        return;
      }
      if (cmd === "commit") {
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        const commitMsg = {
          id: uid(),
          role: "user",
          kind: "text",
          content: "/commit",
          timestamp: Date.now()
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, commitMsg] } : null });
        try {
          const res = await api.gitCommitMessage(s.wsPath);
          const text2 = res.ok && res.message ? res.message : "";
          if (text2) {
            set({ commitSuggestion: { text: text2, seq: (get().commitSuggestion?.seq ?? 0) + 1 } });
            const out = {
              id: uid(),
              role: "assistant",
              kind: "text",
              content: (ar ? "\u0631\u0633\u0627\u0644\u0629 \u0625\u064A\u062F\u0627\u0639 \u0645\u0642\u062A\u0631\u062D\u0629:\n```\n" : "Suggested commit message:\n```\n") + text2 + (ar ? "\n```\n\u0631\u0627\u062C\u0639\u0647\u0627 \u0645\u0646 \u0644\u0648\u062D\u0629 \u0627\u0644\u062A\u062D\u0643\u0645 \u0628\u0627\u0644\u0645\u0635\u062F\u0631 \u062B\u0645 \u0623\u0648\u062F\u0650\u0639." : "\n```\nReview it in the Source control panel, then commit."),
              timestamp: Date.now()
            };
            const cur2 = get().session;
            return set({ session: cur2 ? { ...cur2, messages: [...cur2.messages, out] } : null });
          }
          const none = {
            id: uid(),
            role: "assistant",
            kind: "text",
            content: res.error ?? (ar ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u062A\u063A\u064A\u064A\u0631\u0627\u062A \u0644\u0625\u064A\u062F\u0627\u0639\u0647\u0627." : "No changes to commit."),
            model: "error",
            timestamp: Date.now()
          };
          const cur = get().session;
          return set({ session: cur ? { ...cur, messages: [...cur.messages, none] } : null });
        } catch {
          return get().notify(ar ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u0648\u0644\u064A\u062F \u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u0625\u064A\u062F\u0627\u0639" : "Could not generate a commit message");
        }
      }
      if (cmd === "cost") {
        const u = get().sessionUsage;
        const msg = {
          id: uid(),
          role: "assistant",
          kind: "text",
          content: ar ? `\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0627\u0644\u062C\u0644\u0633\u0629: ${u.inputTokens + u.outputTokens} \u0631\u0645\u0632 \u2014 \u062A\u0643\u0644\u0641\u0629 \u062A\u0642\u062F\u064A\u0631\u064A\u0629 $${u.costUsd.toFixed(4)}` : `Session usage: ${u.inputTokens + u.outputTokens} tokens \u2014 est. cost $${u.costUsd.toFixed(4)}`,
          timestamp: Date.now()
        };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
        return;
      }
      if (cmd === "status") {
        const tt = slashT(ar);
        const st = get();
        const u = st.sessionUsage;
        const provLabel = PROVIDER_PRESETS[st.settings.model.provider]?.label ?? st.settings.model.provider;
        const hasKey = !!PROVIDER_PRESETS[st.settings.model.provider]?.keyless || !!st.settings.providers[st.settings.model.provider]?.apiKey;
        const lines = [
          tt("slash.status.title", "Session status"),
          "\u2022 " + tt("slash.status.model", "Model") + `: ${provLabel} \u2014 ${st.settings.model.model} (${hasKey ? tt("slash.status.keyOn", "key set") : tt("slash.status.keyOff", "no key")})`,
          "\u2022 " + tt("slash.status.mode", "Permission mode") + ": " + tt(`tb.mode.${st.settings.permissionMode}`, st.settings.permissionMode),
          "\u2022 " + tt("slash.status.workspace", "Workspace") + `: ${st.wsPath || "\u2014"}`,
          "\u2022 " + tt("slash.status.tokens", "Tokens") + `: ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`,
          "\u2022 " + tt("slash.status.cost", "Est. cost") + `: $${u.costUsd.toFixed(4)}`
        ];
        if (st.verificationBudgetLabel) {
          lines.push("\u2022 " + tt("slash.status.budget", "Verification budget") + `: ${st.verificationBudgetLabel}`);
        }
        if (st.falseDoneStats) {
          lines.push(
            "\u2022 " + tt("slash.status.falseDone", "False-done rate") + `: ${(st.falseDoneStats.rate * 100).toFixed(1)}% (${st.falseDoneStats.falseDone}/${st.falseDoneStats.claimed})`
          );
        }
        appendAssistantRow(get, lines.join("\n"), "system-status");
        return;
      }
      if (cmd === "diff") {
        return void await get().showDiff(raw.slice(cmd.length + 1).trim());
      }
      if (cmd === "test") {
        return void await get().runTests(raw.slice(cmd.length + 1).trim());
      }
      if (cmd === "explain") {
        return void await get().explainFile(raw.slice(cmd.length + 1).trim());
      }
      if (cmd === "budget") {
        return void await get().budgetCommand();
      }
      if (cmd === "skills") {
        return void await get().skillsCommand(raw.slice(cmd.length + 1).trim());
      }
      if (cmd === "mcp") {
        return void await get().mcpCommand(raw.slice(cmd.length + 1).trim());
      }
      if (cmd === "share") {
        const sess = get().session;
        if (!sess) return;
        const tt = slashT(ar);
        const html = buildShareHtml(sess, { ar, proof: get().proof, usage: get().sessionUsage });
        const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const fallbackDownload = () => {
          downloadBlob(html, `session-${stamp}.html`, "text/html;charset=utf-8");
          get().notify(tt("slash.share.downloaded", "Share page downloaded (HTML)"));
        };
        if (!s.wsPath) return fallbackDownload();
        const file = wsJoin(s.wsPath, ".surnia", "share", `session-${stamp}.html`);
        try {
          await api.writeFile(file, html);
          get().notify(tt("slash.share.written", "Share page saved to {path}", { path: file }));
        } catch {
          fallbackDownload();
        }
        return;
      }
      if (cmd === "init") {
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        const userMsg2 = { id: uid(), role: "user", kind: "text", content: "/init", timestamp: Date.now() };
        set({ session: s.session ? { ...s.session, messages: [...s.session.messages, userMsg2] } : null });
        return void get().runAgent("init");
      }
      if (cmd === "compact") return void get().compact();
      if (cmd === "plan") {
        get().setTaskMode("plan");
        return get().setMode("plan");
      }
      if (cmd === "effort") {
        const agent = s.settings.agent ?? {};
        const next = agent.effort === "deep" ? "standard" : "deep";
        get().updateSettings({ agent: { ...agent, effort: next } });
        const msg = {
          id: uid(),
          role: "assistant",
          kind: "text",
          content: next === "deep" ? ar ? "\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0639\u0645\u064A\u0642 \u0645\u064F\u0641\u0639\u0651\u0644 \u2014 \u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u062E\u0637\u0648\u0627\u062A \u0645\u0636\u0627\u0639\u0641\u0629 \u0648\u062A\u0641\u0643\u064A\u0631 \u0645\u0639\u0645\u0651\u0642 \u0642\u0628\u0644 \u0627\u0644\u0643\u062A\u0627\u0628\u0629." : "Deep effort ON \u2014 2\xD7 step budget and thinking-first execution." : ar ? "\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0639\u0645\u064A\u0642 \u0645\u064F\u0639\u0637\u0651\u0644 \u2014 \u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0642\u064A\u0627\u0633\u064A." : "Deep effort OFF \u2014 standard mode.",
          timestamp: Date.now()
        };
        return set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
      }
      if (cmd === "context") {
        const lastTurn = get().lastTurnUsage;
        const fill = ctxFillTokens(lastTurn);
        const cacheRead = lastTurn?.cacheReadTokens ?? 0;
        const cacheWrite = lastTurn?.cacheCreationTokens ?? 0;
        let windowTokens = get().ctxWindow;
        let estimated = get().ctxWindowEstimated;
        if (!(windowTokens > 0)) {
          try {
            const info = await api.modelInfo(s.settings.model.model);
            windowTokens = info.contextWindow || 0;
            estimated = info.ctxEstimated === true;
          } catch {
          }
        }
        const pct = windowTokens > 0 ? Math.min(100, fill / windowTokens * 100) : 0;
        const lines = [
          ar ? "\u062A\u0641\u0635\u064A\u0644 \u0646\u0627\u0641\u0630\u0629 \u0627\u0644\u0633\u064A\u0627\u0642:" : "Context window breakdown:",
          "\u2022 " + (ar ? "\u062D\u062C\u0645 \u0627\u0644\u0633\u064A\u0627\u0642 \u0627\u0644\u062D\u0627\u0644\u064A" : "current context") + `: ${fill.toLocaleString()} tok` + (lastTurn?.estimated === true ? " (\u2248)" : ""),
          "\u2022 " + (ar ? "\u0645\u0646\u0647\u0627 \u0645\u0646 \u0627\u0644\u0643\u0627\u0634" : "of which cached") + `: ${cacheRead.toLocaleString()} tok` + (cacheWrite > 0 ? ` + ${cacheWrite.toLocaleString()} ${ar ? "\u0643\u062A\u0627\u0628\u0629 \u0643\u0627\u0634" : "cache write"}` : ""),
          windowTokens > 0 ? "\u2022 " + (ar ? "\u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645" : "used") + `: ${fill.toLocaleString()} / ${windowTokens.toLocaleString()} tok \xB7 ${pct.toFixed(1)}%` + (estimated ? " (\u2248 " + (ar ? "\u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u062A\u0642\u062F\u064A\u0631\u064A\u0629 200 \u0623\u0644\u0641" : "window estimated 200k") + ")" : "") : "\u2022 " + (ar ? "\u062D\u062C\u0645 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641 \u0644\u0647\u0630\u0627 \u0627\u0644\u0646\u0645\u0648\u0630\u062C" : "window size unknown for this model"),
          // v11.34 — the advisory now tracks the REAL 90% ceiling, not a fixed
          // 70% of a possibly-200k fallback window.
          isCompactionEligible(fill, windowTokens) ? "\u2022 " + (ar ? "\u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u0634\u0628\u0647 \u0645\u0645\u062A\u0644\u0626\u0629 \u2014 \u0646\u0641\u0651\u0630 /compact" : "window nearly full \u2014 run /compact") : "\u2022 " + (ar ? "\u0627\u0644\u0636\u063A\u0637 \u0627\u0644\u062A\u0644\u0642\u0627\u0626\u064A \u0645\u064F\u0641\u0639\u0651\u0644 \u0639\u0646\u062F \u0627\u0644\u062D\u0627\u062C\u0629" : "auto-compact engages when needed")
        ];
        const msg = { id: uid(), role: "assistant", kind: "text", content: lines.join("\n"), timestamp: Date.now() };
        return set({ session: s.session ? { ...s.session, messages: [...s.session.messages, msg] } : null });
      }
      if (cmd === "rewind") {
        if (!s.wsPath) return get().notify(ar ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
        const tt = slashT(ar);
        try {
          const cps = await api.cpList(s.wsPath);
          if (!cps.length) {
            appendAssistantRow(get, tt("slash.rewind.empty", "No checkpoints yet \u2014 they are created automatically before edits."));
            return;
          }
          const rows = cps.slice(0, 8).map(
            (cp, i) => `\u2022 ${cp.label} \u2014 ${new Date(cp.at).toLocaleTimeString()} \xB7 ` + tt("slash.rewind.files", "{n} files", { n: cp.fileCount }) + (i === 0 ? ` (${tt("slash.rewind.latest", "latest")})` : "")
          );
          appendAssistantRow(
            get,
            "\u23EA " + tt("slash.rewind.list", "Checkpoints ({n})", { n: cps.length }) + "\n" + rows.join("\n") + "\n" + tt("slash.rewind.pick", "Pick a checkpoint to restore \u2014 files go back, the conversation stays.")
          );
          set({ rewindPicker: cps });
        } catch {
          get().notify(tt("slash.rewind.failed", "Restore failed"));
        }
        return;
      }
      if (cmd === "prompts" || cmd === "git" || cmd === "usage" || cmd === "library") {
        return set({ rail: cmd, sidebarOpen: true });
      }
      if (cmd === "settings") return get().setSettings(true);
    }
    const userMsg = {
      id: uid(),
      role: "user",
      kind: "text",
      // v6 — pending artifact comments ride along with this message
      // (Antigravity pending-comment chips), then the queue clears.
      // v11.7 — slash templates (/pr /tests /grill …) expand to rich hidden
      // prompts: the TRANSCRIPT shows the short command the user actually
      // typed (displayAs), the model receives the full expansion.
      content: displayAs?.trim() ? displayAs.trim() : get().artifactComments.length ? `${raw}

[artifact feedback]
${get().artifactComments.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : raw,
      timestamp: Date.now(),
      ...images && images.length ? { images } : {}
    };
    if (get().artifactComments.length) set({ artifactComments: [] });
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, messages: [...session.messages, userMsg] } });
    if (session.messages.length === 0 && session.title) {
      const titleSrc = displayAs?.trim() || raw;
      const title = titleSrc.slice(0, 48) + (titleSrc.length > 48 ? "\u2026" : "");
      set({ session: { ...get().session, title } });
    }
    get().resetProofForTurn();
    await get().runAgent("chat");
  },
  // ---------------- /goal + /compact (real effects, visible feedback) ----------------
  setGoal: async (goal) => {
    const ar = get().settings.language === "ar";
    const session = get().session;
    const text = String(goal ?? "").trim();
    if (!session) {
      get().notify(ar ? "\u0627\u0628\u062F\u0623 \u062C\u0644\u0633\u0629 \u0623\u0648\u0644\u0627\u064B" : "Open a session first");
      return;
    }
    if (!text) {
      const g = get().activeGoal;
      appendAssistantRow(
        get,
        g ? (ar ? "\u0627\u0644\u0647\u062F\u0641 \u0627\u0644\u062D\u0627\u0644\u064A: " : "Active goal: ") + `\u201C${g.goal}\u201D` + (g.pct !== void 0 ? ` \u2014 ${g.pct}%` : "") : ar ? "\u0644\u0627 \u064A\u0648\u062C\u062F \u0647\u062F\u0641 \u0646\u0634\u0637. \u0627\u0643\u062A\u0628 \u200E/goal <\u0627\u0644\u0647\u062F\u0641> \u0644\u062A\u062D\u062F\u064A\u062F \u0647\u062F\u0641 \u064A\u062A\u062A\u0628\u0639\u0647 \u0627\u0644\u0648\u0643\u064A\u0644." : "No active goal. Type /goal <objective> to set a goal the agent will track."
      );
      return;
    }
    try {
      if (api.goalSet) await api.goalSet(session.id, text);
    } catch {
    }
    set({ activeGoal: { goal: text } });
    appendAssistantRow(get, (ar ? "\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0647\u062F\u0641: " : "Goal set: ") + `\u201C${text}\u201D`);
    get().notify(ar ? `\u062A\u0645 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u0647\u062F\u0641: ${text}` : `Goal set: ${text}`);
  },
  compact: async () => {
    const ar = get().settings.language === "ar";
    if (!get().session) {
      get().notify(ar ? "\u0627\u0628\u062F\u0623 \u062C\u0644\u0633\u0629 \u0623\u0648\u0644\u0627\u064B" : "Open a session first");
      return;
    }
    if (get().running) {
      get().notify(ar ? "\u0627\u0644\u0648\u0643\u064A\u0644 \u0645\u0634\u063A\u0648\u0644 \u2014 \u0627\u0646\u062A\u0638\u0631 \u0627\u0643\u062A\u0645\u0627\u0644 \u0627\u0644\u0645\u0647\u0645\u0629" : "Agent is busy \u2014 wait for the current run");
      return;
    }
    appendAssistantRow(get, ar ? "\u062C\u0627\u0631\u064D \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642\u2026" : "Compacting context\u2026", "compaction");
    get().notify(ar ? "\u062C\u0627\u0631\u064D \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642\u2026" : "Compacting context\u2026");
    await get().runAgent("compact");
  },
  runAgent: async (task) => {
    const s = get();
    const t = slashT(s.settings.language === "ar");
    if (!s.session || s.running) return;
    if (!s.wsPath) {
      s.notify(s.settings.language === "ar" ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
      return;
    }
    const earlyModel = resolveRunModel(s.settings);
    if (!earlyModel) {
      s.notify(t(
        "err.setup.noModel",
        "No model is selected. Open Settings \u2192 AI providers and choose a model, then send your message again."
      ));
      return;
    }
    const prov = s.settings.providers[earlyModel.provider];
    const preset = PROVIDER_PRESETS[earlyModel.provider];
    if (!preset?.keyless && !prov?.apiKey && earlyModel.provider !== "custom") {
      s.notify(t("err.setup.noApiKey", "This provider has no API key. Open Settings \u2192 AI providers and add a key for the provider, then try again."));
      s.setSettings(true, "providers");
      return;
    }
    if (earlyModel.provider === "custom" && !prov?.baseUrl) {
      s.notify(s.settings.language === "ar" ? "\u0627\u0636\u0628\u0637 \u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062E\u062F\u0645\u0629 \u0644\u0644\u0645\u0632\u0648\u062F \u0627\u0644\u0645\u062E\u0635\u0635" : "Set the base URL for the custom provider");
      s.setSettings(true, "providers");
      return;
    }
    const today = todayStr();
    const log = [...s.settings.usageLog || []];
    const i = log.findIndex((e) => e.date === today);
    if (i >= 0) log[i] = { ...log[i], runs: log[i].runs + 1 };
    else log.push({ date: today, runs: 1, tokens: 0, costUsd: 0 });
    get().updateSettings({ usageLog: log });
    const pressAt = Date.now();
    set({
      running: true,
      todos: [],
      lastTaskReport: null,
      continueHint: null,
      runRecovery: null,
      resumableRun: null,
      runStartedAt: pressAt,
      runActivity: { phase: "preparing", startedAt: pressAt, at: pressAt },
      runPhase: "preparing"
    });
    get().resetProofForTurn();
    writeResumeMarker({
      task,
      sessionId: s.session.id,
      workspace: s.session.worktree?.path || s.wsPath
    });
    startRunWatchdog();
    try {
      const fresh = get();
      const session = fresh.session ?? s.session;
      if (!session) {
        set({ running: false, runRecovery: null, ...clearedRunActivity() });
        fresh.notify(fresh.settings.language === "ar" ? "\u0627\u0646\u062A\u0647\u062A \u0627\u0644\u062C\u0644\u0633\u0629 \u2014 \u0627\u0641\u062A\u062D \u062C\u0644\u0633\u0629 \u0623\u0648\u0644\u0627\u064B" : "Session closed \u2014 open a session first");
        return;
      }
      const runModel = resolveRunModel(fresh.settings) ?? earlyModel;
      const nowMs = Date.now();
      let messages = session.messages.filter((m) => !m.id.startsWith("sys:") && m.model !== "steer" && m.model !== "queued").map((m) => ({ ...m, streaming: false }));
      if (messages.length === 0) {
        const latestUser = [...session.messages].reverse().find(
          (m) => m.role === "user" && typeof m.id === "string" && !m.id.startsWith("sys:") && m.model !== "queued" && typeof m.content === "string" && m.content.trim() !== ""
        );
        if (latestUser) {
          messages = [{ ...latestUser, streaming: false }];
        } else {
          const content = task === "compact" ? fresh.settings.language === "ar" ? "\u0644\u062E\u0651\u0635 \u0648\u0627\u0636\u063A\u0637 \u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629" : "Summarize and compact the conversation context" : task === "init" ? "/init" : fresh.settings.language === "ar" ? "\u0623\u0643\u0645\u0644 \u0627\u0644\u0645\u0647\u0645\u0629" : "Continue the task";
          messages = [{ id: `uid-synth-${nowMs}`, role: "user", kind: "text", content, timestamp: nowMs }];
        }
      }
      await api.agentRun({
        task,
        sessionId: session.id,
        messages,
        model: runModel,
        mode: fresh.settings.permissionMode,
        taskMode: fresh.taskMode,
        // v10.2 — Codex-style: a chat pinned to a worktree RUNS in it
        // (isolated checkout), not in the main tree.
        workspace: session.worktree?.path || fresh.wsPath,
        mcpServers: (fresh.settings.mcpServers || []).filter((m) => m.enabled)
      });
    } catch (err) {
      stopRunWatchdog();
      clearResumeMarker();
      liveStreamChars = 0;
      runClosed = true;
      closedSession = get().session;
      runFailed = true;
      const raw = String(err ?? "");
      const ar = s.settings.language === "ar";
      const friendly = noCreditsToast(raw, ar) ?? localizeRunError(raw, ar);
      set({
        running: false,
        steerPending: false,
        runRecovery: null,
        resumableRun: null,
        liveStreamChars: 0,
        ...clearedRunActivity()
      });
      if (get().notice !== friendly) get().notify(friendly);
    }
  },
  ingestAgentEvent: (e) => {
    if (!e || typeof e.type !== "string") return;
    if (runReport.final && get().running) {
      runReport = freshRunReport(get().runStartedAt ?? Date.now());
      rrWriteByCall = {};
      rrCmdByCall = {};
      pendingWebPreview = null;
      enginePreviewRequested = false;
      previewUserClosed = false;
    }
    if (runClosed) {
      const freshRun = get().running || get().session !== closedSession;
      if (!freshRun) return;
      runClosed = false;
      closedSession = null;
      runFailed = false;
      runAborted = false;
      runReport = freshRunReport(get().runStartedAt ?? Date.now());
      rrWriteByCall = {};
      rrCmdByCall = {};
      pendingWebPreview = null;
      enginePreviewRequested = false;
      previewUserClosed = false;
    }
    if (runReport.final && (e.type === "error" || e.type === "aborted" || e.type === "task_report")) return;
    try {
      noteAgentActivity();
      noteRunEvidence(e);
      if (e.type === "turn_end" || e.type === "error" || e.type === "aborted" || e.type === "task_report") {
        stopRunWatchdog();
        clearResumeMarker();
        if (get().runRecovery) set({ runRecovery: null });
      }
      if (e.type === "heartbeat") return;
      if (e.type !== "text_delta" && e.type !== "think_delta") flushPendingDelta();
      try {
        ingestProofEvent(e);
      } catch {
      }
      const st = get();
      const session = st.session;
      if (!session) {
        const ar = st.settings.language === "ar";
        if (e.type === "task_report") {
          const report = reportSliceFromEvent(e, ar, runReport.errorKey ?? void 0);
          set({ running: false, steerPending: false, ...clearedRunActivity(), lastTaskReport: report });
          runReport.final = true;
          rrEmitReportToast(report, ar);
          rrFlushAutoPreview();
        } else if (e.type === "error") {
          const report = rrSynthesize("error", ar);
          set({ running: false, steerPending: false, ...clearedRunActivity(), lastTaskReport: report });
          rrFlushAutoPreview();
        } else if (e.type === "turn_end" || e.type === "aborted") {
          if (!runReport.final) {
            const report = rrSynthesize(runReport.outcome, ar);
            set({
              running: false,
              steerPending: false,
              ...clearedRunActivity(),
              lastTaskReport: report
            });
            runReport.final = true;
            rrEmitReportToast(report, ar);
            rrFlushAutoPreview();
          } else {
            set({ running: false, steerPending: false, ...clearedRunActivity() });
          }
        }
        if (e.type === "turn_end") {
          runClosed = true;
          closedSession = get().session;
        }
        return;
      }
      const msgs = [...session.messages];
      switch (e.type) {
        case "text_delta": {
          const text = typeof e.text === "string" ? e.text : "";
          if (!text) return;
          pendingDelta += text;
          liveStreamChars += text.length;
          scheduleDeltaFlush();
          return;
        }
        case "think_delta": {
          const text = typeof e.text === "string" ? e.text : "";
          if (!text) return;
          pendingThink += text;
          liveStreamChars += text.length;
          scheduleDeltaFlush();
          return;
        }
        case "sys_notice": {
          const noticeKind = typeof e.kind === "string" ? e.kind.toLowerCase() : "";
          if (get().running && (noticeKind === "run_start" || noticeKind === "liveness" || noticeKind === "preparing")) {
            const cur = get().runActivity;
            const startedAt = get().runStartedAt ?? cur?.startedAt ?? Date.now();
            const phase = noticeKind === "preparing" ? "preparing" : noticeKind === "run_start" ? "working" : cur?.phase ?? "working";
            set({
              runActivity: {
                phase,
                startedAt,
                at: Date.now(),
                ...typeof e.text === "string" && e.text.trim() ? { note: e.text.trim().slice(0, 160) } : cur?.note ? { note: cur.note } : {}
              },
              runPhase: phase
            });
          }
          const noticeText = typeof e.text === "string" ? e.text.trim() : String(e.text ?? "").trim();
          if (!noticeText) break;
          const nKey = `${e.kind ?? "sys"}::${noticeText}`;
          const recent = msgs.filter((m) => m.kind === "notice").slice(-40);
          if (recent.some((m) => `${m.noticeKind ?? "sys"}::${m.content.trim()}` === nKey)) break;
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "notice",
            noticeKind: e.kind,
            content: noticeText,
            timestamp: Date.now()
          });
          break;
        }
        case "tool_start": {
          const last = msgs[msgs.length - 1];
          if (last && last.streaming) msgs[msgs.length - 1] = { ...last, streaming: false };
          msgs.push({
            id: uid(),
            role: "tool",
            kind: "tool_call",
            toolName: e.name,
            toolCallId: e.toolCallId,
            content: typeof e.args === "string" ? e.args : JSON.stringify(e.args ?? {}),
            timestamp: Date.now()
          });
          break;
        }
        case "tool_result": {
          const idx = msgs.findIndex((m) => m.toolCallId === e.toolCallId && m.kind === "tool_call");
          msgs.push({
            id: uid(),
            role: "tool",
            kind: "tool_result",
            toolCallId: e.toolCallId,
            toolName: idx >= 0 ? msgs[idx].toolName : void 0,
            content: e.output,
            resultOk: e.ok,
            timestamp: Date.now()
          });
          break;
        }
        case "message_end": {
          const rawThinkMs = e.thinkMs;
          const thinkMs = typeof rawThinkMs === "number" && Number.isFinite(rawThinkMs) && rawThinkMs >= 0 ? rawThinkMs : void 0;
          const rawUsage = e.usage;
          const usage = rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage) ? {
            ...rawUsage,
            // runUsageView() calls `.some(a => a.estimated)` on every element
            // and accumulateUsage() spreads the array — so BOTH a non-array
            // `attempts` and a null element inside one threw here. Filter to
            // real objects; an absent/invalid breakdown is honest (no rows).
            attempts: Array.isArray(rawUsage.attempts) ? rawUsage.attempts.filter(
              (a) => !!a && typeof a === "object"
            ) : void 0
          } : rawUsage;
          const runView = usage ? runUsageView(usage) : void 0;
          const finalizeRow = (idx) => {
            const m = msgs[idx];
            const row = {
              ...m,
              streaming: false,
              usage: runView ?? m.usage,
              content: stripGoalComplete(m.content),
              ...thinkMs !== void 0 ? { thinkMs } : {}
            };
            msgs[idx] = row;
          };
          let finalized = false;
          if (streamingMsgId != null) {
            const i = msgs.findIndex((m) => m.id === streamingMsgId && m.role === "assistant");
            if (i >= 0) {
              finalizeRow(i);
              finalized = true;
            }
          }
          if (!finalized) {
            for (let i = 0; i < msgs.length; i++) {
              const m = msgs[i];
              if (m.role === "assistant" && m.streaming) finalizeRow(i);
            }
          }
          streamingMsgId = null;
          if (usage) {
            const hasSpend = usage.inputTokens > 0 || usage.outputTokens > 0 || (usage.runCost ?? usage.costUsd) > 0;
            if (!finalized && hasSpend && runView) {
              attachTurnUsage(msgs, runView);
            }
            const su = accumulateUsage(st.sessionUsage, runView ?? usage);
            set({ sessionUsage: su, lastTurnUsage: { ...usage }, liveStreamChars: 0 });
            const rvTokens = (runView ?? usage).inputTokens + (runView ?? usage).outputTokens;
            const rvCost = (runView ?? usage).costUsd;
            const today = todayStr();
            const log = [...st.settings.usageLog || []];
            const i = log.findIndex((x) => x.date === today);
            if (i >= 0)
              log[i] = {
                ...log[i],
                tokens: log[i].tokens + rvTokens,
                costUsd: Math.round((log[i].costUsd + rvCost) * 1e6) / 1e6
              };
            else log.push({ date: today, runs: 0, tokens: rvTokens, costUsd: rvCost });
            set({ settings: { ...st.settings, usageLog: log } });
            scheduleUsagePersist();
          } else {
            set({ liveStreamChars: 0 });
          }
          break;
        }
        case "todo":
          set({ todos: e.todos });
          break;
        case "goal_progress":
          set({ activeGoal: { goal: e.goal, pct: e.pct } });
          break;
        case "goal_done":
          set({ activeGoal: null });
          st.notify(
            (st.settings.language === "ar" ? "\u062A\u062D\u0642\u0651\u0642 \u0627\u0644\u0647\u062F\u0641: " : "Goal achieved: ") + e.goal
          );
          break;
        case "approval_request": {
          const pa = {
            requestId: e.requestId,
            kind: e.kind,
            title: e.title,
            detail: e.detail,
            toolName: e.payload?.toolName,
            // v11.10 — the command line rides along so decideApproval can
            // derive the per-tool "always" scope (founder complaint #1).
            command: typeof e.payload?.command === "string" ? e.payload.command : void 0,
            // v3.1 — ask_user questions carry choice buttons + free-text flag.
            choices: e.payload?.choices,
            allowText: e.payload?.allowText
          };
          set({ pendingApproval: pa });
          if (e.kind === "write" && e.payload && typeof e.payload.path === "string") {
            set({
              diffView: {
                title: e.title,
                path: e.payload.path,
                oldText: e.payload.oldText ?? "",
                newText: e.payload.newText ?? "",
                approvalRequestId: e.requestId
              }
            });
          }
          break;
        }
        case "plan_ready": {
          const raw = typeof e.plan === "string" ? e.plan : "";
          const lines = raw.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
          const steps = Array.isArray(e.steps) ? e.steps.filter((s) => typeof s === "string") : typeof e.steps === "string" ? [e.steps] : e.title ? lines : lines.slice(1);
          const planBody = raw.trim() || steps.join("\n");
          set({
            planProposal: {
              title: e.title ?? lines[0] ?? "Implementation plan",
              steps: steps.length > 0 ? steps : raw.trim() ? [raw.trim()] : [],
              risks: Array.isArray(e.risks) ? e.risks.filter((r) => typeof r === "string") : [],
              raw
            }
          });
          if (planBody) {
            closeStreamingAssistant(msgs);
            msgs.push({
              id: uid(),
              role: "assistant",
              kind: "text",
              content: planBody,
              model: "plan-note",
              timestamp: Date.now()
            });
          }
          break;
        }
        case "task_mode": {
          set({ taskMode: e.taskMode });
          break;
        }
        // ---------- v2.1 engine events (chat/control D2) ----------
        case "steer_injected": {
          closeStreamingAssistant(msgs);
          msgs.push({
            id: uid(),
            role: "user",
            kind: "text",
            content: e.text,
            model: "steer",
            timestamp: Date.now()
          });
          set({ steerPending: false });
          break;
        }
        case "doom_loop": {
          st.notify(
            st.settings.language === "ar" ? `\u062A\u0643\u0631\u0627\u0631 \u0623\u062F\u0627\u0629: ${e.tool} \xD7${e.count} \u2014 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0642\u0631\u0627\u0631\u0643` : `Repeating tool call: ${e.tool} \xD7${e.count} \u2014 awaiting your decision`
          );
          break;
        }
        // v11.27 — the `dna_note` tool writes dna.json and emits this EVENT but
        // never fires kdx:dna:event, so the UI stayed stale until restart. Reload
        // DNA here too — no transcript message, just a silent honest refresh.
        case "dna_updated": {
          void get().loadDna();
          break;
        }
        case "verify_run": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ cmd: e.cmd, exitCode: e.exitCode, outputTail: e.outputTail }),
            model: "verify",
            timestamp: Date.now()
          });
          break;
        }
        case "review_findings": {
          const findings = Array.isArray(e.findings) ? e.findings : [];
          set({ lastReview: { findings, summary: e.summary } });
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ findings, summary: e.summary }),
            model: "review-findings",
            timestamp: Date.now()
          });
          st.notify(
            (st.settings.language === "ar" ? "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629: " : "Review complete: ") + `${findings.length} ${st.settings.language === "ar" ? "\u0645\u0644\u0627\u062D\u0638\u0629" : "findings"}`
          );
          break;
        }
        case "skill_created": {
          st.notify(
            (st.settings.language === "ar" ? "\u062D\u064F\u0641\u0638\u062A \u0645\u0647\u0627\u0631\u0629 \u062C\u062F\u064A\u062F\u0629: " : "Skill saved: ") + e.name
          );
          void get().loadSkills();
          break;
        }
        case "goal_verified": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ goal: e.goal }),
            model: "goal-verified",
            timestamp: Date.now()
          });
          break;
        }
        case "critic_verdict": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ findings: e.findings, critical: e.critical, summary: e.summary }),
            model: "critic",
            timestamp: Date.now()
          });
          break;
        }
        case "run_receipt": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({
              files: e.files,
              commands: e.commands,
              rounds: e.rounds,
              verifyFailed: e.verifyFailed,
              durationMs: e.durationMs
            }),
            model: "receipt",
            timestamp: Date.now()
          });
          break;
        }
        case "task_report": {
          const report = reportSliceFromEvent(e, st.settings.language === "ar", runReport.errorKey ?? void 0);
          const incomplete = report.partial === true || report.outcome !== "completed" || typeof report.stopReason === "string" && report.stopReason.length > 0 && report.stopReason !== "completed";
          rrCommitInto(
            msgs,
            report,
            true,
            incomplete ? report.outcome === "error" || report.outcome === "aborted" ? "error" : "truncated" : void 0
          );
          set({ running: false, steerPending: false, ...clearedRunActivity() });
          rrFlushAutoPreview();
          break;
        }
        case "claim_audit": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ summary: e.summary, unsupported: e.unsupported, claims: e.claims }),
            model: "claim-audit",
            timestamp: Date.now()
          });
          break;
        }
        case "mutation_check": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ honest: e.honest, detail: e.detail }),
            model: "mutation-check",
            timestamp: Date.now()
          });
          break;
        }
        // ---------- v7.1 — Proven Change pipeline cards ----------
        case "proof_package": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ id: e.id, file: e.file, verdict: e.verdict, markdown: e.markdown }),
            model: "proof",
            timestamp: Date.now()
          });
          break;
        }
        case "mutation_gate": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ verdict: e.verdict, ran: e.ran, killed: e.killed, killRate: e.killRate, detail: e.detail }),
            model: "mutation-gate",
            timestamp: Date.now()
          });
          break;
        }
        case "red_green": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ compliant: e.compliant, reason: e.reason }),
            model: "red-green",
            timestamp: Date.now()
          });
          break;
        }
        case "fake_tests": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ scanned: e.scanned, high: e.high, summary: e.summary, findings: e.findings }),
            model: "fake-tests",
            timestamp: Date.now()
          });
          break;
        }
        // v11.27 — the founder demanded the TAINT UI row be removed with NO
        // trace. These two events no longer create any transcript message at
        // all; taint detection/escalation still works internally in electron/.
        case "taint_escalation":
        case "taint_notice":
          break;
        case "false_done": {
          set({ falseDoneStats: { claimed: e.claimed, falseDone: e.falseDone, rate: e.rate } });
          break;
        }
        case "budget_state": {
          set({ verificationBudgetLabel: e.label });
          break;
        }
        case "wiki_stage": {
          st.notify(
            (st.settings.language === "ar" ? "\u0627\u0644\u0648\u064A\u0643\u064A: " : "Wiki: ") + e.stage + (e.detail ? ` \xB7 ${e.detail}` : "")
          );
          break;
        }
        case "compaction": {
          msgs.push({
            id: uid(),
            role: "assistant",
            kind: "text",
            content: JSON.stringify({ before: e.before, after: e.after }),
            model: "compaction",
            timestamp: Date.now()
          });
          break;
        }
        case "playbook_learned": {
          const summary = String(e.summary ?? "").slice(0, 240);
          const version = Math.max(0, Math.floor(Number(e.version) || 0));
          set({ lastPlaybookLearning: { summary, version, ts: Date.now() } });
          void get().loadPlaybook();
          const ar = st.settings.language === "ar";
          pushToast({
            title: (ar ? "\u062A\u0639\u0644\u0651\u0645 \u0633\u0627\u062F\u0647\u064A\u0645: " : "SADEEM learned: ") + (summary || "new lessons saved to the playbook"),
            severity: "success",
            duration: 5600
          });
          break;
        }
        case "subagent_progress": {
          set((s) => ({
            subagentProgress: {
              ...s.subagentProgress,
              [e.id]: { label: e.label, done: e.done, total: e.total, step: e.step, pct: e.pct }
            },
            // Accumulate a live step timeline for the detail view. Dedupe the
            // identical (done,total) tail — progress events repeat at step edges.
            subagentSteps: {
              ...s.subagentSteps,
              [e.id]: (() => {
                const prev = s.subagentSteps[e.id] ?? [];
                const last = prev[prev.length - 1];
                if (last && last.done === e.done && last.total === e.total && last.step === e.step) return prev;
                const stamp = { at: Date.now(), done: e.done, total: e.total };
                return [...prev, { ...stamp, step: e.step, pct: e.pct }].slice(-60);
              })()
            },
            // v11.36 — when the engine carries a real tool call on the progress
            // tick, append it. No `toolCall` on the event ⇒ no row, no invention.
            subagentToolCalls: e.toolCall ? { ...s.subagentToolCalls, [e.id]: mergeSubagentToolCalls(s.subagentToolCalls[e.id], [e.toolCall]) } : s.subagentToolCalls
          }));
          const sid = `sys:subagent:${e.id}`;
          const payload = JSON.stringify({ id: e.id, label: e.label, done: e.done, total: e.total });
          const sidx = msgs.findIndex((m) => m.id === sid);
          if (sidx >= 0) msgs[sidx] = { ...msgs[sidx], content: payload, timestamp: Date.now() };
          else
            msgs.push({
              id: sid,
              role: "assistant",
              kind: "text",
              content: payload,
              model: "subagent",
              timestamp: Date.now()
            });
          break;
        }
        case "subagent_toolcall": {
          const call = e.call;
          set((s) => ({
            subagentToolCalls: {
              ...s.subagentToolCalls,
              [e.id]: mergeSubagentToolCalls(s.subagentToolCalls[e.id], [call])
            },
            subagents: s.subagents.map(
              (r) => r.id === e.id ? { ...r, toolCalls: mergeSubagentToolCalls(r.toolCalls, [call]) } : r
            )
          }));
          break;
        }
        case "queued_count": {
          const n = typeof e.n === "number" && Number.isFinite(e.n) && e.n >= 0 ? Math.floor(e.n) : st.queuedCount;
          const items = st.queuedItems;
          const next = n <= 0 ? [] : n < items.length ? items.slice(items.length - n) : items;
          set({ queuedCount: n, queuedItems: next });
          break;
        }
        case "compaction_done": {
          const summaryMsg = {
            id: uid(),
            role: "user",
            kind: "text",
            content: `[Compacted context]
${e.summary}`,
            timestamp: Date.now()
          };
          const merged = [summaryMsg, ...msgs.map((m) => m.streaming ? { ...m, streaming: false } : m)];
          const continuedTask = lastUserTask(msgs);
          set({
            session: { ...session, messages: merged },
            ...continuedTask ? { continueHint: { task: continuedTask, reason: "compacted" } } : {}
          });
          st.notify(st.settings.language === "ar" ? "\u062A\u0645 \u0636\u063A\u0637 \u0627\u0644\u0633\u064A\u0627\u0642 (\u0645\u062D\u0641\u0648\u0638 \u0628\u0627\u0644\u0643\u0627\u0645\u0644)" : "Context compacted (full history kept)");
          void get().persistSession();
          return;
        }
        case "error": {
          liveStreamChars = 0;
          set({ running: false, steerPending: false, ...clearedRunActivity() });
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last && last.streaming) msgs[lastIdx] = { ...last, streaming: false };
          const ar = st.settings.language === "ar";
          const rawMessage = typeof e.message === "string" ? e.message : "";
          const code = typeof e.code === "string" ? e.code : void 0;
          const msg = noCreditsToast(rawMessage, ar) ?? localizeRunError(rawMessage, ar, code);
          const key = runErrorKey(rawMessage, code);
          runReport.errorKey = key;
          const report = {
            outcome: "error",
            summary: msg,
            files: [],
            commands: [],
            nextSteps: [],
            ...code ? { stopReason: code } : { stopReason: "error" },
            partial: true,
            durationMs: 0,
            at: Date.now()
          };
          rrCommitInto(msgs, report, false, "error");
          break;
        }
        case "aborted":
          liveStreamChars = 0;
          set({ running: false, steerPending: false, ...clearedRunActivity() });
          if (!runReport.final) {
            rrCommitInto(msgs, rrSynthesize("aborted", st.settings.language === "ar"), true, "error");
            rrFlushAutoPreview();
          }
          break;
        case "preview_open": {
          const evWs = e.ws;
          if (!evWs || evWs === get().wsPath) {
            const hint = e.previewHint;
            const prev = get().previewAuto;
            const normDir = (p) => p ? p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : "";
            const sameAlready = !!get().previewOpen && !!prev && !!hint?.kind && prev.kind === hint.kind && normDir(prev.dir) === normDir(hint.dir) && (prev.runtime ?? "") === (hint.runtime ?? "");
            const hasVerifiedUrl = typeof e.url === "string" && /^https?:\/\//i.test(e.url);
            if (!previewUserClosed || hasVerifiedUrl) {
              set({
                previewOpen: true,
                previewWs: evWs || get().wsPath,
                ...e.url ? { previewUrl: e.url } : {},
                ...!sameAlready && (hint?.kind === "dev" || hint?.kind === "static" || hint?.kind === "artifact") ? {
                  previewAuto: {
                    seq: (prev?.seq ?? 0) + 1,
                    kind: hint.kind,
                    ...hint.dir ? { dir: hint.dir } : {},
                    ...hint.runtime ? { runtime: hint.runtime } : {},
                    ...hint.label ? { label: hint.label } : {},
                    ws: evWs || get().wsPath
                  }
                } : {}
              });
            }
          }
          void get().refreshPreviewStatus();
          break;
        }
        case "turn_end":
          set({ running: false, steerPending: false, ...clearedRunActivity() });
          if (!runReport.final) {
            if (!runReport.cardId) {
              const outcome = runReport.outcome;
              rrCommitInto(
                msgs,
                rrSynthesize(outcome, st.settings.language === "ar"),
                true,
                outcome === "completed" ? void 0 : "error"
              );
            } else {
              runReport.final = true;
              rrEmitReportToast(get().lastTaskReport, st.settings.language === "ar");
            }
          }
          rrFlushAutoPreview();
          void get().loadGit();
          runClosed = true;
          break;
        default:
          return;
      }
      if (e.type === "turn_end" || e.type === "aborted" || e.type === "error" || e.type === "task_report") {
        clearStreamingRows(msgs);
      }
      set({ session: { ...session, messages: msgs } });
      if (e.type === "turn_end") closedSession = get().session;
      if (e.type === "turn_end" || e.type === "error" || e.type === "aborted" || e.type === "task_report") {
        flushUsageLog();
        void get().persistSession();
      } else if (msgs.length % 4 === 0) void get().persistSession();
    } catch {
      try {
        flushPendingDelta();
      } catch {
      }
      if (e.type === "error" || e.type === "aborted" || e.type === "turn_end" || e.type === "task_report") {
        try {
          set({ running: false, steerPending: false, ...clearedRunActivity() });
        } catch {
        }
        if (e.type === "turn_end") {
          runClosed = true;
          closedSession = get().session;
        }
        try {
          if (!runReport.toastShown) {
            if (e.type === "error") runReport.outcome = "error";
            else if (e.type === "aborted") runReport.outcome = "aborted";
            else if (e.type === "task_report") {
              const o = e.outcome;
              runReport.outcome = o === "aborted" ? "aborted" : o === "error" ? "error" : "completed";
            }
            const ar = get().settings.language === "ar";
            rrEmitReportToast(rrSynthesize(runReport.outcome, ar), ar);
            runReport.final = true;
          }
        } catch {
        }
      }
    }
  },
  decideApproval: async (action, value) => {
    const pa = get().pendingApproval;
    if (!pa) return;
    const ar = get().settings.language === "ar";
    try {
      if (pa.kind === "mcp_elicitation") {
        const elAction = action === "deny" || action === "never" || action === "never_always" ? "decline" : action === "answer" && !(value ?? "").trim() ? "cancel" : "accept";
        await api.mcpElicitDecision(
          pa.requestId,
          elAction,
          action === "answer" && (value ?? "").trim() ? { text: (value ?? "").trim() } : void 0
        );
      } else {
        const scope = value != null && String(value).trim() ? String(value).trim() : (action === "always" || action === "always_session" || action === "always_project") && pa.kind === "command" ? deriveToolScope(pa.command ?? firstCommandLike(pa.detail)) : void 0;
        await api.agentApproval({
          requestId: pa.requestId,
          action,
          ...scope ? { value: scope } : {}
        });
      }
    } catch {
      get().notify(
        ar ? "\u062A\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0642\u0631\u0627\u0631 \u2014 \u0623\u064F\u063A\u0644\u0642\u062A \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0645\u062D\u0644\u064A\u0627\u064B." : "Could not send the decision \u2014 the card was closed locally."
      );
    } finally {
      set({
        pendingApproval: null,
        diffView: get().diffView?.approvalRequestId === pa.requestId ? null : get().diffView
      });
    }
  },
  // ---------------- v2.1 engine actions (chat/control D2) ----------------
  setTaskMode: (m) => {
    set({ taskMode: m });
    const sid = get().session?.id;
    try {
      const ar = get().settings.language === "ar";
      const notices = {
        build: [
          "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0628\u0646\u0627\u0621 \u2014 \u0639\u0627\u062F\u062A \u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0648\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0648\u062D\u0644\u0642\u0629 \u0627\u0644\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0643\u0627\u0645\u0644\u0629 \u0625\u0644\u0649 \u0627\u0644\u0639\u0645\u0644.",
          "Switched to BUILD mode \u2014 execution posture restored."
        ],
        plan: [
          "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u062E\u0637\u0629 \u2014 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637: \u0623\u0628\u062D\u062B \u0648\u0623\u0646\u0647\u064A \u0628\u0643\u0627\u0631\u062A \u062E\u0637\u0629\u060C \u0648\u0627\u0644\u0643\u062A\u0627\u0628\u0629 \u0648\u0627\u0644\u0623\u0648\u0627\u0645\u0631 \u0645\u0645\u0646\u0648\u0639\u0629 \u062D\u062A\u0649 \u062A\u0646\u062A\u0642\u0644 \u0625\u0644\u0649 \u0627\u0644\u0628\u0646\u0627\u0621.",
          "Switched to PLAN mode \u2014 read-only: produce the step-by-step plan (plan.md + propose_plan); edits/commands are denied (persists for this session)."
        ],
        debug: [
          "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0641\u062D\u0635 \u2014 \u0641\u0631\u0636\u064A\u0629 \u062B\u0645 \u0627\u062E\u062A\u0628\u0627\u0631 \u062B\u0645 \u0625\u0635\u0644\u0627\u062D\u060C \u0648\u0627\u0644\u0645\u062D\u0631\u0643 \u064A\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u0625\u0635\u0644\u0627\u062D \u0628\u0646\u0641\u0633\u0647 \u0648\u064A\u064F\u0638\u0647\u0631 \u062A\u0642\u0631\u064A\u0631 \u0641\u062D\u0635.",
          "Switched to DEBUG mode \u2014 hypothesis \u2192 test discipline with an engine-run verification loop."
        ],
        review: [
          "\u062A\u0645 \u0627\u0644\u062A\u0628\u062F\u064A\u0644 \u0625\u0644\u0649 \u0648\u0636\u0639 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u2014 \u0642\u0631\u0627\u0621\u0629 \u0641\u0642\u0637\u060C \u0648\u062A\u0646\u062A\u0647\u064A \u0627\u0644\u0645\u0647\u0645\u0629 \u0628\u0643\u0627\u0631\u062A \u0646\u062A\u0627\u0626\u062C \u0645\u0646\u0638\u0645 \u064A\u064F\u062D\u0641\u0638 \u0641\u064A \u0645\u062C\u0644\u062F \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0627\u062A.",
          "Switched to REVIEW mode \u2014 read-only review posture ending with a structured findings card."
        ]
      };
      const pair = notices[m] ?? ["", ""];
      const text = ar ? pair[0] : pair[1];
      const session = get().session;
      if (session && text) {
        const msgs = [...session.messages];
        msgs.push({
          id: `mode-${m}-${Date.now()}`,
          role: "assistant",
          kind: "notice",
          noticeKind: "mode",
          content: text,
          timestamp: Date.now()
        });
        set({ session: { ...session, messages: msgs } });
      }
    } catch {
    }
    if (!sid) return;
    api.agentTaskMode(sid, m).catch(() => {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u063A\u064A\u064A\u0631 \u0648\u0636\u0639 \u0627\u0644\u0645\u0647\u0645\u0629" : "Task mode change failed");
    });
  },
  approvePlan: async (choice, feedback) => {
    const ar = get().settings.language === "ar";
    const sid = get().session?.id;
    set({ planProposal: null });
    try {
      if (sid) await api.agentPlanApprove(sid, choice, feedback);
    } catch {
      const note = choice === "auto" ? ar ? "\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0637\u0629. \u0646\u0641\u0651\u0630\u0647\u0627 \u062E\u0637\u0648\u0629 \u0628\u062E\u0637\u0648\u0629 \u0645\u0639 \u0627\u0644\u062A\u062D\u0642\u0642 \u0623\u0648\u0644\u0627\u064B \u0628\u0623\u0648\u0644." : "Plan approved. Implement it step by step, verifying with tests/builds as you go." : choice === "manual" ? ar ? "\u062A\u0645\u062A \u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0637\u0629 \u2014 \u0627\u0633\u0623\u0644 \u0642\u0628\u0644 \u0643\u0644 \u062E\u0637\u0648\u0629." : "Plan approved \u2014 ask before each step." : ar ? `\u0631\u0627\u062C\u0639 \u0627\u0644\u062E\u0637\u0629: ${feedback ?? ""}` : `Revise the plan: ${feedback ?? ""}`;
      if (choice === "auto") get().setMode("autoEdit");
      void get().sendMessage(note);
    }
  },
  sendSteer: async (text) => {
    const v = text.trim();
    const sid = get().session?.id;
    if (!v || !sid || !get().running) return;
    try {
      await api.agentSteer(sid, v);
      set({ steerPending: true });
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u062A\u0648\u062C\u064A\u0647" : "Steer failed");
    }
  },
  runReview: async () => {
    const sid = get().session?.id;
    const ar = get().settings.language === "ar";
    if (!sid) {
      get().notify(ar ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u062C\u0644\u0633\u0629 \u0646\u0634\u0637\u0629" : "No active session");
      return;
    }
    try {
      const res = await api.agentReviewRun(sid);
      const findings = res?.findings ?? [];
      set({ lastReview: { findings, summary: res?.summary } });
      get().notify(
        findings.length === 0 ? ar ? "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u2014 \u0644\u0627 \u0645\u0644\u0627\u062D\u0638\u0627\u062A" : "Review complete \u2014 clean" : (ar ? "\u0627\u0643\u062A\u0645\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629: " : "Review complete: ") + `${findings.length} findings`
      );
    } catch {
      get().notify(ar ? "\u0641\u0634\u0644\u062A \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629" : "Review failed");
    }
  },
  exportRecap: async () => {
    const sid = get().session?.id;
    const s = get().session;
    const ar = get().settings.language === "ar";
    if (!sid || !s) return;
    try {
      const res = await api.agentRecap(sid);
      const md = res?.markdown;
      if (!md) {
        get().notify(ar ? "\u0644\u0627 \u064A\u0648\u062C\u062F \u0645\u0644\u062E\u0635 \u0628\u0639\u062F \u2014 \u0634\u063A\u0651\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0623\u0648\u0644\u0627\u064B" : "No recap yet \u2014 run the agent first");
        return;
      }
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(s.title || "recap").replace(/[^\w\u0600-\u06FF-]+/g, "-").slice(0, 48)}-recap.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      get().notify(ar ? "\u062A\u0645 \u062A\u0646\u0632\u064A\u0644 \u0627\u0644\u0645\u0644\u062E\u0635 (Markdown)" : "Recap downloaded (Markdown)");
    } catch {
      get().notify(ar ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0645\u0644\u062E\u0635" : "Recap failed");
    }
  },
  loadSkills: async () => {
    const ws = get().wsPath;
    if (!ws) {
      set({ skills: [] });
      return;
    }
    try {
      const list = await api.skillsList(ws);
      set({ skills: list || [] });
    } catch {
    }
  },
  deleteSkill: async (slug) => {
    const ws = get().wsPath;
    if (!ws) return;
    try {
      await api.skillDelete(ws, slug);
      await get().loadSkills();
      get().notify(get().settings.language === "ar" ? "\u062D\u064F\u0630\u0641\u062A \u0627\u0644\u0645\u0647\u0627\u0631\u0629" : "Skill deleted");
    } catch {
      get().notify(get().settings.language === "ar" ? "\u062A\u0639\u0630\u0651\u0631 \u062D\u0630\u0641 \u0627\u0644\u0645\u0647\u0627\u0631\u0629" : "Could not delete skill");
    }
  },
  setSkillsOpen: (o) => {
    set({ skillsOpen: o });
    if (o) void get().loadSkills();
  },
  dismissQueued: (index) => {
    const items = [...get().queuedItems];
    items.splice(index, 1);
    set({ queuedItems: items, queuedCount: Math.max(0, get().queuedCount - 1) });
  },
  clearReview: () => set({ lastReview: null }),
  setCtxWindow: (n) => set({ ctxWindow: n }),
  setCtxWindowEstimated: (v) => set({ ctxWindowEstimated: v }),
  // ---------------- v2.2 DNA (the closed learning loop) ----------------
  loadDna: async () => {
    const now = Date.now();
    if (now - dnaLastLoad < 500) {
      if (dnaReloadTimer) clearTimeout(dnaReloadTimer);
      dnaReloadTimer = setTimeout(() => {
        dnaReloadTimer = null;
        dnaLastLoad = 0;
        void get().loadDna();
      }, 500);
      return;
    }
    dnaLastLoad = now;
    if (typeof api.dnaGet !== "function") return;
    set({ dnaLoading: true });
    const ws = get().wsPath || void 0;
    try {
      const [dna, stats] = await Promise.all([
        api.dnaGet(ws).catch(() => null),
        typeof api.dnaStats === "function" ? api.dnaStats(ws).catch(() => null) : Promise.resolve(null)
      ]);
      set({ dna: dna ?? null, dnaStats: stats ?? null, dnaLoading: false });
    } catch {
      set({ dnaLoading: false });
    }
  },
  clearDnaSuggestion: () => {
    const sug = get().dnaSuggestion;
    set({ dnaSuggestion: null });
    if (sug?.patternId && typeof api.dnaDismissSuggestion === "function") {
      api.dnaDismissSuggestion(sug.patternId).catch(() => void 0);
    }
  },
  // ---------------- v11.12 Living Playbook + Subagent dashboard ----------------
  loadPlaybook: async () => {
    if (typeof api.playbookGet !== "function") return;
    const ws = get().wsPath || void 0;
    set({ playbookLoading: true });
    try {
      const [data, history] = await Promise.all([
        api.playbookGet(ws).catch(() => null),
        typeof api.playbookHistory === "function" ? api.playbookHistory(ws).catch(() => []) : Promise.resolve([])
      ]);
      set({ playbook: data ?? null, playbookHistory: history ?? [], playbookLoading: false });
    } catch {
      set({ playbookLoading: false });
    }
  },
  clearPlaybook: async () => {
    const ar = get().settings.language === "ar";
    if (!window.confirm(ar ? "\u062D\u0630\u0641 \u062F\u0644\u064A\u0644 \u0627\u0644\u062A\u0639\u0644\u0645 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0634\u0631\u0648\u0639\u061F" : "Delete this workspace's learning playbook?")) return;
    try {
      await api.playbookClear?.(get().wsPath || void 0);
      set({ playbook: null, playbookHistory: [], lastPlaybookLearning: null });
      get().notify(ar ? "\u062A\u0645 \u062D\u0630\u0641 \u062F\u0644\u064A\u0644 \u0627\u0644\u062A\u0639\u0644\u0651\u0645" : "Learning playbook cleared");
    } catch {
    }
  },
  loadSubagents: async () => {
    if (typeof api.subagentsList !== "function") return;
    set({ subagentsLoading: true });
    try {
      const rows = await api.subagentsList(get().wsPath || void 0).catch(() => []) ?? [];
      set((s) => {
        const out = { ...s.subagentToolCalls };
        for (const r of rows) out[r.id] = mergeSubagentToolCalls(out[r.id], r.toolCalls ?? []);
        return { subagents: rows, subagentsLoading: false, subagentToolCalls: out };
      });
    } catch {
      set({ subagentsLoading: false });
    }
  },
  retrySubagent: async (id) => {
    const ar = get().settings.language === "ar";
    try {
      const res = await api.subagentsRetry?.(id);
      if (!res?.ok) {
        get().notify(res?.error === "NOT_FOUND" ? ar ? "\u0648\u0643\u064A\u0644 \u0641\u0631\u0639\u064A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" : "Subagent not found" : ar ? "\u062A\u0639\u0630\u0651\u0631\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644" : "Retry failed");
        return;
      }
      void get().loadSubagents();
      get().notify(ar ? "\u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u062A\u0634\u063A\u064A\u0644 \u0627\u0644\u0648\u0643\u064A\u0644 \u0627\u0644\u0641\u0631\u0639\u064A\u2026" : "Re-running the subagent\u2026");
    } catch {
      get().notify(ar ? "\u062A\u0639\u0630\u0651\u0631\u062A \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u062A\u0634\u063A\u064A\u0644" : "Retry failed");
    }
  },
  clearSubagents: async () => {
    try {
      await api.subagentsClear?.();
      set({ subagents: [], subagentSteps: {}, subagentToolCalls: {}, subagentDetailId: null });
    } catch {
    }
  },
  openSubagentDetail: (id) => {
    if (!id) return;
    const rec = get().subagents.find((r) => r.id === id);
    set((s) => ({
      subagentDetailId: id,
      ...rec && !s.subagentSteps[id] ? { subagentSteps: { ...s.subagentSteps, [id]: [{ at: rec.startedAt, done: rec.done, total: rec.total }] } } : {}
    }));
  },
  closeSubagentDetail: () => set({ subagentDetailId: null }),
  // ---------------- v2.4 flows ----------------
  setFlowSuggest: (s) => set({ flowSuggest: s }),
  dismissFlowSuggest: () => set({ flowSuggest: null }),
  // ---------------- v6 artifact comments ----------------
  addArtifactComment: (text) => {
    const t = text.trim().slice(0, 500);
    if (!t) return;
    set({ artifactComments: [...get().artifactComments, t] });
  },
  removeArtifactComment: (index) => {
    set({ artifactComments: get().artifactComments.filter((_, i) => i !== index) });
  },
  clearArtifactComments: () => set({ artifactComments: [] }),
  trustWorkspaceSkills: async () => {
    const ws = get().wsPath;
    set({ skillsTrustNeeded: false });
    if (!ws || typeof api.skillsTrust !== "function") return;
    try {
      await api.skillsTrust(ws);
      const ar = get().settings.language === "ar";
      get().notify(ar ? "\u0648\u064F\u062B\u0642\u062A \u0645\u0647\u0627\u0631\u0627\u062A \u0645\u0633\u0627\u062D\u0629 \u0627\u0644\u0639\u0645\u0644" : "Workspace skills trusted");
      void get().loadSkills();
    } catch {
    }
  },
  setChatWidth: (w) => {
    const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(w)));
    set({ chatWidth: next });
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(next));
    } catch {
    }
  },
  abortAgent: async () => {
    try {
      await api.agentAbort();
    } catch {
      const ar = get().settings.language === "ar";
      get().notify(
        ar ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0625\u064A\u0642\u0627\u0641 \u0645\u0646 \u0627\u0644\u0645\u062D\u0631\u0643 \u2014 \u0623\u064F\u0648\u0642\u0641\u062A \u0627\u0644\u0648\u0627\u062C\u0647\u0629 \u0645\u062D\u0644\u064A\u0627\u064B." : "The engine did not confirm the stop \u2014 the UI was stopped locally."
      );
    } finally {
      stopRunWatchdog();
      clearResumeMarker();
      liveStreamChars = 0;
      runClosed = true;
      closedSession = get().session;
      runFailed = false;
      runAborted = true;
      set({
        running: false,
        steerPending: false,
        runRecovery: null,
        resumableRun: null,
        liveStreamChars: 0,
        ...clearedRunActivity()
      });
      if (!runReport.toastShown) {
        const ar = get().settings.language === "ar";
        rrPublish(rrSynthesize("aborted", ar), ar, true);
      }
    }
  },
  setModel: (provider, model) => get().updateSettings({ model: { provider, model } }),
  refreshLicense: async () => {
    try {
      const license = await api.licenseGet();
      set({ license: license || { plan: "free", mode: "local" } });
    } catch {
    }
  },
  // ---------------- terminal ----------------
  toggleTerminal: async () => {
    const open = !get().terminalOpen;
    set({ terminalOpen: open });
    if (open) await ensureTerminalSession();
  },
  setTermHeight: (h) => set({ termHeight: Math.max(120, Math.min(600, h)) }),
  // ---------------- live preview ----------------
  setPreviewOpen: (o) => {
    previewUserClosed = !o;
    set({ previewOpen: o });
    if (!o) return;
    if (!get().wsPath) set({ previewError: { reason: "noWorkspace" } });
    void get().refreshPreviewStatus();
  },
  togglePreview: () => get().setPreviewOpen(!get().previewOpen),
  navigatePreview: (url) => {
    const clean = url.trim();
    if (!clean) return;
    const normalized = /^https?:\/\//i.test(clean) ? clean : clean.startsWith("localhost") || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(clean) ? `http://${clean}` : clean;
    set({ previewUrl: normalized, previewSource: "user", previewError: null });
  },
  refreshPreviewStatus: async () => {
    try {
      const rawStatus = await api.previewStatus();
      const st = rawStatus ? {
        ...rawStatus,
        dev: {
          ...rawStatus.dev,
          lines: (Array.isArray(rawStatus.dev?.lines) ? rawStatus.dev.lines : []).slice(-4).map(sanitizeLogLine).filter(Boolean)
        }
      } : rawStatus;
      set({ previewStatus: st });
      const ws = get().wsPath;
      const ownedWs = get().previewWs;
      const stale = !!get().previewUrl && ownedWs !== ws;
      const src = get().previewSource;
      const devFollow = st.dev?.running && st.dev.url && ownedWs === ws && (src === "" || src === "dev");
      if (!get().previewUrl || stale || devFollow && get().previewUrl !== st.dev.url) {
        const norm = (p) => p ? p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : "";
        const nws = norm(ws);
        const agentMatch = (st.dev.agentSources ?? []).find((s) => {
          const cwd = norm(s.cwd);
          return !!nws && (cwd === nws || cwd.startsWith(nws + "/") || nws.startsWith(cwd + "/"));
        });
        const url = devFollow ? st.dev.url : st.static.url ?? st.dev.url ?? agentMatch?.url;
        if (url) {
          set({ previewUrl: url, previewWs: ws, ...devFollow ? { previewSource: "dev" } : {} });
        } else if (stale) set({ previewUrl: "", previewWs: "" });
      }
    } catch {
    }
  },
  // v11.23 (C6/P0) — PREVIEW FAILURES HAVE EXACTLY ONE SURFACE: the localized
  // error card inside the preview panel. FIXED raw-EN / raw-payload toasts:
  //   get().notify('Open a workspace first')   → localized card (noWorkspace)
  //   get().notify(res.error ?? 'Preview failed') / get().notify(detail)
  //                                            → removed; no raw bridge text,
  //   no second wording, no JSON in a toast. Historical anchors above are kept
  //   only for the v1123 error-audit inventory (v1123-error-audit.test.mjs).
  startStaticPreview: async (dir) => {
    const target = dir || get().wsPath;
    if (!target) {
      set({ previewOpen: true, previewError: { reason: "noWorkspace" } });
      return;
    }
    try {
      const res = await api.previewStaticStart(target);
      if (res.ok && res.url) {
        set({ previewOpen: true, previewUrl: res.url, previewWs: get().wsPath, previewSource: "static", previewError: null });
        void get().refreshPreviewStatus();
      } else {
        set({
          previewOpen: true,
          previewError: { reason: "startFailed", detail: localizePreviewError(res.error, get().settings.language === "ar") }
        });
      }
    } catch (err) {
      set({
        previewOpen: true,
        previewError: { reason: "startFailed", detail: localizePreviewError(err, get().settings.language === "ar") }
      });
    }
  },
  startDevPreview: async (runtime) => {
    const ws = get().wsPath;
    if (!ws) {
      set({ previewOpen: true, previewError: { reason: "noWorkspace" } });
      return;
    }
    set({ previewOpen: true, previewWs: get().wsPath, previewError: null });
    try {
      const res = await api.previewDevStart(ws, runtime ?? "npm");
      if (res.ok) {
        set({ previewSource: "dev" });
        void get().refreshPreviewStatus();
      } else {
        set({
          previewError: {
            reason: mapDevStartError(res.error),
            detail: localizePreviewError(res.error, get().settings.language === "ar")
          }
        });
      }
    } catch (err) {
      set({
        previewError: { reason: "startFailed", detail: localizePreviewError(err, get().settings.language === "ar") }
      });
    }
  },
  stopDevPreview: async () => {
    try {
      await api.previewDevStop();
    } finally {
      void get().refreshPreviewStatus();
    }
  },
  dismissPreviewError: () => set({ previewError: null }),
  // ---------------- git ----------------
  loadGit: async () => {
    const { wsPath } = get();
    if (!wsPath) return set({ git: null });
    try {
      const st = await api.gitStatus(wsPath);
      set({ git: st });
    } catch {
      set({ git: null });
    }
  },
  gitStage: async (paths) => {
    if (!paths.length) return;
    await api.gitStage(get().wsPath, paths);
    await get().loadGit();
  },
  gitCommit: async (message) => {
    const hash = await api.gitCommit(get().wsPath, message);
    await get().loadGit();
    return hash;
  },
  // ---------------- ui ----------------
  setRail: (v) => set({ rail: v, sidebarOpen: get().rail === v ? !get().sidebarOpen : true }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  // v7.2 — focus mode toggle (persisted to localStorage so a reload keeps it)
  setFocusMode: (on) => {
    set({ focusMode: on });
    try {
      localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
    } catch {
    }
  },
  setPalette: (o) => set({ paletteOpen: o }),
  setModelPicker: (o) => set({ modelPickerOpen: o }),
  clearPlan: () => set({ planProposal: null }),
  setSettings: (o, section) => set({ settingsOpen: o, ...section ? { settingsSection: section } : {} }),
  setPlans: (o) => set({ plansOpen: o }),
  setShortcuts: (o) => set({ shortcutsOpen: o }),
  setDiffView: (d) => set({ diffView: d }),
  // ---------------- A1 slash: /rewind checkpoint chooser ----------------
  setRewindPicker: (cps) => set({ rewindPicker: cps }),
  openRewindPicker: async () => {
    const st = get();
    if (!st.wsPath) {
      st.notify(st.settings.language === "ar" ? "\u0627\u0641\u062A\u062D \u0645\u062C\u0644\u062F\u0627\u064B \u0623\u0648\u0644\u0627\u064B" : "Open a folder first");
      return;
    }
    const ar = st.settings.language === "ar";
    try {
      const cps = await api.cpList(st.wsPath);
      if (!cps.length) {
        st.notify(ar ? "\u0644\u0627 \u062A\u0648\u062C\u062F \u0646\u0642\u0627\u0637 \u062A\u062D\u0642\u0642 \u0628\u0639\u062F" : "No checkpoints yet \u2014 they are created before edits");
        return;
      }
      set({ rewindPicker: cps });
    } catch {
      st.notify(ar ? "\u062A\u0639\u0630\u0651\u0631 \u062A\u062D\u0645\u064A\u0644 \u0646\u0642\u0627\u0637 \u0627\u0644\u062A\u062D\u0642\u0642" : "Could not load checkpoints");
    }
  },
  restoreCheckpoint: async (id) => {
    const st = get();
    const tt = slashT(st.settings.language === "ar");
    const target = (st.rewindPicker ?? []).find((c) => c.id === id);
    set({ rewindPicker: null });
    if (!st.wsPath || !target) return;
    try {
      await api.cpRestore(st.wsPath, target.id);
      void get().refreshTree();
      void get().loadGit();
      const line = tt("slash.rewind.restored", "Checkpoint restored: {label}", { label: target.label });
      get().notify("\u23EA " + line);
      appendAssistantRow(get, "\u23EA " + line);
    } catch {
      get().notify(tt("slash.rewind.failed", "Restore failed"));
    }
  },
  // ---------------- v11.12 CHAT CAPABILITIES ----------------
  switchModel: async (arg) => {
    const s = get();
    const tt = slashT(s.settings.language === "ar");
    const query = String(arg ?? "").trim();
    if (!query) {
      set({ modelPickerOpen: true });
      get().notify(tt("slash.model.hint", "Open the model picker, or type /model followed by a model name."));
      return;
    }
    const hit = resolveModelRef(s.settings, query);
    if (!hit) {
      get().notify(tt("slash.model.notFound", 'No installed model matches "{q}".', { q: query }));
      return;
    }
    get().setModel(hit.provider, hit.model);
    const cur = get().session;
    if (cur) {
      set({ session: { ...cur, model: `${hit.provider}/${hit.model}` } });
      void get().persistSession();
    }
    const line = tt("slash.model.switched", "Model switched to {provider}/{model} \u2014 the next run uses it.", hit);
    appendAssistantRow(get, line, "system-status");
    get().notify(line);
  },
  switchToolProfile: async (profile) => {
    const s = get();
    const tt = slashT(s.settings.language === "ar");
    const p = String(profile ?? "").trim().toLowerCase();
    const allowed = ["essential", "balanced", "full"];
    const current = s.settings.agent?.toolProfile ?? "balanced";
    if (!p) {
      appendAssistantRow(get, tt("slash.profile.current", "Tool profile: {p} \u2014 choose essential, balanced or full.", { p: current }), "system-status");
      return;
    }
    if (!allowed.includes(p)) {
      get().notify(tt("slash.profile.bad", 'Unknown tool profile "{p}" \u2014 use essential, balanced or full.', { p }));
      return;
    }
    if (p === current) {
      appendAssistantRow(get, tt("slash.profile.same", "Tool profile is already {p}.", { p }), "system-status");
      return;
    }
    get().updateSettings({ agent: { ...s.settings.agent ?? {}, toolProfile: p } });
    const line = tt("slash.profile.switched", "Tool profile set to {p} \u2014 the next run advertises the matching tool set.", { p });
    appendAssistantRow(get, line, "system-status");
    get().notify(line);
  },
  undoLastCheckpoint: async () => {
    const s = get();
    const tt = slashT(s.settings.language === "ar");
    if (!s.wsPath) {
      s.notify(tt("slash.undo.noWorkspace", "Open a folder first"));
      return;
    }
    if (typeof api.cpList !== "function" || typeof api.cpRestore !== "function") {
      s.notify(tt("slash.undo.bridge", "Checkpoint restore is unavailable in this build."));
      return;
    }
    let cps;
    try {
      cps = await api.cpList(s.wsPath);
    } catch {
      s.notify(tt("slash.undo.failedList", "Could not list checkpoints"));
      return;
    }
    if (!Array.isArray(cps) || cps.length === 0) {
      appendAssistantRow(get, tt("slash.undo.empty", "No checkpoints to undo \u2014 they are created before edits."), "system-status");
      return;
    }
    const cp = cps[0];
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(tt("slash.undo.confirm", 'Restore checkpoint "{label}"? Files go back; the conversation stays.', { label: cp.label }))) {
      return;
    }
    appendAssistantRow(
      get,
      tt("slash.undo.restoring", 'Undo \u2014 restoring "{label}" ({n} files)\u2026', { label: cp.label, n: cp.fileCount }),
      "system-status"
    );
    try {
      await api.cpRestore(s.wsPath, cp.id);
      void get().refreshTree();
      void get().loadGit();
      const line = tt("slash.undo.done", 'Undo complete \u2014 restored "{label}". The conversation is unchanged.', { label: cp.label });
      appendAssistantRow(get, "\u23EA " + line, "system-status");
      get().notify("\u23EA " + line);
    } catch {
      get().notify(tt("slash.undo.restoreFailed", "Could not restore the checkpoint"));
    }
  },
  continueTask: async () => {
    const s = get();
    const tt = slashT(s.settings.language === "ar");
    if (!s.session) {
      s.notify(tt("slash.continue.noSession", "Open a session first"));
      return;
    }
    if (s.running) {
      s.notify(tt("slash.continue.busy", "The agent is busy \u2014 wait for the current run"));
      return;
    }
    const task = s.continueHint?.task || lastUserTask(s.session.messages);
    if (!task) {
      s.notify(tt("slash.continue.noTask", "No previous task to continue"));
      return;
    }
    const ar = s.settings.language === "ar";
    const instruction = ar ? "[\u0645\u062A\u0627\u0628\u0639\u0629] \u0623\u0643\u0645\u0644 \u0627\u0644\u0645\u0647\u0645\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629 \u0645\u0646 \u062D\u064A\u062B \u062A\u0648\u0642\u0641\u062A \u2014 \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u0646\u062C\u0632 \u0645\u062D\u0641\u0648\u0638\u060C \u0644\u0627 \u062A\u064F\u0639\u062F \u0645\u0627 \u062A\u0645. \u0623\u0646\u0650\u0647\u0650 \u0627\u0644\u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0645\u062A\u0628\u0642\u064A\u0629 \u0648\u062A\u062D\u0642\u0642 \u0645\u0646\u0647\u0627." : "[CONTINUE] Continue the previous task from where it stopped \u2014 completed work is saved, do not redo it. Finish the remaining steps and verify them.";
    set({ continueHint: null });
    await get().sendMessage(`${instruction}

${task}`);
  },
  // ---------------- v11.13 — REAL composer capabilities ----------------
  showCapabilityPanel: (panel) => set({ capabilityPanel: { ...panel, seq: (get().capabilityPanel?.seq ?? 0) + 1, at: Date.now() } }),
  dismissCapabilityPanel: () => set({ capabilityPanel: null }),
  showDiff: async (arg) => {
    const s = get();
    const ar = s.settings.language === "ar";
    const tt = slashT(ar);
    if (!s.wsPath) return s.notify(tt("slash.test.noWorkspace", "Open a folder first."));
    if (typeof api.gitStatus !== "function" || typeof api.gitDiff !== "function") {
      return s.notify(tt("slash.diff.bridge", "The git diff bridge is unavailable in this build."));
    }
    let isRepo = false;
    try {
      const st = await api.gitStatus(s.wsPath);
      isRepo = !!st && st.isRepo === true;
    } catch {
    }
    if (!isRepo) {
      s.notify(tt("slash.diff.noRepo", "No git repository is open in this workspace."));
      return;
    }
    const target = String(arg ?? "").trim().replace(/^["']|["']$/g, "");
    try {
      const diffs = await api.gitDiff(s.wsPath, target || void 0);
      const withPatch = diffs.filter((d) => d?.patch?.trim());
      if (withPatch.length === 0) {
        const clean = tt("slash.diff.clean", "No uncommitted changes \u2014 the working tree is clean.");
        appendAssistantRow(get, clean, "system-status");
        s.notify(clean);
        return;
      }
      const patch = withPatch.map((d) => d.patch).join("\n");
      const title = target ? tt("slash.diff.title", "Unified diff for {path}", { path: target }) : tt("slash.diff.allTitle", "Unified diff \u2014 uncommitted changes");
      appendAssistantRow(get, `${title}
\`\`\`diff
${clipMd(patch, 8e3)}
\`\`\``, "system-status");
      get().showCapabilityPanel({ title, kind: "diff", text: patch });
      set({
        diffView: {
          title: `${tt("slash.diff.title", "Unified diff for {path}", { path: target || "(working tree)" })} \xB7 ${withPatch.length}`,
          path: target,
          oldText: "",
          newText: "",
          patch
        }
      });
      s.notify(
        tt("slash.diff.summary", "Unified diff: {n} file(s), {lines} lines \u2014 shown in the output panel.", {
          n: withPatch.length,
          lines: patch.split("\n").length
        })
      );
    } catch {
      s.notify(tt("slash.diff.failed", "Could not read the git diff."));
    }
  },
  runTests: async (arg) => {
    const s = get();
    const ar = s.settings.language === "ar";
    const tt = slashT(ar);
    if (!s.wsPath) return s.notify(tt("slash.test.noWorkspace", "Open a folder first."));
    if (typeof api.cmdRun !== "function") {
      return s.notify(tt("slash.test.bridge", "The command runner is unavailable in this build."));
    }
    let cmd = String(arg ?? "").trim();
    if (!cmd) {
      let pkg = "";
      try {
        pkg = await api.readFile(wsJoin(s.wsPath, "package.json"));
      } catch {
      }
      cmd = detectTestCommand(pkg);
      if (!cmd && hasPythonTests(s.fileTree)) cmd = "python -m pytest -q";
    }
    if (!cmd) {
      const none = tt("slash.test.noScript", "No test command found \u2014 add a test script to package.json or pass one after /test");
      appendAssistantRow(get, none, "system-status");
      s.notify(none);
      return;
    }
    appendAssistantRow(get, tt("slash.test.running", "Running test command: {cmd}", { cmd }), "system-status");
    let res;
    try {
      res = await api.cmdRun(cmd, s.wsPath, 12e4);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const line = tt("slash.test.error", "Could not run the test command: {error}", { error });
      appendAssistantRow(get, line, "error");
      s.notify(line);
      return;
    }
    const body = [
      `$ ${res.cmd}`,
      res.stdout?.trim() || "",
      res.stderr?.trim() ? `[stderr]
${res.stderr.trim()}` : ""
    ].filter(Boolean).join("\n");
    const verdict = res.timedOut ? tt("slash.test.timeout", "TIMEOUT \u2014 the test command exceeded its deadline.") : res.ok ? tt("slash.test.pass", "PASS \u2014 exit code 0 in {ms} ms.", { ms: res.ms }) : tt("slash.test.fail", "FAIL \u2014 exit code {code} in {ms} ms.", { code: res.code ?? "?", ms: res.ms });
    appendAssistantRow(get, `${verdict}
\`\`\`
${clipMd(body, 8e3)}
\`\`\``, res.ok ? "system-status" : "error");
    get().showCapabilityPanel({ title: cmd, kind: "test", text: `${verdict}

${body}` });
    s.notify(verdict);
  },
  explainFile: async (arg) => {
    const s = get();
    const ar = s.settings.language === "ar";
    const tt = slashT(ar);
    const target = resolveExplainPath(s.wsPath ?? "", String(arg ?? ""));
    if (!target) return s.notify(tt("slash.explain.usage", "Usage: /explain <path>"));
    if (typeof api.readFile !== "function" || typeof api.aiComplete !== "function") {
      return s.notify(tt("slash.explain.bridge", "File reading or one-shot completion is unavailable in this build."));
    }
    appendAssistantRow(get, tt("slash.explain.reading", "Reading the file and explaining it in your language\u2026"), "system-status");
    let raw = "";
    try {
      raw = await api.readFile(target);
    } catch (err) {
      const line = tt("slash.explain.failed", "Explanation failed: {error}", {
        error: err instanceof Error ? err.message : String(err)
      });
      appendAssistantRow(get, line, "error");
      s.notify(line);
      return;
    }
    if (!raw || !raw.trim()) {
      const empty = tt("slash.explain.empty", "The file is empty \u2014 nothing to explain.");
      appendAssistantRow(get, empty, "system-status");
      s.notify(empty);
      return;
    }
    const system = ar ? "\u0627\u0634\u0631\u062D \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0628\u0648\u0636\u0648\u062D \u0648\u0625\u064A\u062C\u0627\u0632: \u0645\u0627\u0630\u0627 \u064A\u0641\u0639\u0644\u060C \u0623\u0647\u0645 \u0623\u062C\u0632\u0627\u0626\u0647\u060C \u0648\u0643\u064A\u0641 \u064A\u0631\u062A\u0628\u0637 \u0628\u0627\u0644\u0645\u0634\u0631\u0648\u0639." : "Explain this file clearly and concisely in English: what it does, its key parts, and how it fits into the project.";
    try {
      const res = await api.aiComplete(
        `Explain this file (${target}).

${clipMd(raw, 24e3)}`,
        { system, maxTokens: 1200 }
      );
      const text = (typeof res === "string" ? res : String(res?.text ?? "")).trim();
      if (!text) {
        const noProvider = tt("err.setup.noModel", "No model is selected. Open Settings \u2192 AI providers and choose a model, then send your message again.");
        appendAssistantRow(get, noProvider, "system-status");
        s.notify(noProvider);
        return;
      }
      const title = tt("slash.explain.title", "Explanation of {path}", { path: target });
      appendAssistantRow(get, `${title}

${clipMd(text, 12e3)}`, void 0);
      get().showCapabilityPanel({ title, kind: "explain", text });
      s.notify(title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const line = /no_api_key|no_model|no provider|not configured/i.test(msg) ? tt("err.setup.noModel", "No model is selected. Open Settings \u2192 AI providers and choose a model, then send your message again.") : tt("slash.explain.failed", "Explanation failed: {error}", { error: msg });
      appendAssistantRow(get, line, "error");
      s.notify(line);
    }
  },
  skillsCommand: async (arg) => {
    const s = get();
    const ar = s.settings.language === "ar";
    const tt = slashT(ar);
    const mode = String(arg ?? "").trim().toLowerCase();
    const current = s.settings.trustWorkspaceSkills ?? "ask";
    const label = current === "always" ? tt("slash.skills.state.on", "on") : current === "never" ? tt("slash.skills.state.off", "off") : tt("slash.skills.state.ask", "ask on use");
    const report = (line, title) => {
      appendAssistantRow(get, line, "system-status");
      get().showCapabilityPanel({ title, kind: "skills", text: line });
      s.notify(title);
    };
    if (mode === "on" || mode === "off") {
      get().updateSettings({ trustWorkspaceSkills: mode === "on" ? "always" : "never" });
      if (mode === "on" && s.wsPath && typeof api.skillsTrust === "function") {
        try {
          await api.skillsTrust(s.wsPath);
        } catch {
        }
      }
      const line = mode === "on" ? tt("slash.skills.on", "Skill injection ON \u2014 trusted workspace skills are injected from the next run.") : tt("slash.skills.off", "Skill injection OFF \u2014 workspace skills are skipped from the next run.");
      return report(line, "/skills");
    }
    if (mode === "list") {
      if (!s.wsPath) return s.notify(tt("slash.test.noWorkspace", "Open a folder first."));
      if (typeof api.skillsList !== "function") {
        return s.notify(tt("slash.skills.listEmpty", "No skills are configured for this workspace."));
      }
      let skills = [];
      try {
        skills = await api.skillsList(s.wsPath) ?? [];
      } catch {
        skills = [];
      }
      const title = tt("slash.skills.listTitle", "Workspace skills ({n})", { n: skills.length });
      const rows = skills.length ? skills.map((k) => `\u2022 ${k.name ?? k.slug ?? "?"} (${k.slug ?? "?"}) \u2014 ${k.description ?? ""}`) : [tt("slash.skills.listEmpty", "No skills are configured for this workspace.")];
      return report([title, ...rows].join("\n"), title);
    }
    if (!mode) {
      return report(tt("slash.skills.status", "Skill injection: {state} \u2014 based on the real workspace trust gate.", { state: label }), "/skills");
    }
    s.notify(tt("slash.skills.bad", "Usage: /skills on | off | list"));
  },
  mcpCommand: async (arg) => {
    const s = get();
    const ar = s.settings.language === "ar";
    const tt = slashT(ar);
    if (typeof api.mcpServersGet !== "function") {
      return s.notify(tt("slash.mcp.bridge", "The MCP bridge is unavailable in this build."));
    }
    const raw = String(arg ?? "").trim();
    const first = raw.split(/\s+/)[0].toLowerCase();
    const id = raw.slice(raw.split(/\s+/)[0].length).trim();
    let res;
    try {
      res = await api.mcpServersGet();
    } catch {
      return s.notify(tt("slash.mcp.bridge", "The MCP bridge is unavailable in this build."));
    }
    const servers = Array.isArray(res?.servers) ? res.servers : [];
    const report = (text, title) => {
      appendAssistantRow(get, text, "system-status");
      get().showCapabilityPanel({ title, kind: "mcp", text });
      s.notify(title);
    };
    if (first === "test") {
      if (!id) return s.notify(tt("slash.mcp.testUsage", "Usage: /mcp test <server-id>"));
      if (typeof api.mcpHealthCheck !== "function" && typeof api.mcpConnect !== "function") {
        return s.notify(tt("slash.mcp.bridge", "The MCP bridge is unavailable in this build."));
      }
      const server = servers.find((x) => x?.id === id || x?.name === id);
      if (!server) return s.notify(tt("slash.mcp.notFound", "No MCP server matches {id}.", { id }));
      appendAssistantRow(get, tt("slash.mcp.testing", "Testing MCP server {id}\u2026", { id }), "system-status");
      try {
        if (typeof api.mcpHealthCheck === "function") {
          const h = await api.mcpHealthCheck(server.id ?? id);
          if (h?.state === "connected") {
            report(
              tt("slash.mcp.connected", "{id} is connected \u2014 {n} tool(s), {ms} ms.", {
                id: server.id ?? id,
                n: h.toolCount ?? 0,
                ms: h.latencyMs ?? 0
              }),
              "/mcp test"
            );
          } else {
            report(
              tt("slash.mcp.failed", "{id} failed: {error}", {
                id: server.id ?? id,
                error: h?.error || h?.state || "unknown"
              }),
              "/mcp test"
            );
          }
        } else {
          const st = await api.mcpConnect(server.id ?? id);
          const ok = st?.state === "connected";
          report(
            ok ? tt("slash.mcp.connected", "{id} is connected \u2014 {n} tool(s), {ms} ms.", {
              id: server.id ?? id,
              n: st?.toolCount ?? 0,
              ms: st?.latencyMs ?? 0
            }) : tt("slash.mcp.failed", "{id} failed: {error}", {
              id: server.id ?? id,
              error: st?.error || st?.state || "unknown"
            }),
            "/mcp test"
          );
        }
      } catch (err) {
        report(
          tt("slash.mcp.failed", "{id} failed: {error}", {
            id: server.id ?? id,
            error: err instanceof Error ? err.message : String(err)
          }),
          "/mcp test"
        );
      }
      return;
    }
    if (first === "list" || !first) {
      if (servers.length === 0) {
        return report(tt("slash.mcp.empty", "No MCP servers are configured."), "/mcp");
      }
      const title = tt("slash.mcp.listTitle", "MCP servers ({n})", { n: servers.length });
      const rows = servers.map(
        (x) => `\u2022 ${x.id} \u2014 ${x.state ?? "unknown"} \xB7 ${x.toolCount ?? 0} tools${x.error ? ` \xB7 ${x.error}` : ""}`
      );
      return report([title, ...rows].join("\n"), title);
    }
    s.notify(tt("slash.mcp.bad", "Usage: /mcp list | test <server-id>"));
  },
  budgetCommand: async () => {
    const s = get();
    const tt = slashT(s.settings.language === "ar");
    const u = s.sessionUsage;
    const last = s.lastTurnUsage;
    const cap = s.settings.agent?.taskBudgetUsd;
    const lines = [
      tt("slash.budget.title", "Session budget \u2014 real usage"),
      "\u2022 " + tt("slash.budget.tokens", "Tokens: {i} in / {o} out", {
        i: u.inputTokens.toLocaleString(),
        o: u.outputTokens.toLocaleString()
      }),
      "\u2022 " + tt("slash.budget.cost", "Estimated cost: {c}", { c: `$${u.costUsd.toFixed(4)}` }),
      "\u2022 " + tt("slash.budget.lastTurn", "Last turn: {t} tokens (estimated marked with approx)", {
        t: `${last ? (last.inputTokens + last.outputTokens).toLocaleString() : "0"}${last?.estimated ? " \u2248" : ""}`
      }),
      "\u2022 " + tt("slash.budget.taskCap", "Task spend cap: {v}", {
        v: cap && cap > 0 ? `$${cap.toFixed(2)}` : tt("slash.budget.noCap", "unlimited")
      })
    ];
    if (s.verificationBudgetLabel) {
      lines.push("\u2022 " + tt("slash.budget.verification", "Verification budget: {v}", { v: s.verificationBudgetLabel }));
    }
    const text = lines.join("\n");
    appendAssistantRow(get, text, "system-status");
    get().showCapabilityPanel({ title: tt("slash.budget.title", "Session budget \u2014 real usage"), kind: "budget", text });
    s.notify(tt("slash.budget.title", "Session budget \u2014 real usage"));
  },
  toggleChat: () => set({ chatOpen: !get().chatOpen }),
  // editor AI actions push selection/code here; Composer appends it to the input
  insertIntoComposer: (text) => {
    set({
      chatOpen: true,
      composerInsert: { text, seq: (get().composerInsert?.seq ?? 0) + 1 }
    });
  },
  notify: (msg) => {
    if (get().notice === msg) return;
    set({ notice: msg });
    setTimeout(() => {
      if (get().notice === msg) set({ notice: null });
    }, 3500);
  },
  clearNotice: () => set({ notice: null }),
  // ---------------- auth + project creation ----------------
  signOut: async () => {
    try {
      await api.authLogout();
    } catch {
    }
    set({ account: null });
  },
  setAccount: (a) => set({ account: a }),
  setNewProject: (o) => set({ newProjectOpen: o }),
  setCloneOpen: (o) => set({ cloneOpen: o }),
  cloneRepo: async (opts) => {
    const res = await api.gitClone(opts);
    if (res.ok && res.projectPath) await get().openWorkspace(res.projectPath);
    return res;
  }
}));
var termCreateInflight = null;
function ensureTerminalSession() {
  if (useStore.getState().terminalId) return Promise.resolve();
  if (termCreateInflight) return termCreateInflight;
  termCreateInflight = (async () => {
    try {
      const id = await api.termCreate(useStore.getState().wsPath || "");
      if (id) useStore.setState({ terminalId: id });
    } catch {
    } finally {
      termCreateInflight = null;
    }
  })();
  return termCreateInflight;
}
if (typeof window !== "undefined") {
  window.__sadeemStore = useStore;
}

// shared/effort.ts
var LV = {
  off: { name: "off", en: "Off", ar: "\u0625\u064A\u0642\u0627\u0641" },
  none: { name: "none", en: "None", ar: "\u0644\u0627 \u0634\u064A\u0621" },
  minimal: { name: "minimal", en: "Minimal", ar: "\u0623\u062F\u0646\u0649" },
  low: { name: "low", en: "Low", ar: "\u0645\u0646\u062E\u0641\u0636" },
  medium: { name: "medium", en: "Medium", ar: "\u0645\u062A\u0648\u0633\u0637" },
  high: { name: "high", en: "High", ar: "\u0645\u0631\u062A\u0641\u0639" },
  xhigh: { name: "xhigh", en: "Extra high", ar: "\u0623\u0639\u0644\u0649 \u062C\u062F\u0627\u064B" },
  max: { name: "max", en: "Max", ar: "\u0623\u0642\u0635\u0649" }
};
var NOTE = {
  openai: {
    en: "OpenAI reasoning_effort \u2014 exact values from the OpenAI API.",
    ar: "reasoning_effort \u0645\u0646 OpenAI \u2014 \u0642\u064A\u0645 \u0641\u0639\u0644\u064A\u0629 \u0645\u0646 \u0648\u0627\u062C\u0647\u0629 OpenAI."
  },
  oseries: {
    en: "o-series reasoning_effort \u2014 exact values from the OpenAI API.",
    ar: "reasoning_effort \u0644\u0633\u0644\u0633\u0644\u0629 o \u2014 \u0642\u064A\u0645 \u0641\u0639\u0644\u064A\u0629 \u0645\u0646 \u0648\u0627\u062C\u0647\u0629 OpenAI."
  },
  claude: {
    en: "Anthropic extended thinking \u2014 stops map to real budget_tokens (the API has no named levels).",
    ar: "\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0645\u0645\u062A\u062F \u0645\u0646 Anthropic \u2014 \u062A\u064F\u062A\u0631\u062C\u0645 \u0627\u0644\u0645\u0631\u0627\u062D\u0644 \u0625\u0644\u0649 budget_tokens \u062D\u0642\u064A\u0642\u064A\u0629 (\u0627\u0644\u0648\u0627\u062C\u0647\u0629 \u0644\u0627 \u062A\u0639\u0631\u0641 \u0645\u0633\u062A\u0648\u064A\u0627\u062A \u0645\u064F\u0633\u0645\u0651\u0627\u0629)."
  },
  gemini: {
    en: "Gemini direct gateway has no named effort field; low/high are curated stops only.",
    ar: "\u0628\u0648\u0627\u0628\u0629 Gemini \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629 \u0644\u0627 \u062A\u062D\u062A\u0648\u064A \u062D\u0642\u0644 \u062C\u0647\u062F \u0645\u064F\u0633\u0645\u0651\u0649\u061B \u0645\u0646\u062E\u0641\u0636/\u0645\u0631\u062A\u0641\u0639 \u0645\u062C\u0631\u062F \u0645\u0631\u0627\u062D\u0644 \u0645\u064F\u0646\u0633\u0651\u0642\u0629."
  },
  glm: {
    en: "GLM effort (low/high/max) \u2014 curated from the published provider docs.",
    ar: "\u062C\u0647\u062F GLM (\u0645\u0646\u062E\u0641\u0636/\u0645\u0631\u062A\u0641\u0639/\u0623\u0642\u0635\u0649) \u2014 \u0645\u064F\u0646\u0633\u0651\u0642 \u0645\u0646 \u0648\u062B\u0627\u0626\u0642 \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u0627\u0644\u0645\u0646\u0634\u0648\u0631\u0629."
  },
  generic: {
    en: "No family match \u2014 honest generic stops, best-effort wire field.",
    ar: "\u0644\u0645 \u064A\u062A\u0637\u0627\u0628\u0642 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u0639\u0627\u0626\u0644\u0629 \u2014 \u0645\u0631\u0627\u062D\u0644 \u0639\u0627\u0645\u0629 \u0635\u0627\u062F\u0642\u0629\u060C \u062D\u0642\u0644 \u0625\u0631\u0633\u0627\u0644 \u0628\u0623\u0641\u0636\u0644 \u062C\u0647\u062F."
  },
  routerReasoning: {
    en: "OpenRouter advertises reasoning support (live catalog); the WIRE field is real. Stop names are curated from the model family, not published by the router.",
    ar: "OpenRouter \u064A\u064F\u0639\u0644\u0646 \u062F\u0639\u0645 \u0627\u0644\u062A\u0641\u0643\u064A\u0631 (\u0645\u0646 \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C \u0627\u0644\u062D\u064A)\u061B \u062D\u0642\u0644 \u0627\u0644\u0625\u0631\u0633\u0627\u0644 \u062D\u0642\u064A\u0642\u064A. \u0623\u0633\u0645\u0627\u0621 \u0627\u0644\u0645\u0631\u0627\u062D\u0644 \u0645\u064F\u0646\u0633\u0651\u0642\u0629 \u0645\u0646 \u0639\u0627\u0626\u0644\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C\u060C \u0644\u0627 \u064A\u064E\u0646\u0634\u0631\u0647\u0627 \u0627\u0644\u0645\u0648\u062C\u0651\u0647."
  },
  routerEffort: {
    en: "OpenRouter advertises reasoning_effort (live catalog); the exact value is passed through. Stop names are curated from the model family.",
    ar: "OpenRouter \u064A\u064F\u0639\u0644\u0646 \u062F\u0639\u0645 reasoning_effort (\u0645\u0646 \u0627\u0644\u0643\u062A\u0627\u0644\u0648\u062C \u0627\u0644\u062D\u064A)\u061B \u062A\u064F\u0645\u0631\u064E\u0651\u0631 \u0627\u0644\u0642\u064A\u0645\u0629 \u0643\u0645\u0627 \u0647\u064A. \u0623\u0633\u0645\u0627\u0621 \u0627\u0644\u0645\u0631\u0627\u062D\u0644 \u0645\u064F\u0646\u0633\u0651\u0642\u0629 \u0645\u0646 \u0639\u0627\u0626\u0644\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C."
  }
};
function effortFamilyFor(provider, model) {
  const m = String(model ?? "").toLowerCase().trim();
  const bare = m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m;
  if (provider === "anthropic" || bare.startsWith("claude-") || bare === "claude") return "claude";
  if (/^o\d/.test(bare) || /^o\d-/.test(bare) || bare === "o3" || bare === "o4-mini") return "o-series";
  if (/gpt-?[56]/.test(bare) || bare.includes("codex")) return "gpt5";
  if (bare.includes("gemini")) return "gemini";
  if (bare.includes("glm")) return "glm";
  return "generic";
}
function levelsForFamily(family) {
  switch (family) {
    case "gpt5":
      return [LV.minimal, LV.low, LV.medium, LV.high];
    case "o-series":
      return [LV.low, LV.medium, LV.high];
    case "claude":
      return [LV.none, LV.low, LV.medium, LV.high];
    case "gemini":
      return [LV.low, LV.high];
    case "glm":
      return [LV.low, LV.high, LV.max];
    default:
      return [LV.off, LV.low, LV.medium, LV.high];
  }
}
var ANTHROPIC_BUDGETS = {
  none: 0,
  off: 0,
  low: 2048,
  medium: 8192,
  high: 16384
};
function effortLevelsFor(provider, model, signal) {
  const family = effortFamilyFor(provider, model);
  const levels = levelsForFamily(family);
  const defaultLevel = levels[0].name;
  if (provider === "openrouter" && signal?.supportsReasoningEffort) {
    return {
      provider,
      model,
      family,
      source: "provider-catalog",
      param: "reasoning_effort",
      levels,
      defaultLevel,
      budgets: family === "claude" ? ANTHROPIC_BUDGETS : void 0,
      note: NOTE.routerEffort
    };
  }
  if (provider === "openrouter" && signal?.supportsReasoning) {
    return {
      provider,
      model,
      family,
      source: "provider-catalog",
      param: "reasoning",
      levels,
      defaultLevel,
      budgets: family === "claude" ? ANTHROPIC_BUDGETS : void 0,
      note: NOTE.routerReasoning
    };
  }
  const base2 = {
    provider,
    model,
    family,
    source: "curated",
    param: "reasoning_effort",
    levels,
    defaultLevel,
    budgets: family === "claude" ? ANTHROPIC_BUDGETS : void 0,
    note: NOTE.generic
  };
  switch (family) {
    case "gpt5":
      return { ...base2, param: "reasoning_effort", note: NOTE.openai };
    case "o-series":
      return { ...base2, param: "reasoning_effort", note: NOTE.oseries };
    case "claude":
      return { ...base2, param: "thinking.budget_tokens", note: NOTE.claude };
    case "gemini":
      return { ...base2, param: "none", note: NOTE.gemini };
    case "glm":
      return { ...base2, param: "reasoning_effort", note: NOTE.glm };
    default:
      return base2;
  }
}
function normalizeEffortLevel(desc, value) {
  if (!value) return desc.defaultLevel;
  if (desc.levels.some((l) => l.name === value)) return value;
  if (value === "off" && desc.levels.some((l) => l.name === "none")) return "none";
  if (value === "none" && desc.levels.some((l) => l.name === "off")) return "off";
  return desc.defaultLevel;
}
function effortLevelIndex(desc, value) {
  const name = normalizeEffortLevel(desc, value);
  const i = desc.levels.findIndex((l) => l.name === name);
  return i < 0 ? 0 : i;
}
function isOffEffort(desc, level) {
  if (level === "off" || level === "none") return true;
  const name = normalizeEffortLevel(desc, level);
  if (desc.param === "thinking.budget_tokens") return (desc.budgets?.[name] ?? 0) < 1024;
  return name === "off" || name === "none";
}
function carryEffortLevel(desc, value) {
  if (!value) return void 0;
  if (value === "off" || value === "none" || isOffEffort(desc, value)) return "off";
  return desc.levels.some((l) => l.name === value) ? value : void 0;
}
var groupThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function effortLevelDetail(desc, level) {
  const name = normalizeEffortLevel(desc, level);
  if (desc.param === "thinking.budget_tokens") {
    const budget = desc.budgets?.[name] ?? 0;
    return budget >= 1024 ? `${groupThousands(budget)} tok` : "off";
  }
  if (desc.param === "none") return "no field";
  return desc.param;
}
function effortSignalFromRows(modelId, rows) {
  if (!modelId || !Array.isArray(rows) || rows.length === 0) return null;
  const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[.:]/g, "-");
  const bare = (s) => {
    const k = norm(s);
    const i = k.lastIndexOf("/");
    return i >= 0 ? k.slice(i + 1) : k;
  };
  const want = norm(modelId);
  const row = rows.find((r) => norm(r.id) === want) ?? (want.includes("/") ? void 0 : rows.find((r) => bare(r.id) === want));
  if (!row) return null;
  const parameters = Array.isArray(row.supportedParameters) ? row.supportedParameters.filter((p) => typeof p === "string") : [];
  const has = (name) => parameters.some((p) => norm(p) === name);
  return {
    supportsReasoning: has("reasoning"),
    supportsReasoningEffort: has("reasoning_effort"),
    parameters
  };
}

// src/components/icons.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function base(p) {
  return {
    width: p.size ?? 16,
    height: p.size ?? 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: p.strokeWidth ?? 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: p.className,
    style: p.style,
    "aria-hidden": true
  };
}
var IcSpark = (p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { ...base(p), children: [
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M12 3.5c.7 4.4 2.6 6.3 7 7-4.4.7-6.3 2.6-7 7-.7-4.4-2.6-6.3-7-7 4.4-.7 6.3-2.6 7-7Z" }),
  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M18.8 15.8c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z", opacity: ".7" })
] });

// src/components/EffortControl.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var EFFORT_LEVELS = ["standard", "deep"];
function effortToIndex(level) {
  return level === "deep" ? 1 : 0;
}
function indexToEffort(index) {
  return index >= 1 ? "deep" : "standard";
}
function EffortSlider({
  level,
  onChange
}) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const L = (en, ar) => lang === "ar" ? ar : en;
  const idx = effortToIndex(level);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cf-effort-rail effort-rail effort-rail--engine", dir: "ltr", "data-testid": "chat-effort-rail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        className: `cf-effort-stop effort-stop${idx === 0 ? " is-on" : ""}`,
        onClick: () => onChange("standard"),
        title: t("chat.effort.standard", L("Standard engine effort", "\u062C\u0647\u062F \u0645\u062D\u0631\u0643 \u0642\u064A\u0627\u0633\u064A")),
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { dir: "auto", children: t("chat.effort.standard", L("standard", "\u0642\u064A\u0627\u0633\u064A")) })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "input",
      {
        type: "range",
        min: 0,
        max: 1,
        step: 1,
        value: idx,
        onChange: (e) => onChange(indexToEffort(Number(e.target.value))),
        className: "cf-effort-range effort-range",
        "data-testid": "chat-effort-slider",
        "aria-label": t("chat.effort", L("Engine effort", "\u062C\u0647\u062F \u0627\u0644\u0645\u062D\u0631\u0643")),
        "aria-valuetext": t(`chat.effort.${EFFORT_LEVELS[idx]}`, idx === 0 ? "standard" : "deep")
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        className: `cf-effort-stop effort-stop${idx === 1 ? " is-on" : ""}`,
        onClick: () => onChange("deep"),
        title: t("chat.effort.deep", L("Deep engine effort", "\u062C\u0647\u062F \u0645\u062D\u0631\u0643 \u0639\u0645\u064A\u0642")),
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { dir: "auto", children: t("chat.effort.deep", L("deep", "\u0639\u0645\u064A\u0642")) })
      }
    )
  ] });
}
function ReasoningSlider({
  desc,
  level,
  onChange
}) {
  const lang = useStore((s) => s.settings.language);
  const idx = effortLevelIndex(desc, level);
  const last = Math.max(0, desc.levels.length - 1);
  const showBudgets = desc.param === "thinking.budget_tokens" && !!desc.budgets;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cf-effort-rail effort-rail effort-rail--model", dir: "ltr", "data-testid": "chat-effort-rail-permodel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-track", "aria-hidden": "true" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "input",
      {
        type: "range",
        min: 0,
        max: last,
        step: 1,
        value: idx,
        onChange: (e) => {
          const i = Math.min(last, Math.max(0, Number(e.target.value)));
          onChange(desc.levels[i].name);
        },
        className: "cf-effort-range effort-range",
        "data-testid": "chat-effort-slider-permodel",
        "data-effort-name": desc.levels[idx]?.name ?? "",
        "data-effort-count": desc.levels.length,
        "aria-label": "Reasoning depth",
        "aria-valuetext": desc.levels[idx] ? lang === "ar" ? desc.levels[idx].ar : desc.levels[idx].en : level
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "cf-effort-stops effort-stops", children: desc.levels.map((lv) => {
      const on = lv.name === level;
      const detail = effortLevelDetail(desc, lv.name);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "button",
        {
          className: `cf-effort-stop effort-stop${on ? " is-on" : ""}`,
          onClick: () => onChange(lv.name),
          "aria-pressed": on,
          "data-effort-name": lv.name,
          title: showBudgets ? `${lv.en} \u2014 ${detail}` : lv.en,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-dot", "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-stop-label", dir: "auto", children: lang === "ar" ? lv.ar : lv.en }),
            showBudgets && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-stop-detail", children: detail })
          ]
        },
        lv.name
      );
    }) })
  ] });
}
function EffortControl() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const agent = useStore((s) => s.settings.agent);
  const modelCfg = useStore((s) => s.settings.model);
  const updateSettings = useStore((s) => s.updateSettings);
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [liveRows, setLiveRows] = (0, import_react2.useState)([]);
  const rootRef = (0, import_react2.useRef)(null);
  const lastModelRef = (0, import_react2.useRef)(null);
  const level = agent?.effort === "deep" ? "deep" : "standard";
  const L = (en, ar) => lang === "ar" ? ar : en;
  (0, import_react2.useEffect)(() => {
    if (!open || modelCfg?.provider !== "openrouter") return;
    let alive = true;
    api.openrouterLiveModels().then((rows) => {
      if (alive) setLiveRows(rows);
    }).catch(() => {
      if (alive) setLiveRows([]);
    });
    return () => {
      alive = false;
    };
  }, [open, modelCfg?.provider]);
  const signal = (0, import_react2.useMemo)(
    () => modelCfg?.provider === "openrouter" ? effortSignalFromRows(modelCfg.model, liveRows) : null,
    [modelCfg?.provider, modelCfg?.model, liveRows]
  );
  const desc = (0, import_react2.useMemo)(
    () => effortLevelsFor(modelCfg?.provider ?? "custom", modelCfg?.model ?? "", signal),
    [modelCfg?.provider, modelCfg?.model, signal]
  );
  const reasoningLevel = normalizeEffortLevel(desc, modelCfg?.reasoning);
  const current = desc.levels.find((lv) => lv.name === reasoningLevel) ?? desc.levels[0];
  const currentDetail = effortLevelDetail(desc, current.name);
  (0, import_react2.useEffect)(() => {
    const key = `${modelCfg?.provider ?? ""}\0${modelCfg?.model ?? ""}`;
    const prev = lastModelRef.current;
    lastModelRef.current = { key, reasoning: modelCfg?.reasoning };
    if (!prev || !modelCfg || prev.key === key) return;
    if (!prev.reasoning || modelCfg.reasoning) return;
    const carried = carryEffortLevel(desc, prev.reasoning);
    if (carried) updateSettings({ model: { ...modelCfg, reasoning: carried } });
  }, [modelCfg?.provider, modelCfg?.model, modelCfg?.reasoning, desc, updateSettings]);
  (0, import_react2.useEffect)(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  const setEffort = (next) => {
    if (next === level) return;
    updateSettings({ agent: { ...agent ?? {}, effort: next } });
  };
  const setModelReasoning = (next) => {
    if (!modelCfg || next === modelCfg.reasoning) return;
    updateSettings({ model: { ...modelCfg, reasoning: next } });
  };
  const sourceLabel = desc.source === "provider-catalog" ? L("from provider catalog", "\u0645\u0646 \u0643\u062A\u0627\u0644\u0648\u062C \u0627\u0644\u0645\u0632\u0648\u0651\u062F") : L("curated", "\u0645\u064F\u0646\u0633\u0651\u0642");
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cf-effort", ref: rootRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "button",
      {
        className: `cf-effort-trigger${open ? " is-on" : ""}`,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "data-testid": "chat-effort-trigger",
        onClick: () => setOpen((v) => !v),
        title: t("chat.effort.hint", L(
          `Reasoning effort \u2014 engine: ${level}; model: ${current.en}`,
          `\u062C\u0647\u062F \u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u2014 \u0627\u0644\u0645\u062D\u0631\u0643: ${level}\u061B \u0627\u0644\u0646\u0645\u0648\u0630\u062C: ${current.ar}`
        )),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(IcSpark, { size: 10, className: "shrink-0" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { dir: "auto", children: t("chat.effort", L("Effort", "\u0627\u0644\u062C\u0647\u062F")) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cf-effort-value tnum", dir: "auto", children: t(`chat.effort.${level}`, level === "deep" ? L("deep", "\u0639\u0645\u064A\u0642") : L("standard", "\u0642\u064A\u0627\u0633\u064A")) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-chip-sep", "aria-hidden": "true", children: "\xB7" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-chip-model", dir: "auto", children: lang === "ar" ? current.ar : current.en })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cf-effort-pop effort-pop", role: "dialog", "aria-label": t("chat.effort", L("Reasoning effort", "\u062C\u0647\u062F \u0627\u0644\u062A\u0641\u0643\u064A\u0631")), children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "effort-section effort-section--model", "data-testid": "chat-effort-permodel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "effort-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-title", dir: "auto", children: t("mp.reasoning", L("Reasoning depth", "\u0639\u0645\u0642 \u0627\u0644\u062A\u0641\u0643\u064A\u0631")) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "effort-value tnum", dir: "auto", children: [
            lang === "ar" ? current.ar : current.en,
            currentDetail && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "effort-value-detail", children: [
              " \xB7 ",
              currentDetail
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ReasoningSlider, { desc, level: reasoningLevel, onChange: setModelReasoning }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "effort-meta font-code", dir: "ltr", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-source", children: sourceLabel }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { "aria-hidden": "true", children: " \xB7 " }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: desc.param }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { "aria-hidden": "true", children: " \xB7 " }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: modelCfg?.model ?? "" })
        ] }),
        (!modelCfg?.reasoning || modelCfg.reasoning === "off") && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "effort-unset", dir: "auto", children: L("Provider default \u2014 no effort field sent yet", "\u0627\u0641\u062A\u0631\u0627\u0636\u064A \u0627\u0644\u0645\u0632\u0648\u0651\u062F \u2014 \u0644\u0645 \u064A\u064F\u0631\u0633\u0644 \u062D\u0642\u0644 \u062C\u0647\u062F \u0628\u0639\u062F") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "effort-note", dir: "auto", children: t("mp.reasoningHint", L(desc.note.en, desc.note.ar)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "effort-section effort-section--engine", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "effort-head effort-head--sub", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-title effort-title--sub", dir: "auto", children: t("chat.effort.engine", L("Engine step budget", "\u0645\u064A\u0632\u0627\u0646\u064A\u0629 \u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0643")) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "effort-value effort-value--sub tnum", dir: "auto", children: t(`chat.effort.${level}`, level === "deep" ? L("deep", "\u0639\u0645\u064A\u0642") : L("standard", "\u0642\u064A\u0627\u0633\u064A")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(EffortSlider, { level, onChange: setEffort }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "effort-note effort-note--sub", dir: "auto", children: t(
          "chat.effort.hint",
          L(
            "standard = default \xB7 deep = 2\xD7 engine steps + thinking-first. Separate from the model\u2019s reasoning depth above.",
            "\u0642\u064A\u0627\u0633\u064A = \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A \xB7 \u0639\u0645\u064A\u0642 = \u0636\u0639\u0641 \u062E\u0637\u0648\u0627\u062A \u0627\u0644\u0645\u062D\u0631\u0643 \u0648\u0627\u0644\u062A\u0641\u0643\u064A\u0631 \u0623\u0648\u0644\u0627\u064B. \u0645\u0646\u0641\u0635\u0644 \u0639\u0646 \u0639\u0645\u0642 \u062A\u0641\u0643\u064A\u0631 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0623\u0639\u0644\u0627\u0647."
          )
        ) })
      ] })
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EffortControl,
  ReasoningSlider,
  useStore
});
