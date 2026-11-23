// gen-tool-inventory.mjs — build-time generator for the REAL agent tool
// inventory. Parses CORE_DEFS out of electron/agent/tools.ts (the single
// source of truth the agent actually runs) and writes
// src/generated/toolInventory.json, which the Settings → Agent & Security
// "Tool inventory" card imports. Run before `vite build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// v11.12 (SPLIT-1) — CORE_DEFS moved to its own file (tool-defs.ts)
const src = readFileSync(join(root, 'electron/agent/tool-defs.ts'), 'utf8');

const m = /const CORE_DEFS: ToolDef\[\] = \[([\s\S]*?)\n\];/.exec(src);
if (!m) {
  console.error('gen-tool-inventory: CORE_DEFS not found');
  process.exit(1);
}
const blk = m[1];

// split top-level { ... } objects
const objs = [];
let depth = 0;
let cur = '';
for (const ch of blk) {
  if (ch === '{') depth++;
  if (depth > 0) cur += ch;
  if (ch === '}') {
    depth--;
    if (depth === 0) {
      objs.push(cur);
      cur = '';
    }
  }
}

const rows = [];
for (const o of objs) {
  const name = /name:\s*'([^']+)'/.exec(o)?.[1];
  if (!name) continue;
  const kind = /kind:\s*'([^']+)'/.exec(o)?.[1] ?? 'other';
  const desc = (/description:\s*'((?:[^'\\]|\\.)*)'/.exec(o)?.[1] ?? '')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ');
  rows.push({ name, kind, description: desc });
}

const kinds = {};
for (const r of rows) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
const groups = {};
for (const r of rows) (groups[r.kind] ??= []).push(r.name);

const out = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  kinds,
  groups,
  tools: rows,
};

mkdirSync(join(root, 'src/generated'), { recursive: true });
writeFileSync(join(root, 'src/generated/toolInventory.json'), JSON.stringify(out, null, 1));
console.log(`gen-tool-inventory: ${rows.length} tools written (${JSON.stringify(kinds)})`);
