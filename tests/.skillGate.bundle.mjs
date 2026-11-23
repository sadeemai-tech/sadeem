// electron/agent/skillGate.ts
import * as fs from "node:fs";
import * as path from "node:path";
var MIN_OK_RUNS = 1;
var FAIL_DECAY = 2;
var cache = null;
function ledgerFile(userDataDir) {
  return path.join(userDataDir, "skill-promotions.json");
}
function loadLedger(userDataDir) {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerFile(userDataDir), "utf8"));
    cache = raw && typeof raw === "object" ? raw : {};
  } catch {
    cache = {};
  }
  return cache;
}
function saveLedger(userDataDir, ledger) {
  cache = ledger;
  try {
    fs.mkdirSync(path.dirname(ledgerFile(userDataDir)), { recursive: true });
    fs.writeFileSync(ledgerFile(userDataDir), JSON.stringify(ledger, null, 2), "utf8");
  } catch {
  }
}
function skillGateStatus(userDataDir, slug, isBuiltin) {
  if (isBuiltin) return "builtin";
  const ledger = loadLedger(userDataDir);
  return ledger[slug]?.status ?? "candidate";
}
function skillGateQuarantine(userDataDir, slug, findings) {
  const ledger = loadLedger(userDataDir);
  const entry = ledger[slug] ?? { slug, status: "candidate", okRuns: 0, failedRuns: 0, poisonFindings: [], updatedAt: Date.now() };
  entry.status = "quarantined";
  entry.poisonFindings = findings.slice(0, 6);
  entry.updatedAt = Date.now();
  ledger[slug] = entry;
  saveLedger(userDataDir, ledger);
}
function skillGateRecordUse(userDataDir, slug, runOk) {
  const ledger = loadLedger(userDataDir);
  const entry = ledger[slug] ?? { slug, status: "candidate", okRuns: 0, failedRuns: 0, poisonFindings: [], updatedAt: Date.now() };
  if (entry.status === "quarantined") return entry.status;
  if (runOk) entry.okRuns++;
  else entry.failedRuns++;
  if (entry.okRuns >= MIN_OK_RUNS && entry.failedRuns < FAIL_DECAY) entry.status = "verified";
  else if (entry.failedRuns >= FAIL_DECAY && entry.okRuns < MIN_OK_RUNS) entry.status = "candidate";
  entry.updatedAt = Date.now();
  ledger[slug] = entry;
  saveLedger(userDataDir, ledger);
  return entry.status;
}
function promoteSkillsFromTraces(userDataDir, days = 7) {
  const out = { scanned: 0, skillUses: /* @__PURE__ */ new Map(), promotions: [] };
  try {
    const tracesRoot = path.join(userDataDir, "traces");
    if (!fs.existsSync(tracesRoot)) return out;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1e3;
    const ledger = loadLedger(userDataDir);
    const dayDirs = fs.readdirSync(tracesRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const day of dayDirs) {
      const dayDir = path.join(tracesRoot, day);
      let files = [];
      try {
        files = fs.readdirSync(dayDir).filter((f) => f.startsWith("trace-") && f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = path.join(dayDir, f);
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs < cutoff) continue;
          const lines = fs.readFileSync(full, "utf8").split("\n").filter(Boolean);
          out.scanned++;
          const slugs = /* @__PURE__ */ new Set();
          let runOk = false;
          for (const line of lines) {
            try {
              const rec = JSON.parse(line);
              if (rec.type === "tool" && rec.name === "use_skill" && typeof rec.args?.slug === "string") {
                slugs.add(rec.args.slug);
              }
              if (rec.type === "finish") {
                runOk = rec.ok === true && !rec.failure;
              }
            } catch {
            }
          }
          for (const slug of slugs) {
            out.skillUses.set(slug, runOk);
            const before = ledger[slug]?.status ?? "candidate";
            const after = skillGateRecordUse(userDataDir, slug, runOk);
            if (before !== after) out.promotions.push(`${slug}: ${before} \u2192 ${after}`);
          }
        } catch {
        }
      }
    }
  } catch {
  }
  return out.promotions.length || out.scanned ? out : out;
}
function skillBadge(status) {
  switch (status) {
    case "builtin":
      return "builtin";
    case "verified":
      return "evidence-verified";
    case "quarantined":
      return "quarantined (poison scan)";
    default:
      return "candidate \u2014 not yet evidence-verified";
  }
}
export {
  promoteSkillsFromTraces,
  skillBadge,
  skillGateQuarantine,
  skillGateRecordUse,
  skillGateStatus
};
