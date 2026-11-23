// electron/agent/editEngine.ts
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "child_process";
var FileEditGuard = class _FileEditGuard {
  reads = /* @__PURE__ */ new Map();
  /** Files this guard is allowed to edit without a prior read (e.g. files the agent itself created this run). */
  authored = /* @__PURE__ */ new Set();
  static hashOf(content) {
    return createHash("sha1").update(content).digest("hex");
  }
  recordRead(absPath, fullContent) {
    this.reads.set(path.resolve(absPath), {
      hash: _FileEditGuard.hashOf(fullContent),
      size: fullContent.length,
      at: Date.now()
    });
  }
  recordWrite(absPath, content) {
    const p = path.resolve(absPath);
    this.reads.set(p, {
      hash: _FileEditGuard.hashOf(content),
      size: content.length,
      at: Date.now()
    });
    this.authored.add(p);
  }
  hasRead(absPath) {
    return this.reads.has(path.resolve(absPath)) || this.authored.has(path.resolve(absPath));
  }
  /**
   * Throws a structured Error when the file must be (re-)read before editing.
   * The message is model-facing: it states the exact tool call to run next.
   */
  assertEditable(absPath, currentContent) {
    const p = path.resolve(absPath);
    if (this.authored.has(p)) return;
    const rec = this.reads.get(p);
    if (!rec) {
      throw new Error(
        `READ_BEFORE_EDIT: refusing to edit ${p} \u2014 it was never read in this session. Call read_file on "${p}" first (harness-enforced), then retry the edit with text taken from that read.`
      );
    }
    const now = _FileEditGuard.hashOf(currentContent);
    if (now !== rec.hash) {
      throw new Error(
        `STALE_READ: ${p} changed on disk (or was edited by another process) since your last read. Call read_file on "${p}" again to refresh, then retry the edit against the CURRENT content.`
      );
    }
  }
  forgetAll() {
    this.reads.clear();
    this.authored.clear();
  }
};
var guards = /* @__PURE__ */ new Map();
function getGuard(sessionId) {
  let g = guards.get(sessionId);
  if (!g) {
    if (guards.size >= 64) {
      const oldest = guards.keys().next().value;
      if (oldest) guards.delete(oldest);
    }
    g = new FileEditGuard();
    guards.set(sessionId, g);
  }
  return g;
}
function clearGuard(sessionId) {
  guards.get(sessionId)?.forgetAll();
  guards.delete(sessionId);
}
function normLine(l) {
  return l.replace(/\s+/g, " ").trim();
}
function indentWidth(ws) {
  let w = 0;
  for (const ch of ws) w += ch === "	" ? 4 : 1;
  return w;
}
function leadingWs(line) {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : "";
}
function reindent(block, targetBaseWidth, oldBaseWidth, useTabs) {
  const lines = block.split("\n");
  let base = -1;
  for (const l of lines) {
    if (normLine(l)) {
      base = indentWidth(leadingWs(l));
      break;
    }
  }
  if (base < 0) return block;
  const delta = targetBaseWidth - oldBaseWidth;
  const pad = useTabs ? "	".repeat(Math.max(0, Math.round(delta / 4))) : " ".repeat(Math.max(0, delta));
  return lines.map((l) => {
    if (!normLine(l)) return l;
    return delta >= 0 ? pad + l : l.slice(Math.min(-delta, leadingWs(l).length));
  }).join("\n");
}
function detectEol(text) {
  const i = text.indexOf("\n");
  if (i > 0 && text[i - 1] === "\r") return "\r\n";
  return "\n";
}
function findWindows(fileLines, targetLines, lineScore, acceptLine, maxWindows = 16) {
  const t = targetLines.length;
  const windows = [];
  if (!t || t > fileLines.length) return windows;
  const tryWindow = (start, len) => {
    if (start + len > fileLines.length) return null;
    let matched = 0;
    let i = start;
    for (let j = 0; j < t; j++) {
      let skipped = 0;
      while (i < start + len && !normLine(fileLines[i]) && normLine(targetLines[j])) {
        i++;
        skipped++;
        if (skipped > 2) return null;
      }
      if (i >= start + len) return null;
      if (lineScore(fileLines[i], targetLines[j]) >= acceptLine) {
        matched++;
        i++;
      } else {
        return null;
      }
    }
    for (; i < start + len; i++) {
      if (normLine(fileLines[i])) return null;
    }
    return { start, end: start + len, score: matched / t };
  };
  for (let s = 0; s + t <= fileLines.length; s++) {
    for (const extra of [0, 1, 2]) {
      const w = tryWindow(s, t + extra);
      if (w && w.score >= 0.99) windows.push(w);
    }
    if (windows.length >= maxWindows * 4) break;
  }
  windows.sort((a, b) => b.score - a.score || a.start - b.start);
  const byStart = /* @__PURE__ */ new Map();
  for (const w of windows) {
    const cur = byStart.get(w.start);
    if (!cur || w.score > cur.score) byStart.set(w.start, w);
  }
  return [...byStart.values()].sort((a, b) => b.score - a.score || a.start - b.start).slice(0, maxWindows);
}
var FINGERPRINT_MAX_FILE_LINES = 6e3;
var FINGERPRINT_MAX_TARGET_LINES = 160;
function charBagSim(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bag = /* @__PURE__ */ new Map();
  for (const ch of a) bag.set(ch, (bag.get(ch) ?? 0) + 1);
  let common = 0;
  for (const ch of b) {
    const n = bag.get(ch) ?? 0;
    if (n > 0) {
      bag.set(ch, n - 1);
      common++;
    }
  }
  return 2 * common / (a.length + b.length);
}
function tolerantReplace(original, oldString, newString, replaceAll = false) {
  if (!oldString) return { ok: false, error: "old_string is empty." };
  const exactCount = original.split(oldString).length - 1;
  if (exactCount > 0) {
    if (exactCount > 1 && !replaceAll) {
      return { ok: false, error: `old_string matches ${exactCount} places \u2014 add surrounding context or set replace_all=true.` };
    }
    const updated = replaceAll ? original.split(oldString).join(newString) : original.replace(oldString, newString);
    const idx = original.indexOf(oldString);
    const startLine = original.slice(0, idx).split("\n").length;
    return {
      ok: true,
      updated,
      method: "exact",
      occurrences: exactCount,
      startLine,
      endLine: startLine + oldString.split("\n").length - 1
    };
  }
  const eol = detectEol(original);
  const fileLines = original.split("\n");
  const useTabs = (original.match(/^\t/gm)?.length ?? 0) > (original.match(/^ {4}/gm)?.length ?? 0);
  const oldRawLines = oldString.replace(/\r\n/g, "\n").split("\n");
  const newRawLines = newString.replace(/\r\n/g, "\n").split("\n");
  while (oldRawLines.length && !normLine(oldRawLines[0])) oldRawLines.shift();
  while (oldRawLines.length && !normLine(oldRawLines[oldRawLines.length - 1])) oldRawLines.pop();
  const oldLines = oldRawLines.filter((l) => normLine(l));
  if (!oldLines.length) return { ok: false, error: "old_string is empty after normalization." };
  const normScore = (a, b) => normLine(a) === normLine(b) ? 1 : 0;
  let wins = findWindows(fileLines, oldLines, normScore, 1);
  let method = "normalized";
  if (!wins.length && fileLines.length <= FINGERPRINT_MAX_FILE_LINES && oldLines.length <= FINGERPRINT_MAX_TARGET_LINES) {
    method = "fingerprint";
    wins = findWindows(fileLines, oldLines, (a, b) => charBagSim(normLine(a), normLine(b)), 0.72);
  }
  if (!wins.length) {
    return {
      ok: false,
      error: `old_string not found (even with whitespace/fuzzy tolerance). Re-read the file and copy old_string EXACTLY from the current content \u2014 do not paraphrase code.`
    };
  }
  const best = wins[0];
  if (!replaceAll && wins.length > 1 && wins[1].score >= best.score - 0.05) {
    const locs = wins.slice(0, 4).map((w) => `line ${w.start + 1}`).join(", ");
    return {
      ok: false,
      error: `old_string is ambiguous (${locs} candidate matches at ${Math.round(best.score * 100)}% similarity) \u2014 include more unique surrounding lines.`
    };
  }
  if (replaceAll && wins.length > 1) {
    const apply = wins.filter((w) => w.score >= Math.max(0.6, best.score - 0.05));
    let out2 = fileLines;
    let last = apply.length;
    for (let i = apply.length - 1; i >= 0; i--) {
      const w = apply[i];
      const region2 = out2.slice(w.start, w.end);
      const baseWs2 = leadingWs(region2.find((l) => normLine(l)) ?? "");
      const oldBase2 = leadingWs(oldRawLines.find((l) => normLine(l)) ?? "");
      const replacement2 = reindent(newRawLines.join("\n"), indentWidth(baseWs2), indentWidth(oldBase2), useTabs).split("\n");
      out2 = [...out2.slice(0, w.start), ...replacement2, ...out2.slice(w.end)];
      last = w.start;
    }
    return {
      ok: true,
      updated: out2.join(eol === "\r\n" ? "\r\n" : "\n"),
      method,
      occurrences: apply.length,
      startLine: last + 1
    };
  }
  const region = fileLines.slice(best.start, best.end);
  const baseWs = leadingWs(region.find((l) => normLine(l)) ?? "");
  const oldBase = leadingWs(oldRawLines.find((l) => normLine(l)) ?? "");
  const replacement = reindent(newRawLines.join("\n"), indentWidth(baseWs), indentWidth(oldBase), useTabs).split("\n");
  const out = [...fileLines.slice(0, best.start), ...replacement, ...fileLines.slice(best.end)];
  return {
    ok: true,
    updated: out.join(eol === "\r\n" ? "\r\n" : "\n"),
    method,
    occurrences: 1,
    startLine: best.start + 1,
    endLine: best.start + replacement.length
  };
}
function bracketBalance(text, brackets) {
  const pairs = {};
  for (const [open, close] of Object.entries(brackets)) pairs[close] = open;
  const stack = [];
  let i = 0;
  const n = text.length;
  let inLine = false;
  let inBlock = false;
  let inHash = false;
  let inStr = null;
  let inTpl = false;
  let tplDepth = 0;
  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : "";
    if (inLine) {
      if (ch === "\n") inLine = false;
    } else if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
    } else if (inHash) {
      if (ch === "\n") inHash = false;
    } else if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
    } else if (inTpl) {
      if (ch === "\\") i++;
      else if (ch === "`") inTpl = false;
      else if (ch === "$" && next === "{") tplDepth++;
      else if (ch === "}" && tplDepth > 0) tplDepth--;
    } else {
      if (ch === "/" && next === "/" || ch === "#") inLine = true;
      else if (ch === "/" && next === "*") {
        inBlock = true;
        i++;
      } else if (ch === '"' || ch === "'") inStr = ch;
      else if (ch === "`") inTpl = true;
      else if (brackets[ch]) stack.push(ch);
      else if (pairs[ch]) {
        const open = stack.pop();
        if (open !== pairs[ch]) return { net: stack.length + 1, firstUnbalanced: ch };
      }
    }
    i++;
  }
  return { net: stack.length };
}
var C_LIKE_BRACKETS = { "{": "}", "(": ")", "[": "]" };
async function syntaxProbe(absPath, content) {
  const ext = path.extname(absPath).toLowerCase();
  try {
    if (ext === ".json") {
      try {
        JSON.parse(content);
        return { error: null, warn: null, checked: "parser" };
      } catch (err) {
        return { error: `JSON parse failed after this edit: ${err instanceof Error ? err.message : String(err)}. The file was NOT saved.`, warn: null, checked: "parser" };
      }
    }
    if (ext === ".py") {
      const py = await pickPython();
      if (py) {
        try {
          await runCapture(py, ["-c", 'import ast,sys; ast.parse(sys.stdin.buffer.read().decode("utf-8"))'], content, 1e4);
          return { error: null, warn: null, checked: "parser" };
        } catch (err) {
          return {
            error: `Python syntax check failed after this edit (file NOT saved): ${(err instanceof Error ? err.message : String(err)).slice(0, 600)}. Fix the syntax in new_string and retry.`,
            warn: null,
            checked: "parser"
          };
        }
      }
    }
    if ([".ts", ".tsx"].includes(ext)) {
      const nodeBin = process.execPath.endsWith("node") || process.platform !== "win32" ? "node" : process.execPath;
      const loader = ext === ".tsx" ? "tsx" : "ts";
      const script = `const es=require('esbuild');const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{try{es.transformSync(Buffer.concat(c).toString('utf8'),{loader:'${loader}'});process.exit(0)}catch(e){process.stderr.write(String(e.message||e));process.exit(1)}});`;
      try {
        await runCapture(nodeBin, ["-e", script], content, 12e3);
        return { error: null, warn: null, checked: "parser" };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (/Cannot find module|ERR_MODULE_NOT_FOUND|require is not defined/i.test(detail)) {
          const bal = bracketBalance(content, { "{": "}", "[": "]", "(": ")" });
          if (bal.net !== 0) {
            return { error: null, warn: `TS parse unavailable here \u2014 bracket balance found ${bal.net > 0 ? bal.net + " unclosed" : "extra closing"} brace(s); verify the file compiles.`, checked: "balance" };
          }
          return { error: null, warn: null, checked: "balance" };
        }
        return {
          error: `TypeScript syntax check failed after this edit (file NOT saved): ${detail.slice(0, 600)}. Fix the syntax and retry.`,
          warn: null,
          checked: "parser"
        };
      }
    }
    if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext)) {
      const node = process.execPath.endsWith("node") || process.platform !== "win32" ? "node" : process.execPath;
      const asModule = ext === ".mjs" || ext === ".jsx" || /\b(import|export)\b/.test(content.slice(0, 4e3));
      const tmp = path.join(os.tmpdir(), `surnia-check-${Date.now()}-${Math.random().toString(36).slice(2)}${asModule ? ".mjs" : ".cjs"}`);
      try {
        await fs.writeFile(tmp, content, "utf8");
        await runCapture(node, ["--check", tmp], "", 1e4);
        return { error: null, warn: null, checked: "parser" };
      } catch (err) {
        return {
          error: `JavaScript syntax check failed after this edit (file NOT saved): ${(err instanceof Error ? err.message : String(err)).slice(0, 600)}. Fix the syntax and retry.`,
          warn: null,
          checked: "parser"
        };
      } finally {
        void fs.unlink(tmp).catch(() => void 0);
      }
    }
    const balanceLangs = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".less", ".java", ".kt", ".swift", ".cs", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".php", ".dart", ".vue", ".svelte"]);
    if (balanceLangs.has(ext)) {
      const { net } = bracketBalance(content, C_LIKE_BRACKETS);
      if (net > 0) {
        return { error: null, warn: `[syntax] ${net} unclosed bracket(s) after this edit \u2014 if intentional (block spans calls) ignore, otherwise fix now.`, checked: "balance" };
      }
      if (net < 0) {
        return { error: null, warn: `[syntax] ${-net} extra closing bracket(s) after this edit \u2014 check your new_string.`, checked: "balance" };
      }
      return { error: null, warn: null, checked: "balance" };
    }
    return { error: null, warn: null, checked: "none" };
  } catch {
    return { error: null, warn: null, checked: "none" };
  }
}
function repairToolArgsJson(raw) {
  if (!raw || !raw.trim()) return { text: raw, repaired: false };
  let s = raw.trim();
  let repaired = false;
  const attempt = () => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  };
  if (attempt()) return { text: s, repaired: false };
  if (/[“”„‘’]/.test(s)) {
    s = s.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'");
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }
  const noTrailing = s.replace(/,\s*([}\]])/g, "$1");
  if (noTrailing !== s) {
    s = noTrailing;
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }
  const closeBroken = () => {
    let depth = 0;
    let inStr = null;
    let esc = false;
    let lastSafe = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === inStr) {
          inStr = null;
          lastSafe = i;
        }
        continue;
      }
      if (ch === '"') inStr = '"';
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        lastSafe = i;
      } else if (ch === "," && depth >= 1) {
        lastSafe = i - 1;
      }
    }
    if (lastSafe < 0) return s;
    let head = s.slice(0, lastSafe + 1);
    head = head.replace(/,\s*$/, "");
    if (inStr) head += '"';
    const stack = [];
    let inStr2 = null;
    let esc2 = false;
    for (const ch of head) {
      if (inStr2) {
        if (esc2) esc2 = false;
        else if (ch === "\\") esc2 = true;
        else if (ch === inStr2) inStr2 = null;
        continue;
      }
      if (ch === '"') inStr2 = '"';
      else if (ch === "{") stack.push("{");
      else if (ch === "[") stack.push("[");
      else if (ch === "}") stack.pop();
      else if (ch === "]") stack.pop();
    }
    while (stack.length) head += stack.pop() === "[" ? "]" : "}";
    return head;
  };
  const closed = closeBroken();
  if (closed !== s) {
    s = closed;
    repaired = true;
    if (attempt()) return { text: s, repaired };
  }
  return { text: s, repaired };
}
function runCapture(cmd, args, stdin, timeout) {
  return new Promise((resolve2, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err) => err ? reject(err) : resolve2());
    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}
var pythonCache;
async function pickPython() {
  if (pythonCache !== void 0) return pythonCache;
  for (const cand of ["python3", "python"]) {
    try {
      await runCapture(cand, ["--version"], "", 5e3);
      pythonCache = cand;
      return cand;
    } catch {
    }
  }
  pythonCache = null;
  return null;
}
export {
  FileEditGuard,
  clearGuard,
  getGuard,
  repairToolArgsJson,
  syntaxProbe,
  tolerantReplace
};
