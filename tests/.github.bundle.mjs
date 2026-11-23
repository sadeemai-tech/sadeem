// electron/agent/github.ts
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
function msgOf(err) {
  return err instanceof Error ? err.message : String(err);
}
function runGh(args, workspace, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      // windowsHide: no console flash on Windows; timeout keeps a hung
      // gh from stalling an agent turn forever.
      { cwd: workspace, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ ok: true, missing: false, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
          return;
        }
        const code = err.code;
        resolve({
          ok: false,
          missing: code === "ENOENT",
          stdout: String(err.stdout ?? stdout ?? ""),
          stderr: String(err.stderr ?? stderr ?? "")
        });
      }
    );
  });
}
function ghErrorText(run, fallback) {
  if (run.missing) {
    return "GitHub CLI (gh) is not installed \u2014 install from https://cli.github.com/";
  }
  const raw = `${run.stderr}
${run.stdout}`.replace(/\s+/g, " ").trim();
  if (/not a git repository/i.test(raw)) {
    return "Not a git repository \u2014 open (or git init) a repository before working with pull requests.";
  }
  if (/gh auth login|to get started with github cli|gh_token|unauthorized|401/i.test(raw)) {
    return "GitHub CLI is not authenticated \u2014 run `gh auth login` (or set GH_TOKEN) and retry.";
  }
  if (/no default remote|does not (point|seem) to (be )?a github|not a github repository/i.test(raw)) {
    return "No GitHub remote found \u2014 push the repo to GitHub (git remote add origin \u2026) and retry.";
  }
  return raw ? raw.slice(0, 400) : fallback;
}
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
async function ghAvailable() {
  return new Promise((resolve) => {
    execFile("gh", ["--version"], { timeout: 5e3, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}
var PR_CREATE_TIMEOUT_MS = 6e4;
async function createPullRequest(opts) {
  const workspace = String(opts?.workspace ?? "").trim();
  const title = String(opts?.title ?? "").trim();
  const body = String(opts?.body ?? "");
  if (!workspace) return { ok: false, error: "create_pull_request: workspace path is required." };
  if (!title) return { ok: false, error: "create_pull_request: a PR title is required." };
  if (!isDir(workspace)) return { ok: false, error: `Workspace directory not found: ${workspace}` };
  const args = ["pr", "create", "--title", title, "--body", body];
  if (opts.draft) args.push("--draft");
  if (opts.base) args.push("--base", String(opts.base));
  if (opts.head) args.push("--head", String(opts.head));
  const run = await runGh(args, workspace, PR_CREATE_TIMEOUT_MS);
  if (!run.ok) return { ok: false, error: ghErrorText(run, "gh pr create failed.") };
  const url = run.stdout.split(/\r?\n/).map((l) => l.trim()).reverse().find((l) => /^https:\/\/github\.com\/\S+\/pull\/\d+/.test(l));
  if (!url) {
    return {
      ok: false,
      error: `gh pr create finished but returned no PR URL. Output: ${run.stdout.slice(0, 200) || "(empty)"}`
    };
  }
  return { ok: true, url };
}
var PR_STATUS_TIMEOUT_MS = 3e4;
var PR_STATUS_LIMIT = 10;
async function prStatus(workspace) {
  const ws = String(workspace ?? "").trim();
  if (!ws) return { ok: false, error: "pr_status: workspace path is required." };
  if (!isDir(ws)) return { ok: false, error: `Workspace directory not found: ${ws}` };
  const run = await runGh(
    ["pr", "list", "--json", "number,title,url,state", "--limit", String(PR_STATUS_LIMIT)],
    ws,
    PR_STATUS_TIMEOUT_MS
  );
  if (!run.ok) return { ok: false, error: ghErrorText(run, "gh pr list failed.") };
  try {
    const parsed = JSON.parse(run.stdout || "[]");
    const rows = Array.isArray(parsed) ? parsed : [];
    const prs = [];
    for (const row of rows) {
      const r = row ?? {};
      const n = typeof r.number === "number" ? r.number : Number(r.number);
      if (!Number.isFinite(n)) continue;
      prs.push({
        number: n,
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.url === "string" ? r.url : "",
        state: typeof r.state === "string" ? r.state : ""
      });
    }
    return { ok: true, prs };
  } catch (err) {
    return { ok: false, error: `gh pr list returned unparseable output: ${msgOf(err)}` };
  }
}
export {
  createPullRequest,
  ghAvailable,
  prStatus
};
