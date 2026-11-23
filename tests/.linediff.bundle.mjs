// src/lib/linediff.ts
function splitWords(s) {
  return s.split(/(\s+)/).filter((w) => w.length > 0);
}
function wordLineDiff(a, b) {
  const A = splitWords(a);
  const B = splitWords(b);
  if (A.length * B.length > 2e4) return { del: [{ k: "del", s: a }], add: [{ k: "add", s: b }] };
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i2 = A.length - 1; i2 >= 0; i2--) {
    for (let j2 = B.length - 1; j2 >= 0; j2--) {
      dp[i2][j2] = A[i2] === B[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  const push = (arr, k, s) => {
    const last = arr[arr.length - 1];
    if (last && last.k === k) last.s += s;
    else arr.push({ k, s });
  };
  const del = [];
  const add = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      push(del, "ctx", A[i]);
      push(add, "ctx", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(del, "del", A[i]);
      i++;
    } else {
      push(add, "add", B[j]);
      j++;
    }
  }
  while (i < A.length) {
    push(del, "del", A[i]);
    i++;
  }
  while (j < B.length) {
    push(add, "add", B[j]);
    j++;
  }
  return { del, add };
}
function rawRows(oldText, newText) {
  const A = oldText.split("\n");
  if (A.length > 1 && A[A.length - 1] === "" && oldText.endsWith("\n")) A.pop();
  const B = newText.split("\n");
  if (B.length > 1 && B[B.length - 1] === "" && newText.endsWith("\n")) B.pop();
  const n = A.length;
  const m = B.length;
  const rows = [];
  if (n * m > 4e6) {
    for (let i2 = 0; i2 < n; i2++) rows.push({ kind: "del", oldNo: i2 + 1, newNo: null, text: A[i2] });
    for (let j2 = 0; j2 < m; j2++) rows.push({ kind: "add", oldNo: null, newNo: j2 + 1, text: B[j2] });
    return rows;
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i2 = n - 1; i2 >= 0; i2--) {
    for (let j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = A[i2] === B[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ kind: "ctx", oldNo: i + 1, newNo: j + 1, text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: A[i] });
      i++;
    } else {
      rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: B[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", oldNo: i + 1, newNo: null, text: A[i] });
    i++;
  }
  while (j < m) {
    rows.push({ kind: "add", oldNo: null, newNo: j + 1, text: B[j] });
    j++;
  }
  return rows;
}
function lineDiff(oldText, newText, opts = {}) {
  const context = Math.max(0, Math.min(opts.context ?? 3, 12));
  const maxRows = Math.max(20, opts.maxRows ?? 400);
  const wordHighlight = opts.wordHighlight !== false;
  const out = { hunks: [], add: 0, del: 0, truncated: false };
  if (oldText === newText) return out;
  const rows = rawRows(oldText, newText);
  for (const r of rows) {
    if (r.kind === "add") out.add++;
    else if (r.kind === "del") out.del++;
  }
  const changed = [];
  for (let k = 0; k < rows.length; k++) if (rows[k].kind !== "ctx") changed.push(k);
  if (changed.length === 0) return out;
  const blocks = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(rows.length - 1, changed[0] + context);
  for (let c = 1; c < changed.length; c++) {
    const k = changed[c];
    if (k - context <= end + 1) {
      end = Math.min(rows.length - 1, k + context);
    } else {
      blocks.push([start, end]);
      start = Math.max(0, k - context);
      end = Math.min(rows.length - 1, k + context);
    }
  }
  blocks.push([start, end]);
  let rendered = 0;
  for (const [s, e] of blocks) {
    if (rendered >= maxRows) {
      out.truncated = true;
      break;
    }
    const slice = rows.slice(s, e + 1);
    const oLines = slice.filter((r) => r.oldNo !== null).length;
    const nLines = slice.filter((r) => r.newNo !== null).length;
    const oStart = slice.find((r) => r.oldNo !== null)?.oldNo ?? 0;
    const nStart = slice.find((r) => r.newNo !== null)?.newNo ?? 0;
    const hunk = {
      header: `@@ -${oStart},${oLines} +${nStart},${nLines} @@`,
      rows: slice.map((r) => ({ ...r }))
    };
    if (wordHighlight) {
      let k = 0;
      while (k < hunk.rows.length - 1) {
        const a = hunk.rows[k];
        const b = hunk.rows[k + 1];
        if (a.kind === "del" && b.kind === "add" && a.text.trim() !== "" && b.text.trim() !== "") {
          const wd = wordLineDiff(a.text, b.text);
          a.segs = wd.del;
          b.segs = wd.add;
          k += 2;
        } else {
          k++;
        }
      }
    }
    rendered += slice.length;
    out.hunks.push(hunk);
  }
  if (blocks.length > out.hunks.length) out.truncated = true;
  return out;
}
function diffInputsFromToolArgs(toolName, parsed) {
  try {
    if (toolName === "edit_file") {
      const o = parsed.old_string;
      const n = parsed.new_string;
      if (typeof o === "string" && typeof n === "string" && o !== n) return { oldText: o, newText: n };
      return null;
    }
    if (toolName === "write_file") {
      const n = parsed.content;
      if (typeof n === "string" && n.trim()) return { oldText: "", newText: n };
      return null;
    }
    if (toolName === "multi_edit") {
      const edits = parsed.edits;
      if (!Array.isArray(edits) || edits.length === 0) return null;
      let text = "";
      for (const e of edits) {
        if (!e || typeof e !== "object") continue;
        const o = e.old_string;
        const w = e.new_string;
        if (typeof o !== "string" || typeof w !== "string") continue;
        text = text.includes(o) ? text.replace(o, w) : `${text}${w}`;
      }
      if (!text.trim()) return null;
      return { oldText: "", newText: text };
    }
    return null;
  } catch {
    return null;
  }
}
export {
  diffInputsFromToolArgs,
  lineDiff,
  wordLineDiff
};
