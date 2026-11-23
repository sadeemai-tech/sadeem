// electron/agent/risk.ts
var DANGER_RULES = [
  // rm -rf on /, ~, /*, $HOME (both flag orders + split flags)
  // v7.2 note: the two rm-root rules moved to rmTargetsRoot() — the broadened
  // detector handles combined, split, reordered and quoted forms (including
  // inside inline-interpreter payloads). System-dir rm rule stays below.
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\s+\/(bin|boot|dev|etc|home|lib|proc|root|srv|sys|usr|var)\b/i, level: "danger", reason: "rm -rf on a system directory" },
  { re: /\bmkfs(?:\.\w+)?\b/i, level: "danger", reason: "mkfs (filesystem destruction)" },
  { re: /\bdd\s+[^\n]*of=\/dev\//i, level: "danger", reason: "dd raw write to a device" },
  { re: /:\(\)\s*\{.*\}\s*;\s*:/, level: "danger", reason: "fork bomb" },
  { re: /\bchmod\s+(?:-[a-z]+\s+)*777\s+\/(?:\s|$|(?!\w))/i, level: "danger", reason: "chmod -R 777 on /" },
  { re: /\bchmod\s+(?:-[a-z]*r[a-z]*\s+)*777\s+\/(?:etc|usr|bin|lib|boot|var|home)\b/i, level: "danger", reason: "chmod -R 777 on a system directory" },
  { re: /\bcurl[^\n|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i, level: "danger", reason: "piping curl into a shell" },
  { re: /\bwget[^\n|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i, level: "danger", reason: "piping wget into a shell" },
  { re: /\bbase64\s+(?:-[a-z]+\s+)*-d[^\n|]*\|\s*(?:ba)?sh\b/i, level: "danger", reason: "base64-decoded payload piped into a shell" },
  { re: /\becho[^\n|]*\|\s*(?:ba)?sh\b/i, level: "danger", reason: "echo piped into a shell (obfuscated payload)" },
  { re: /\beval\s*(?:\$\(|`\$\{|"\$\()/i, level: "danger", reason: "eval of command substitution (obfuscation)" },
  { re: /\beval\s+\$\(/i, level: "danger", reason: "eval of command substitution (obfuscation)" },
  // v7.2 — eval of ANY expanded variable/substitution ("eval \"$CMD\"", eval $CMD):
  // the executed command is invisible to every pattern rule, so it is danger.
  { re: /\beval\b[^\n|;&]*\$/i, level: "danger", reason: "eval of an expanded variable/substitution (obfuscation)" },
  // v7.2 — CREDENTIAL EXFILTRATION (the audit class: cat ~/.ssh/id_rsa | curl -d @- …,
  // env | curl, cat .env | nc). The full raw line is always tested too, so a
  // pipe-split segment cannot hide the pairing of a secret source with a net sink.
  { re: /\b(?:cat|type|less|more|head|tail|base64)\b[^\n|;&]*(?:\.ssh[/\\]|id_rsa|id_ed25519|id_ecdsa|\.env\b|\.netrc|\.git-credentials|\.npmrc|\.aws[/\\]|credentials\b)[^\n|;&]*\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|ftp|telnet|python3?|node|perl)\b/i, level: "danger", reason: "secret file piped into a network tool (exfiltration)" },
  { re: /\b(?:env|printenv|set)\b[^\n|;&]*\|\s*(?:sudo\s+)?(?:curl|wget|nc|ncat|netcat|ftp|telnet)\b/i, level: "danger", reason: "environment dump piped into a network tool (exfiltration)" },
  { re: /\b(?:curl|wget|nc|ncat|netcat)\b[^\n|;&]*(?:--data(?:-binary|-raw)?|-d|-T|--upload-file)\b[^\n|;&]*@[^\n|;&]*(?:\.ssh[/\\]|id_rsa|id_ed25519|\.env\b|\.netrc|\.aws[/\\]|\.git-credentials|\.npmrc)/i, level: "danger", reason: "network upload of a credential file" },
  { re: /\b(?:\.ssh[/\\]|id_rsa|id_ed25519|\.env\b|\.netrc|\.git-credentials|\.aws[/\\]|\.npmrc)[^\n|;&]*\|\s*(?:curl|wget|nc|ncat|netcat|ssh)\b/i, level: "danger", reason: "credential path piped into a network tool" },
  { re: /\bgit\s+push\s+(?:-{1,2}[\w-]+\s+)*-{1,2}force(?:-with-lease)?\b[^\n]*\b(?:main|master)\b/i, level: "danger", reason: "git push --force to main/master" },
  { re: /\bgit\s+push\s+(?:-{1,2}[\w-]+\s+)+[^\n]*\bmain\b|\bgit\s+push\s+.*-{1,2}force\b/i, level: "warn", reason: "git push --force" },
  { re: /\bsudo\b/i, level: "danger", reason: "sudo (elevated privileges)" },
  { re: /\bdiskpart\b/i, level: "danger", reason: "diskpart (disk partitioning)" },
  { re: /\bformat\s+[a-z]:/i, level: "danger", reason: "format a drive" },
  { re: /\breg\s+delete\b/i, level: "danger", reason: "reg delete (Windows registry)" },
  { re: /\b(?:shutdown|reboot|halt|poweroff)\b/i, level: "danger", reason: "host power control" },
  { re: /\btaskkill\s+\/f[^\n]*\/im\s+(?:system|wininit|winlogon|csrss|smss|services|lsass|svchost)(?:\.exe)?\b/i, level: "danger", reason: "taskkill /F on a Windows system process" },
  { re: /\b(?:env|printenv|set)\b[^\n|;&]*\|\s*(?:sudo\s+)?grep\b[^\n|;&]*(?:key|token|secret|password|credential|auth)/i, level: "danger", reason: "environment-variable credential dumping" },
  { re: /\b(?:cat|type)\s+\/proc\/\d+\/environ\b/i, level: "danger", reason: "reading another process environment (credential dumping)" },
  { re: /\bsecurity\s+find-generic-password\b/i, level: "danger", reason: "keychain credential extraction" },
  // v7.2 — destructive API calls inside interpreter payloads (the shell
  // regexes cannot see them): fs.rmSync with a root-ish target, shutil.rmtree.
  { re: /\brmSync\s*\(\s*["'](?:\/|\/\*|~|\$HOME|\.{1,2})["'][^)]*recursive\s*:\s*true/i, level: "danger", reason: "fs.rmSync recursive on a root-ish path (interpreter payload)" },
  { re: /\bshutil\.rmtree\s*\(\s*["'](?:\/|\/\*|~|\$HOME)["']/i, level: "danger", reason: "shutil.rmtree on a root-ish path (interpreter payload)" }
];
var INLINE_INTERPRETER_RE = /\b(?:python3?|node|deno|bun|perl|ruby|php|lua)\s+(?:-{1,2}[\w-]+\s+)*-[ce]\b|\bpowershell(?:\.exe)?\s+[^\n]*(?:-enc(?:odedcommand)?\b|-\s*command\b)|\bpwsh\b[^\n]*-c\b|\bbash\s+-c\b|\bsh\s+-c\b/i;
var ENCODED_PAYLOAD_RE = /(?:-enc(?:odedcommand)?\s+[A-Za-z0-9+/=]{40,})|(?:echo\s+[A-Za-z0-9+/=]{60,}\s*\|\s*base64\s+-d)|(?:\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){15,})/i;
var INDIRECT_COMMAND_RE = /^(?:\$\{?[A-Za-z_]\w*\}?|\$\([^)]*\)|`[^`]*`|%[A-Za-z_]\w*%)\s|\b(?:sudo\s+)?\$\(\s*\$\(/;
function hasDestructivePattern(cmd) {
  return DANGER_RULES.some((r) => r.re.test(cmd)) || rmTargetsRoot(cmd);
}
function rmTargetsRoot(cmd) {
  const SYS_DIR = /^\/(?:bin|boot|dev|etc|home|lib|proc|root|srv|sys|usr|var)\b/;
  const ROOTISH = /^(?:\/(?:\*|\.\.\.?)?|~(?:\/\*)?|\$HOME(?:\/\*)?|\$\{HOME\}(?:\/\*)?|\.(?:\.{1,2})?)$/i;
  const segs = cmd.split(/(?:&&|\|\||;|\n|\|)/);
  for (const segRaw of segs) {
    const seg = segRaw.replace(/["']/g, " ").replace(/\s+/g, " ").trim();
    const m = /\brm\b((?:\s+-{1,2}[\w-]+)*)\s+(.+)$/i.exec(seg);
    if (!m) continue;
    const flags = m[1] || "";
    const hasR = /(^|\s)-[a-z]*r/i.test(flags) || /--recursive\b/i.test(flags);
    const hasF = /(^|\s)-[a-z]*f/i.test(flags) || /--force\b/i.test(flags);
    if (!hasR || !hasF) continue;
    const targets = m[2].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
    for (const t of targets) {
      if (ROOTISH.test(t)) return true;
      if (SYS_DIR.test(t)) return true;
    }
  }
  return false;
}
var WARN_RULES = [
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*(?:r[a-z]*f|f[a-z]*r)[a-z]*\b/i, level: "warn", reason: "recursive-force rm" },
  { re: /\brm\s+-[a-z]*r[a-z]*\b/i, level: "warn", reason: "recursive rm" },
  { re: /\bgit\s+push\s+(?:-{1,2}[\w-]+\s+)*-{1,2}force(?:-with-lease)?\b/i, level: "warn", reason: "git push --force" },
  { re: /\bgit\s+reset\s+--hard\b/i, level: "warn", reason: "git reset --hard (discards changes)" },
  { re: /\bgit\s+clean\s+(?:-{1,2}[\w-]+\s+)*-[a-z]*f/i, level: "warn", reason: "git clean -f (deletes untracked files)" },
  { re: /\bgit\s+checkout\s+--\s*\.?\s*(?:$)/im, level: "warn", reason: "git checkout -- . (discards working tree)" },
  { re: /\bgit\s+restore\s+--?\w*\s*\./i, level: "warn", reason: "git restore . (discards working tree)" },
  { re: /\bchmod\s+(?:-[a-z]*r[a-z]*\s+)*777\b/i, level: "warn", reason: "chmod 777 (world-writable)" },
  { re: /\bchown\s+(?:-[a-z]*r[a-z]*\s+)+[\w.]+:?\w*\s+\//i, level: "warn", reason: "recursive chown on an absolute path" },
  { re: /\bkill\s+-9\b/i, level: "warn", reason: "kill -9 (SIGKILL)" },
  { re: /\bpkill\b|\bkillall\b/i, level: "warn", reason: "batch process kill" },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i, level: "warn", reason: "package publish (public, hard to undo)" },
  { re: /\bdocker\s+(?:system\s+prune|rm\s+-f|volume\s+rm|container\s+prune)\b/i, level: "warn", reason: "destructive docker cleanup" },
  { re: /\bshred\b|\btruncate\s+-s\s*0\b/i, level: "warn", reason: "irreversible file wipe" },
  { re: />\s*\/dev\/(?:sd|nvme|vd)[a-z]/i, level: "warn", reason: "redirect into a block device" },
  { re: /\btaskkill\s+\/f\b/i, level: "warn", reason: "taskkill /F (forced termination)" },
  { re: /\bdel\s+\/[sq]\b/i, level: "warn", reason: "del /s or /q (recursive/quiet delete)" },
  { re: /\brmdir\s+\/s\b/i, level: "warn", reason: "rmdir /s (recursive delete)" },
  { re: /\bdrop\s+(?:database|table)\b/i, level: "warn", reason: "SQL DROP (destructive)" },
  { re: /\btruncate\s+table\b/i, level: "warn", reason: "SQL TRUNCATE (destructive)" }
];
function hasRedirectToDevNullIngest(cmd) {
  return /<\s*\/dev\/(zero|urandom)\b/i.test(cmd);
}
function classifyCommand(cmd) {
  const raw = cmd ?? "";
  const segments = raw.split(/(?:&&|\|\||;|\n|\|)/).map((s) => s.trim()).filter(Boolean);
  segments.push(raw);
  const reasons = [];
  let level = "safe";
  const bump = (l, reason) => {
    if (reasons.includes(reason)) return;
    reasons.push(reason);
    if (l === "danger" || l === "warn" && level === "safe") level = l;
  };
  for (const rule of [...DANGER_RULES, ...WARN_RULES]) {
    for (const seg of segments) {
      if (rule.re.test(seg)) {
        bump(rule.level, rule.reason);
        break;
      }
    }
  }
  if (hasRedirectToDevNullIngest(raw)) bump("warn", "feeding /dev/zero or /dev/urandom into a command");
  if (/\>\s*\/(?:etc|usr|bin|boot|sys|proc)\b/i.test(raw)) bump("danger", "redirect overwriting a system path");
  if (ENCODED_PAYLOAD_RE.test(raw)) {
    bump("danger", "encoded payload (PowerShell -EncodedCommand / base64 pipe / hex escape) \u2014 review the decoded content first");
  }
  if (rmTargetsRoot(raw)) {
    bump("danger", "rm with recursive+force targeting / or ~ or a system directory");
  }
  const indirectHead = segments.some((s) => INDIRECT_COMMAND_RE.test(s.trim()));
  if (indirectHead) {
    bump("warn", "command assembled from a variable or substitution (indirection)");
    for (const s of segments) {
      const m = /^(?:\$\{?[A-Za-z_]\w*\}?|\$\([^)]*\)|`[^`]*`|%[A-Za-z_]\w*%)\s*(.*)$/.exec(s.trim());
      if (m && m[1] && (rmTargetsRoot(`rm ${m[1]}`) || hasDestructivePattern(m[1]))) {
        bump("danger", "destructive pattern behind variable/substitution indirection");
        break;
      }
    }
    if (hasDestructivePattern(raw)) bump("danger", "destructive pattern behind variable/substitution indirection");
  }
  const inline = INLINE_INTERPRETER_RE.test(raw);
  if (inline) {
    bump("warn", `inline interpreter payload (${(raw.match(/\b(?:python3?|node|perl|ruby|php|powershell|pwsh|bash|sh)\b/i) ?? ["interpreter"])[0]} -c/-e) \u2014 arbitrary code`);
    if (hasDestructivePattern(raw)) bump("danger", "destructive pattern hidden inside an inline interpreter payload");
  }
  return { level, reasons };
}
var MUTATING_RULES = [
  { re: /\bsed\s+(?:-{1,2}[\w-]+\s+)*-i\b|\bsed\s+--in-place\b/i, reason: "sed -i edits files in place" },
  { re: /\bperl\s+(?:-{1,2}[\w-]+\s+)*-i\b/i, reason: "perl -i edits files in place" },
  { re: /\btee\b/i, reason: "tee writes files" },
  { re: /\brm\b/i, reason: "rm deletes files" },
  { re: /\bmv\b/i, reason: "mv moves/renames files" },
  { re: /\bcp\b/i, reason: "cp writes files" },
  { re: /\btouch\b/i, reason: "touch creates/updates files" },
  { re: /\btruncate\b/i, reason: "truncate changes file size" },
  { re: /\bmkdir\b|\brmdir\b/i, reason: "mkdir/rmdir change the directory tree" },
  { re: /\b(?:chmod|chown|chgrp|chattr|ln|mklink)\b/i, reason: "permission/link change" },
  { re: /\bkill\b|\bpkill\b|\bkillall\b/i, reason: "process termination" },
  { re: /\bgit\s+(?:commit|push|pull|fetch\s+--all|reset|checkout|switch|restore|clean|rebase|merge|cherry-pick|revert|stash|apply|am|tag|branch|rm|mv|gc|filter-branch)\b/i, reason: "git state change" },
  { re: /\bnpm\s+(?:install|i|add|publish|uninstall|remove|rm|ci|link|unlink|exec|dedupe|update|upgrade)\b|\bnpx\s+(?:--yes|-y)\b/i, reason: "npm package/state change" },
  { re: /\b(?:yarn|pnpm|bun)\s+(?:add|install|i|remove|rm|publish|link|unlink|dedupe|update|upgrade)\b/i, reason: "package manager state change" },
  { re: /\bpip3?\s+(?:install|uninstall|download)\b|\buv\s+(?:pip\s+)?(?:install|sync)\b/i, reason: "pip package change" },
  { re: /\bcargo\s+(?:install|add|remove|publish|update)\b/i, reason: "cargo package change" },
  { re: /\bgem\s+(?:install|uninstall|push)\b/i, reason: "gem package change" },
  { re: /\bgo\s+(?:install|get|mod\s+tidy|work\s+use)\b/i, reason: "go module change" },
  { re: /\bdocker\s+(?:run|build|push|rm|rmi|kill|stop|start|restart|exec|compose|commit|tag|volume|network|system|cp)\b/i, reason: "docker state change" },
  { re: /\bkubectl\s+(?:apply|delete|create|edit|scale|patch|rollout|set|cordon|drain|label|annotate)\b/i, reason: "kubectl cluster change" },
  { re: /\bcurl\s+(?:-{1,2}[\w-]+\s+)*-[oOT]\b|\bcurl\s+--(?:output|remote-name|upload-file|output-file)\b|\bwget\b/i, reason: "downloads a file to disk" },
  { re: /\b(?:aws|gcloud|az|gh|firebase|vercel|netlify|terraform|helm)\b[^\n|;&]*\b(?:apply|create|delete|destroy|deploy|push|put|up|import|init|rm|set|update|cp|sync)\b/i, reason: "cloud/CLI state change" },
  { re: /\b(?:systemctl|service|launchctl)\s+(?:start|stop|restart|enable|disable|reload)\b/i, reason: "system service change" },
  { re: /\b(?:npm|node|python3?|sh|bash|zsh)\s+[^\n|;&]*\b(?:>|>>)\b/i, reason: "shell redirect writes a file" },
  // stdout/stderr redirect into anything except /dev/null-class sinks; "2>&1"
  // (fd dup) is exempt via the (?!&) guard. "ls > out.txt", ">>file", "2>x" all match.
  { re: />(?!&)(?!\s*\/dev\/(?:null|stdout|stderr|tty)\b)/i, reason: "output redirect writes a file" }
];
function isMutatingCommand(cmd) {
  const raw = cmd ?? "";
  if (!raw.trim()) return false;
  const segments = raw.split(/(?:&&|\|\||;|\n|\|)/).map((s) => s.trim()).filter(Boolean);
  segments.push(raw);
  for (const rule of MUTATING_RULES) {
    for (const seg of segments) {
      try {
        if (rule.re.test(seg)) return true;
      } catch {
      }
    }
  }
  return false;
}
var REDACT_RULES = [
  // Anthropic / OpenAI / generic sk- keys (sk-ant-..., sk-proj-..., sk-...)
  { re: /\bsk-(?:ant|proj|svcacct|None)-[A-Za-z0-9_-]{12,}/g, to: "[REDACTED_API_KEY]" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/g, to: "[REDACTED_API_KEY]" },
  // Bearer / token auth headers
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, to: "Bearer [REDACTED]" },
  // AWS
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: "[REDACTED_AWS_KEY]" },
  { re: /\b(?:(?:aws)?_?secret_?access_?key(?:_id)?|aws_session_token)["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{16,}/gi, to: "[REDACTED_AWS_SECRET]" },
  // GitHub / GitLab / Slack tokens
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, to: "[REDACTED_GITHUB_TOKEN]" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, to: "[REDACTED_GITHUB_TOKEN]" },
  { re: /\bglpat-[A-Za-z0-9_-]{16,}\b/g, to: "[REDACTED_GITLAB_TOKEN]" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, to: "[REDACTED_SLACK_TOKEN]" },
  // Google API keys / OAuth
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/g, to: "[REDACTED_GOOGLE_KEY]" },
  // Private key blocks
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: "[REDACTED_PRIVATE_KEY]" },
  // key=value style (api_key, password=..., SECRET: ...)
  {
    re: /\b((?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|client[-_]?secret|secret|passwd|password|pwd|token|credential)["']?\s*(?:[:=]|=>|:=)\s*)(["']?)[A-Za-z0-9._~+/=-]{8,}\2/gi,
    to: "$1[REDACTED]"
  },
  // URLs with inline credentials: scheme://user:password@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, to: "$1$2:[REDACTED]@" }
];
function redactSecrets(s) {
  if (!s || typeof s !== "string" || s.length < 8) return s;
  let out = s;
  for (const { re, to } of REDACT_RULES) {
    out = out.replace(re, to);
  }
  return out;
}
export {
  classifyCommand,
  isMutatingCommand,
  redactSecrets
};
