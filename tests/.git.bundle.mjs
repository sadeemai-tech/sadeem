// electron/services/gitService.ts
import { spawn } from "child_process";
import { promises as fsp } from "fs";
import * as path from "path";
var MAX_CAPTURE = 5 * 1024 * 1024;
var GIT_TIMEOUT_MS = 3e4;
var GIT_SLOW_TIMEOUT_MS = 12e4;
var DIRTY_CHECK_TIMEOUT_MS = 5e3;
function redactSecrets(text) {
  return String(text ?? "").replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, "$1***@").replace(/\b((?:authorization|token|password|passwd|secret|api[-_]?key)\s*[:=]\s*)([^\s,;]+)/gi, "$1***");
}
function git(root, args, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve2) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const child = spawn("git", ["-c", "core.quotePath=false", "-C", root, ...args], {
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
    });
    const finish = (code, timedOut = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve2({
        code,
        stdout,
        stderr: redactSecrets(stderr),
        timedOut,
        timeoutMs
      });
    };
    child.stdout?.on("data", (c) => {
      if (stdout.length < MAX_CAPTURE) stdout += c.toString("utf8");
    });
    child.stderr?.on("data", (c) => {
      if (stderr.length < MAX_CAPTURE) stderr += c.toString("utf8");
    });
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      stderr += String(err);
      finish(127);
    });
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      stderr += `
[surnia] git command timed out after ${timeoutMs}ms`;
      finish(124, true);
    }, timeoutMs);
  });
}
function actionError(action, res, hint) {
  const firstLine = (res.stderr || res.stdout).split("\n").map((l) => l.trim()).find(Boolean) ?? "git reported an error";
  const reason = res.timedOut ? `timed out after ${res.timeoutMs}ms` : firstLine.slice(0, 400);
  return new Error(`${action} failed (${reason}). ${hint}`);
}
var NOT_A_REPO = /not a git repository/i;
function isConflictStatus(status2) {
  const s = String(status2 ?? "").trim();
  return s.includes("U") || s === "AA" || s === "DD";
}
async function status(root) {
  const res = await git(root, ["status", "--porcelain=v1", "-b"]);
  if (res.code !== 0) {
    if (NOT_A_REPO.test(res.stderr)) return null;
    throw actionError("git status", res, "Open a valid git repository or initialize it with git init.");
  }
  let branch = "";
  const changed = [];
  const lines = res.stdout.split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      if (head.startsWith("No commits yet on ")) {
        branch = head.slice("No commits yet on ".length).trim();
      } else if (/\(no branch\)/.test(head)) {
        branch = "(detached)";
      } else {
        branch = head.split(" ")[0].split("...")[0];
      }
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let filePath = line.slice(3).trim();
    const arrow = filePath.indexOf(" -> ");
    if (arrow >= 0) filePath = filePath.slice(arrow + 4);
    const conflict = isConflictStatus(`${x}${y}`);
    const staged = !conflict && x !== " " && x !== "?";
    const statusChar = conflict ? "U" : (x !== " " ? x : y).trim() || "?";
    changed.push({ path: filePath, status: x === "?" && y === "?" ? "??" : statusChar, staged });
  }
  return { isRepo: true, branch: branch || "HEAD", changed };
}
async function diff(root, filePath) {
  const out = [];
  const wtArgs = ["diff", "--no-color"];
  const ixArgs = ["diff", "--cached", "--no-color"];
  if (filePath) {
    wtArgs.push("--", filePath);
    ixArgs.push("--", filePath);
  }
  const [wt, ix] = await Promise.all([git(root, wtArgs), git(root, ixArgs)]);
  const failed = [wt, ix].find((r) => r.code !== 0);
  if (failed) {
    if (NOT_A_REPO.test(failed.stderr)) return [];
    throw actionError("git diff", failed, "Check the repository is healthy and the path exists.");
  }
  if (wt.stdout.trim()) {
    out.push({ path: filePath ?? "(working tree)", patch: wt.stdout });
  }
  if (ix.stdout.trim()) {
    out.push({ path: filePath ? `${filePath} (staged)` : "(index)", patch: ix.stdout });
  }
  return out;
}
async function stage(root, paths) {
  const list = Array.isArray(paths) ? paths : [];
  const failures = [];
  for (const p of list) {
    if (typeof p !== "string" || !p.trim()) continue;
    if (p.startsWith("!")) {
      const target = p.slice(1).trim();
      let res = await git(root, ["reset", "HEAD", "--", target]);
      if (res.code !== 0 && /ambiguous argument 'HEAD'|unknown revision|fatal: bad revision/i.test(res.stderr)) {
        res = await git(root, ["rm", "--cached", "-r", "--", target]);
      }
      if (res.code !== 0) failures.push(`${target}: ${actionError("git reset", res, "").message}`);
    } else {
      const res = await git(root, ["add", "--", p]);
      if (res.code !== 0) failures.push(`${p}: ${actionError("git add", res, "").message}`);
    }
  }
  if (failures.length) {
    throw new Error(`git stage failed for ${failures.length} path(s): ${failures.join("; ")}. Check the paths and retry.`);
  }
  return true;
}
async function commit(root, message) {
  const msg = String(message ?? "");
  if (!msg.trim()) {
    throw new Error("git commit failed: the commit message is empty. Provide a message and retry.");
  }
  let res = await git(root, ["commit", "-m", msg]);
  if (res.code !== 0 && /user\.name|user\.email|Please tell me who you are|identity/i.test(res.stderr)) {
    await git(root, ["config", "user.name", "Surnia"]);
    await git(root, ["config", "user.email", "surnia@local"]);
    res = await git(root, ["commit", "-m", msg]);
  }
  const combined = res.stdout + res.stderr;
  if (res.code !== 0) {
    if (/nothing to commit|no changes added/i.test(combined)) return "";
    if (/unmerged|conflict|merge in progress|MERGE_HEAD|not concluded your merge|resolve your current index/i.test(combined)) {
      throw new Error(
        "git commit blocked: unresolved merge conflicts (or an in-progress merge). Resolve every conflicted file, stage it, then retry \u2014 or run git merge --abort."
      );
    }
    if (/user\.name|user\.email|Please tell me who you are|identity/i.test(combined)) {
      throw new Error(
        'git commit blocked: no git identity could be configured automatically. Run git config user.name "Your Name" and git config user.email "you@example.com", then retry.'
      );
    }
    throw actionError("git commit", res, "Stage changes with git add first, then retry.");
  }
  const rp = await git(root, ["rev-parse", "--short", "HEAD"]);
  return rp.code === 0 ? rp.stdout.trim() : combined.match(/\b[0-9a-f]{7,40}\b/)?.[0] ?? "";
}
async function init(root) {
  const res = await git(root, ["init"]);
  if (res.code !== 0) throw actionError("git init", res, "Check that the folder exists and is writable.");
  return true;
}
async function log(root, n = 30) {
  const count = Math.max(1, Math.min(200, Number(n) || 30));
  const res = await git(root, [
    "log",
    `-n`,
    String(count),
    "--pretty=format:%h%x09%an%x09%ad%x09%s",
    "--date=short"
  ]);
  if (res.code !== 0) {
    if (/does not have any commits|not a git repository/i.test(res.stderr)) return [];
    throw actionError("git log", res, "Open a repository with at least one commit.");
  }
  return res.stdout.split("\n").map((line) => line.replace(/\r$/, "")).filter(Boolean).map((line) => {
    const [hash = "", author = "", date = "", ...rest] = line.split("	");
    return { hash, author, date, message: rest.join("	") };
  });
}
async function checkout(root, branch) {
  const ref = safeRef(branch);
  if (!ref) {
    throw new Error("INVALID_REF: use a branch name of 1-120 letters, digits, dots, underscores, dashes or slashes (no leading dash).");
  }
  const res = await git(root, ["checkout", ref]);
  if (res.code !== 0) {
    const msg = `${res.stderr}
${res.stdout}`;
    if (/would be overwritten|local changes|uncommitted changes|would overwrite/i.test(msg)) {
      throw new Error(
        `git checkout blocked: switching to "${ref}" would overwrite your local changes. Commit or stash them first, then retry.`
      );
    }
    if (/unmerged|conflict|merge in progress|resolve your current index|index first/i.test(msg)) {
      throw new Error(
        `git checkout blocked: the repository has unresolved conflicts (or an in-progress merge). Resolve them, or run git merge --abort, before switching branches.`
      );
    }
    throw actionError(
      "git checkout",
      res,
      "Use git branch --list to see available branches, or create one first (git checkout -b <name>)."
    );
  }
  return true;
}
async function listBranches(root) {
  const res = await git(root, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname:short)%09%(HEAD)",
    "refs/heads"
  ]);
  if (res.code !== 0) {
    if (NOT_A_REPO.test(res.stderr)) return [];
    throw actionError("git branch list", res, "Open a valid git repository and retry.");
  }
  return res.stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean).map((line) => {
    const [name = "", hash = "", head = ""] = line.split("	");
    return { name: name.trim(), hash: hash.trim(), current: head.trim() === "*" };
  }).filter((b) => b.name);
}
async function createBranch(root, name, opts) {
  const ref = safeRef(name);
  if (!ref) {
    throw new Error(
      'INVALID_BRANCH: use 1-120 letters, digits, dots, underscores, dashes or slashes (no leading dash, no "..").'
    );
  }
  let start = "";
  if (opts?.startPoint && String(opts.startPoint).trim()) {
    const sp = safeRef(opts.startPoint);
    if (!sp) throw new Error("INVALID_START_POINT: use a branch, tag or commit ref (letters, digits, dots, dashes, slashes).");
    const verify = await git(root, ["rev-parse", "--verify", `${sp}^{commit}`]);
    if (verify.code !== 0) {
      throw new Error(`BRANCH_START_MISSING: the start point "${sp}" does not exist (unborn HEAD?). Commit first or pass an existing ref.`);
    }
    start = sp;
  }
  const args = opts?.checkout ? ["checkout", "-b", ref] : ["branch", ref];
  if (start) args.push(start);
  const res = await git(root, args);
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout).trim().slice(0, 400);
    throw new Error(`git branch create failed: ${msg}. Pick a different name or check the start point.`);
  }
  const rp = await git(root, ["rev-parse", "--short", ref]);
  return { name: ref, hash: rp.code === 0 ? rp.stdout.trim() : "", current: !!opts?.checkout };
}
async function identityInfo(root) {
  const [nameRes, emailRes] = await Promise.all([
    git(root, ["config", "user.name"]),
    git(root, ["config", "user.email"])
  ]);
  const name = nameRes.code === 0 ? nameRes.stdout.trim() : "";
  const email = emailRes.code === 0 ? emailRes.stdout.trim() : "";
  return { configured: !!(name && email), name, email };
}
var DIFF_CAP = 12e3;
var MAX_DIRTY_CHECKS = 12;
function safeRef(ref) {
  const r = String(ref ?? "").trim();
  return /^[A-Za-z0-9._\-/]{1,120}$/.test(r) && !r.startsWith("-") && !r.includes("..") ? r : null;
}
async function diffNumstat(root, timeoutMs = GIT_TIMEOUT_MS) {
  let res = await git(root, ["diff", "HEAD", "--numstat", "--no-color"], timeoutMs);
  if (res.code !== 0) {
    if (res.timedOut) throw actionError("git diff --numstat", res, "The repository is too large; increase the timeout and retry.");
    if (!/ambiguous argument 'HEAD'|unknown revision|does not have any commits/i.test(res.stderr)) {
      throw actionError("git diff --numstat", res, "Open a valid git repository and retry.");
    }
    const [cached, wt] = await Promise.all([
      git(root, ["diff", "--cached", "--numstat", "--no-color"], timeoutMs),
      git(root, ["diff", "--numstat", "--no-color"], timeoutMs)
    ]);
    if (cached.timedOut || wt.timedOut || cached.code !== 0 || wt.code !== 0) {
      const bad = cached.timedOut || cached.code !== 0 ? cached : wt;
      throw actionError("git diff --numstat", bad, "Reduce the diff size or increase the timeout and retry.");
    }
    res = { code: 0, stdout: cached.stdout + wt.stdout, stderr: cached.stderr + wt.stderr, timedOut: false, timeoutMs };
  }
  const stat = { files: 0, insertions: 0, deletions: 0 };
  for (const line of res.stdout.split("\n")) {
    const parts = line.replace(/\r$/, "").split("	");
    if (parts.length < 3 || !parts[2]) continue;
    stat.files++;
    stat.insertions += Number(parts[0]) || 0;
    stat.deletions += Number(parts[1]) || 0;
  }
  return stat;
}
async function listWorktrees(root) {
  const res = await git(root, ["worktree", "list", "--porcelain"]);
  if (res.code !== 0) throw actionError("git worktree list", res, "Open a valid git repository and retry.");
  const out = [];
  let wtPath = "";
  let branch = "";
  const flush = () => {
    if (!wtPath) return;
    const bare = branch === "(bare)";
    if (!bare) {
      const base = path.basename(wtPath) || wtPath;
      out.push({
        // canonical short name: sadeem-<name> dirs (our siblings) → <name>;
        // legacy surnia-<name> dirs still resolve (v10.1 worktrees keep working)
        name: base.startsWith("sadeem-") ? base.slice("sadeem-".length) : base.startsWith("surnia-") ? base.slice("surnia-".length) : base,
        // git porcelain prints paths with forward slashes on Windows; the
        // create/remove APIs hand back path.resolve()'d native paths. Normalize
        // here so resolveWorktree()/session hand-off compare equal cross-OS.
        path: path.resolve(wtPath),
        branch: branch || "(detached)",
        createdAt: Date.now()
      });
    }
    wtPath = "";
    branch = "";
  };
  for (const raw of res.stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      const rawPath = line.slice("worktree ".length).trim();
      wtPath = rawPath.length >= 2 && /^".*"$/.test(rawPath) ? rawPath.slice(1, -1) : rawPath;
    } else if (line.startsWith("branch ")) branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    else if (line === "detached") branch = "(detached)";
    else if (line === "bare") branch = "(bare)";
  }
  flush();
  for (const w of out.slice(0, MAX_DIRTY_CHECKS)) {
    try {
      const st = await git(w.path, ["status", "--porcelain"], DIRTY_CHECK_TIMEOUT_MS);
      w.dirty = st.code === 0 ? st.stdout.trim().length > 0 : void 0;
    } catch {
    }
  }
  return out;
}
var WORKTREE_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;
function worktreeBranch(name) {
  return `sadeem/${name}`;
}
function worktreePath(root, name) {
  return path.resolve(root, "..", `sadeem-${name}`);
}
function cleanWorktreeName(name) {
  const clean = String(name ?? "").trim().toLowerCase();
  if (!WORKTREE_NAME_RE.test(clean)) {
    throw new Error("INVALID_NAME: use 1-40 characters of a-z, 0-9, dash or underscore, starting with a letter or digit.");
  }
  return clean;
}
async function resolveWorktreeBase(root, base) {
  const raw = base == null || base === "" ? "HEAD" : String(base);
  const ref = safeRef(raw);
  if (!ref) {
    throw new Error(
      'INVALID_BASE: the worktree base must be a branch, tag or commit (1-120 letters, digits, dots, dashes or slashes; no ".."). Retry with base omitted (uses HEAD) or pass a ref such as "main".'
    );
  }
  const verify = await git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (verify.code !== 0) {
    const headCommit = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const why = headCommit.code !== 0 ? "the repository has no commits yet (unborn HEAD)" : `the ref "${ref}" does not exist`;
    throw new Error(
      `WORKTREE_BASE_MISSING: cannot create a worktree because ${why}. Commit your changes first (or pass base=<existing-branch-or-commit>), then retry.`
    );
  }
  return ref;
}
async function createWorktree(root, name, base) {
  const clean = cleanWorktreeName(name);
  const target = assertWorktreeTarget(root, clean);
  const ref = await resolveWorktreeBase(root, base);
  const existing = await fsp.stat(target).catch(() => null);
  if (existing) {
    throw new Error(
      `WORKTREE_EXISTS: "${target}" already exists. Remove it with worktree_remove (force=true if dirty) or pick a different name.`
    );
  }
  const res = await git(root, ["worktree", "add", target, "-b", worktreeBranch(clean), ref], GIT_SLOW_TIMEOUT_MS);
  if (res.code !== 0) {
    const msg = (res.stderr.trim() || res.stdout.trim() || "git worktree add failed").slice(0, 600);
    throw new Error(
      /already exists|already used|already checked out/i.test(msg) ? `WORKTREE_EXISTS: a worktree or branch named "${clean}" already exists. Remove it with worktree_remove or pick a different name.` : `WORKTREE_ADD_FAILED: ${msg}. Check the workspace path and that the branch sadeem/${clean} is not in use.`
    );
  }
  await copyWorktreeInclude(root, target);
  return {
    name: clean,
    path: target,
    branch: worktreeBranch(clean),
    createdAt: Date.now(),
    dirty: false
  };
}
async function copyWorktreeInclude(root, target) {
  try {
    const incPath = path.join(root, ".worktreeinclude");
    const raw = await fsp.readFile(incPath, "utf8").catch(() => "");
    const patterns = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (patterns.length === 0) return;
    for (const rel of patterns.slice(0, 64)) {
      const normalized = rel.replace(/\\/g, "/").replace(/^\.\//, "");
      const segments = normalized.split("/").filter(Boolean);
      if (!segments.length || normalized.includes("\0")) continue;
      if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) continue;
      if (segments.includes("..")) continue;
      const safeRel = segments.join("/");
      const srcP = path.resolve(root, safeRel);
      const dstP = path.resolve(target, safeRel);
      if (!isInside(root, srcP) || !isInside(target, dstP)) continue;
      const st = await fsp.stat(srcP).catch(() => null);
      if (!st || !st.isFile() && !st.isDirectory()) continue;
      const already = await fsp.stat(dstP).catch(() => null);
      if (already) continue;
      await fsp.mkdir(path.dirname(dstP), { recursive: true });
      if (st.isDirectory()) await copyDirFlat(srcP, dstP, 0);
      else await fsp.copyFile(srcP, dstP);
    }
  } catch {
  }
}
function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
function assertWorktreeTarget(root, name) {
  const clean = cleanWorktreeName(name);
  const base = path.resolve(root);
  const parent = path.dirname(base);
  const expectedName = `sadeem-${clean}`;
  const target = path.resolve(parent, expectedName);
  if (target === base || isInside(base, target) || // never create/remove INSIDE the workspace
  path.dirname(target) !== parent || path.basename(target) !== expectedName || !parent) {
    throw new Error(
      `UNSAFE_PATH: refused worktree path "${target}" for "${clean}" \u2014 it is not a direct sibling of the workspace. Use a short slug of a-z, 0-9, dash or underscore and open the repository from a normal folder.`
    );
  }
  return target;
}
async function copyDirFlat(src, dst, depth) {
  if (depth > 6) return;
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    if (e.isSymbolicLink()) continue;
    const s = path.resolve(src, e.name);
    const d = path.resolve(dst, e.name);
    if (!isInside(src, s) || !isInside(dst, d)) continue;
    if (e.isDirectory()) await copyDirFlat(s, d, depth + 1);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}
async function resolveWorktree(root, name) {
  const clean = String(name ?? "").trim().toLowerCase();
  if (!clean) return null;
  const list = await listWorktrees(root).catch(() => []);
  return list.find((w) => w.name === clean) ?? null;
}
async function removeWorktree(root, name, force) {
  const clean = cleanWorktreeName(name);
  const expected = assertWorktreeTarget(root, clean);
  const known = await listWorktrees(root).catch(() => []);
  const target = known.find((w) => w.name === clean)?.path ?? expected;
  const parent = path.dirname(path.resolve(root));
  if (path.resolve(target) !== expected || path.dirname(path.resolve(target)) !== parent) {
    throw new Error(
      `UNSAFE_PATH: the registered path for "${clean}" ("${target}") is not the expected sibling "${expected}". Remove it manually after inspecting it, then retry.`
    );
  }
  if (!force) {
    const st = await git(target, ["status", "--porcelain"], DIRTY_CHECK_TIMEOUT_MS);
    if (st.code === 0 && st.stdout.trim()) {
      throw new Error(
        `WORKTREE_DIRTY: "${clean}" has uncommitted changes. Commit or stash them in the worktree, or call worktree_remove with force=true to discard them.`
      );
    }
  }
  const res = await git(
    root,
    force ? ["worktree", "remove", "--force", target] : ["worktree", "remove", target],
    GIT_SLOW_TIMEOUT_MS
  );
  if (res.code !== 0) {
    const msg = (res.stderr.trim() || res.stdout.trim() || "git worktree remove failed").slice(0, 600);
    if (/dirty|modified|untracked/i.test(msg) && !force) {
      throw new Error(
        `WORKTREE_DIRTY: "${clean}" has uncommitted changes. Commit or stash them, or call worktree_remove with force=true to discard them.`
      );
    }
    if (/not a working tree|does not exist|not a valid|invalid path/i.test(msg)) {
      await git(root, ["worktree", "prune"], GIT_TIMEOUT_MS);
    } else {
      throw new Error(`WORKTREE_REMOVE_FAILED: ${msg}. Check that the worktree still exists and is not locked.`);
    }
  }
  await git(root, ["branch", "-D", worktreeBranch(clean)]);
  return true;
}
async function mergeWorktree(root, name) {
  const clean = cleanWorktreeName(name);
  const branch = worktreeBranch(clean);
  const res = await git(root, ["merge", "--no-edit", branch], GIT_SLOW_TIMEOUT_MS);
  if (res.code !== 0) {
    await git(root, ["merge", "--abort"]).catch(() => void 0);
    const reason = res.timedOut ? `merge timed out after ${GIT_SLOW_TIMEOUT_MS}ms` : (res.stderr.trim() || res.stdout.trim() || "git merge failed").slice(0, 1200);
    return {
      ok: false,
      error: `MERGE_FAILED: ${reason}. Resolve the conflict in the main worktree or remove the worktree; the main branch was left unchanged.`
    };
  }
  let merged = [];
  const diff2 = await git(root, ["diff", "--name-only", "ORIG_HEAD", "HEAD"]);
  if (diff2.code === 0) {
    merged = diff2.stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  }
  try {
    await removeWorktree(root, clean, false);
  } catch {
  }
  return { ok: true, merged };
}
var FENCE_LINE_RE = /^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm;
var FENCE_TRAILER_RE = /\n?```[a-zA-Z0-9_-]*[ \t]*$/;
function stripFences(text) {
  return text.replace(FENCE_LINE_RE, "").replace(FENCE_TRAILER_RE, "").trim();
}
function firstLines(text, n, maxLineLen = 100) {
  return text.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0).slice(0, n).map((l) => l.slice(0, maxLineLen)).join("\n");
}
async function collectDiffForAi(root) {
  const staged = await git(root, ["diff", "--cached", "--no-color"]);
  let diff2 = staged.stdout.slice(0, DIFF_CAP);
  if (!diff2.trim()) {
    const unstaged = await git(root, ["diff", "--no-color"]);
    diff2 = unstaged.stdout.slice(0, DIFF_CAP);
  }
  return diff2;
}
async function generateCommitMessage(root, complete) {
  try {
    if (typeof complete !== "function") {
      return { ok: false, error: "AI commit message unavailable. Configure an AI provider in Settings \u2192 AI providers, then retry." };
    }
    const diff2 = await collectDiffForAi(root);
    if (!diff2.trim()) {
      return { ok: false, error: "Nothing to commit: stage or edit a file first, then generate the message again." };
    }
    const r = await complete({
      prompt: "Write ONE conventional-commit message (type(scope): subject) + body line for this diff. No backticks.",
      context: diff2,
      system: "You write git commit messages. Output ONLY the commit message: one conventional-commit subject line plus at most one body line. No markdown, no code fences, no explanations.",
      maxTokens: 200,
      temperature: 0.2
    });
    if (!r.ok || !r.text?.trim()) {
      return { ok: false, error: `AI provider did not return a commit message${r.error ? `: ${redactSecrets(r.error)}` : ""}. Check the provider/key in Settings \u2192 AI providers and retry.` };
    }
    const message = firstLines(stripFences(r.text), 3);
    if (!message) return { ok: false, error: "AI returned an empty commit message. Retry or write the message manually." };
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: `Could not generate a commit message: ${redactSecrets(err instanceof Error ? err.message : String(err))}` };
  }
}
async function reviewWorkingTree(root, base, complete) {
  try {
    if (typeof complete !== "function") {
      return { ok: false, error: "AI review unavailable. Configure an AI provider in Settings \u2192 AI providers, then retry." };
    }
    const baseRef = base == null || base === "" ? "HEAD" : safeRef(base);
    if (!baseRef) {
      return { ok: false, error: "INVALID_REF: the review base must be a branch, tag or commit (letters, digits, dots, dashes, slashes)." };
    }
    const diffRes = await git(root, ["diff", baseRef, "--no-color"]);
    if (diffRes.code !== 0) {
      return { ok: false, error: `Could not read the diff for review: ${(diffRes.stderr.trim() || diffRes.stdout.trim() || "git diff failed").slice(0, 400)}. Check the base ref and retry.` };
    }
    const diff2 = diffRes.stdout.slice(0, DIFF_CAP);
    if (!diff2.trim()) return { ok: true, review: "No changes to review." };
    const r = await complete({
      prompt: "Senior code review. List issues as: [severity] file:line \u2014 issue \u2014 suggested fix. Max 12 findings. Then 1-line verdict.",
      context: diff2,
      system: "You are a senior engineer performing a rigorous but pragmatic code review. Be specific and concrete; skip nitpicks that do not matter.",
      maxTokens: 1200,
      temperature: 0.2
    });
    if (!r.ok || !r.text?.trim()) {
      return { ok: false, error: `AI provider did not return a review${r.error ? `: ${redactSecrets(r.error)}` : ""}. Check the provider/key in Settings \u2192 AI providers and retry.` };
    }
    return { ok: true, review: stripFences(r.text) };
  } catch (err) {
    return { ok: false, error: `Could not review the changes: ${redactSecrets(err instanceof Error ? err.message : String(err))}` };
  }
}
export {
  GIT_SLOW_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  assertWorktreeTarget,
  checkout,
  commit,
  createBranch,
  createWorktree,
  diff,
  diffNumstat,
  generateCommitMessage,
  identityInfo,
  init,
  isConflictStatus,
  listBranches,
  listWorktrees,
  log,
  mergeWorktree,
  redactSecrets,
  removeWorktree,
  resolveWorktree,
  reviewWorkingTree,
  stage,
  status,
  worktreePath
};
