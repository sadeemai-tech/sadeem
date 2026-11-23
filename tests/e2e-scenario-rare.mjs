// E2E SCENARIO D (Task e2e-scenarios-B) — RARE/OLD LANGUAGES + LIVE PREVIEW.
// Drives the REAL SADEEM engine (runAgent) with a scripted fake LLM. The
// system has no cobol/fortran/tcl, but POSIX awk (1977, mawk here) and perl
// (1987) ARE installed — the scripted model uses them through the engine's
// own run_command tool to prove the engine executes artifacts in genuinely
// different language runtimes and the artifact is previewable:
//   write analytics/transactions.csv (32 real rows) → analytics/aggregate.awk
//   (per-category totals/min/max/counts, formatted report) → analytics/report.pl
//   (reads the CSV, writes analytics/report.html with a table + inline SVG bar
//   chart) → run_command awk → run_command perl → index.html linking/embedding
//   the report → final text.
//
// HONEST CAVEAT: the LLM is SCRIPTED — this proves the ENGINE pipeline
// (multi-runtime command execution, fs artifacts, task_report), not model
// intelligence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  commandsRunOf,
  copyArtifacts,
  drive,
  freshWorkspace,
  writeSummary,
} from '../scripts/e2e/scenario-runner-B.mjs';

export const PROMPT =
  'أنشئ نظام تحليل مبيعات كلاسيكي بلغات نادرة قديمة: ملف analytics/transactions.csv بعينة بيانات حقيقية ' +
  '(أكثر من 30 عملية)، وبرنامج AWK حقيقي analytics/aggregate.awk يحسب إجماليات كل فئة وأصغر/أكبر قيمة وعدد ' +
  'العمليات بتقرير منسق، وبرنامج Perl حقيقي analytics/report.pl يقرأ الـ CSV ويولّد صفحة تقرير HTML مع جدول ' +
  'ورسم أعمدة SVG مضمّن، ثم نفّذ البرنامجين عبر run_command وأخيراً اكتب index.html يعرض التقرير.';

// ---------- analytics/transactions.csv (32 data rows + header) ----------
const TRANSACTIONS_CSV = `txn_id,date,category,amount,qty
TXN-001,2024-01-02,coffee,14.50,2
TXN-002,2024-01-02,tea,9.00,1
TXN-003,2024-01-02,pastry,18.25,3
TXN-004,2024-01-03,sandwich,32.00,2
TXN-005,2024-01-03,juice,11.75,2
TXN-006,2024-01-04,coffee,7.25,1
TXN-007,2024-01-04,tea,13.50,2
TXN-008,2024-01-05,pastry,6.50,1
TXN-009,2024-01-05,coffee,21.00,3
TXN-010,2024-01-05,sandwich,15.75,1
TXN-011,2024-01-06,juice,19.00,3
TXN-012,2024-01-06,tea,5.25,1
TXN-013,2024-01-08,coffee,27.50,4
TXN-014,2024-01-08,pastry,12.00,2
TXN-015,2024-01-09,sandwich,44.00,3
TXN-016,2024-01-09,juice,8.50,1
TXN-017,2024-01-10,coffee,9.75,1
TXN-018,2024-01-10,tea,16.00,2
TXN-019,2024-01-11,pastry,23.75,4
TXN-020,2024-01-11,sandwich,28.50,2
TXN-021,2024-01-12,coffee,33.25,5
TXN-022,2024-01-12,juice,14.25,2
TXN-023,2024-01-14,tea,11.00,2
TXN-024,2024-01-15,coffee,18.00,3
TXN-025,2024-01-15,pastry,9.25,1
TXN-026,2024-01-16,sandwich,51.25,4
TXN-027,2024-01-16,juice,22.50,4
TXN-028,2024-01-17,tea,7.75,1
TXN-029,2024-01-18,coffee,12.50,2
TXN-030,2024-01-18,pastry,15.00,2
TXN-031,2024-01-19,sandwich,19.50,1
TXN-032,2024-01-19,juice,10.00,2
`;

// ---------- analytics/aggregate.awk (POSIX awk, runs under mawk) ----------
const AGGREGATE_AWK = `#!/usr/bin/awk -f
# aggregate.awk — a REAL POSIX awk program (the 1977 language, still unbeatable
# for column analytics). Reads transactions.csv and prints a per-category
# report: counts, totals, min, max, quantities, plus a grand summary.
BEGIN { FS = "," }

NR == 1 { next }        # skip the header line
NF < 5  { next }        # skip malformed lines defensively

{
  cat = $3
  amt = $4 + 0
  qty = $5 + 0

  if (!(cat in cnt)) {
    cnt[cat] = 0
    tot[cat] = 0
    qtySum[cat] = 0
    mn[cat] = amt
    mx[cat] = amt
  }
  cnt[cat]++
  tot[cat] += amt
  qtySum[cat] += qty
  if (amt < mn[cat]) mn[cat] = amt
  if (amt > mx[cat]) mx[cat] = amt

  grand += amt
  rows++
}

END {
  printf "%-10s %6s %12s %10s %10s %8s\\n", "CATEGORY", "COUNT", "TOTAL", "MIN", "MAX", "QTY"
  print "--------------------------------------------------------------"
  for (c in cnt) {
    printf "%-10s %6d %12.2f %10.2f %10.2f %8d\\n", c, cnt[c], tot[c], mn[c], mx[c], qtySum[c]
  }
  print "--------------------------------------------------------------"
  printf "%-10s %6d %12.2f\\n", "GRAND", rows, grand
}
`;

// ---------- analytics/report.pl (real Perl, writes report.html) ----------
const REPORT_PL = `#!/usr/bin/perl
# report.pl — a REAL Perl (1987) program. Reads analytics/transactions.csv and
# generates analytics/report.html: an Arabic RTL report page with a data table
# and an inline SVG bar chart (no external chart libraries — pure 1987 craft).
use strict;
use warnings;
use FindBin;

my $csv  = "$FindBin::Bin/transactions.csv";
my $html = "$FindBin::Bin/report.html";

open my $in, '<', $csv or die "cannot read $csv: $!\\n";
<$in>;    # header
my (%cnt, %tot, %qty);
my ($grand, $rows) = (0, 0);
while (my $line = <$in>) {
    chomp $line;
    next if $line =~ /^\\s*\$/;
    my ($id, $date, $cat, $amt, $qty) = split /,/, $line;
    $amt += 0;
    $qty += 0;
    $cnt{$cat}++;
    $tot{$cat} += $amt;
    $qty{$cat} += $qty;
    $grand += $amt;
    $rows++;
}
close $in;

die "no data rows found in $csv\\n" unless $rows;

my $max = 0;
for my $c (keys %tot) {
    $max = $tot{$c} if $tot{$c} > $max;
}

my $rows_html = '';
my $svg       = '';
my $y         = 14;
for my $c (sort keys %tot) {
    my $share = 100 * $tot{$c} / $grand;
    $rows_html .= sprintf(
        "<tr><td>%s</td><td>%d</td><td>%.2f</td><td>%.1f%%</td><td>%d</td></tr>\\n",
        $c, $cnt{$c}, $tot{$c}, $share, $qty{$c}
    );
    my $w = int($tot{$c} / $max * 400) + 8;
    $svg .= sprintf(
        '<rect x="0" y="%d" width="%d" height="32" rx="7" fill="#2f7cf6" opacity="0.92"></rect>',
        $y, $w
    );
    $svg .= sprintf(
        '<text x="14" y="%d" fill="#e8eefc" font-size="15" font-family="sans-serif">%s — %.2f (%.1f%%)</text>',
        $y + 21, $c, $tot{$c}, $share
    );
    $y += 46;
}
my $chart_h = $y + 6;

open my $out, '>', $html or die "cannot write $html: $!\\n";
print $out <<"HTML";
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تقرير المبيعات — مولّد Perl 1987</title>
<style>
  body { font-family: sans-serif; background: #0b1220; color: #e8eefc; margin: 0; padding: 28px; }
  h1 { color: #67a3ff; margin: 0 0 6px; }
  .meta { color: #93a4c8; font-size: 14px; margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; max-width: 760px; background: #14203a; border-radius: 12px; overflow: hidden; }
  th, td { padding: 10px 14px; text-align: start; border-bottom: 1px solid #24365e; font-size: 14px; }
  th { background: #1a2a4a; color: #9fb3c8; }
  .chart { background: #101a2e; border: 1px solid #24365e; border-radius: 12px; padding: 16px; max-width: 760px; margin-top: 26px; }
</style>
</head>
<body>
<h1>تقرير المبيعات حسب الفئة</h1>
<p class="meta">تم توليد هذا التقرير ببرنامج Perl حقيقي من $rows عملية، إجمالي $grand — بدون أي مكتبات خارجية.</p>
<table>
<thead><tr><th>الفئة</th><th>عدد العمليات</th><th>الإجمالي</th><th>الحصة</th><th>الكمية</th></tr></thead>
<tbody>
$rows_html</tbody>
</table>
<div class="chart">
<svg width="640" height="$chart_h" viewBox="0 0 640 $chart_h" role="img" aria-label="رسم بياني لأرقام الفئات">
$svg</svg>
</div>
</body>
</html>
HTML
close $out;

print "report written: $html ($rows transactions, grand total " . sprintf('%.2f', $grand) . ")\\n";
`;

// ---------- index.html (dashboard embedding the live report) ----------
const RARE_INDEX_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>نظام التحليل الكلاسيكي — AWK 1977 و Perl 1987</title>
<style>
  :root { --bg: #0b1220; --panel: #14203a; --line: #24365e; --ink: #e8eefc; --muted: #93a4c8; --brand: #2f7cf6; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: sans-serif; }
  header { padding: 26px 32px 18px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 8px; color: #67a3ff; }
  .badges { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
  .badge { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; font-size: 13px; color: var(--muted); }
  main { padding: 24px 32px; display: grid; gap: 20px; max-width: 1100px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
  .card h2 { margin: 0 0 10px; font-size: 17px; color: #67a3ff; }
  a { color: #67a3ff; }
  iframe { width: 100%; height: 760px; border: 1px solid var(--line); border-radius: 12px; background: #0d1728; }
  code { background: #1a2a4a; padding: 2px 7px; border-radius: 6px; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>نظام التحليل الكلاسيكي للمبيعات</h1>
  <p>خط تحليل كامل يعمل بوقائع برامج حقيقية بلغات قديمة لا تزال حيّة: AWK (1977) للتحليل الإحصائي و Perl (1987) لتوليد التقرير.</p>
  <div class="badges">
    <span class="badge">analytics/aggregate.awk — POSIX awk</span>
    <span class="badge">analytics/report.pl — Perl</span>
    <span class="badge">analytics/transactions.csv — 32 عملية</span>
  </div>
</header>
<main>
  <div class="card">
    <h2>التقرير الحي المولّد</h2>
    <p>الصفحة أدناه هي ناتج الأمر <code>perl analytics/report.pl</code> — جدول + رسم أعمدة SVG مضمّن:</p>
    <iframe src="analytics/report.html" title="تقرير المبيعات المولّد"></iframe>
    <p><a href="analytics/report.html">فتح التقرير في تبويب مستقل</a></p>
  </div>
  <div class="card">
    <h2>الملخص النصي من AWK</h2>
    <p>ناتج الأمر <code>awk -f analytics/aggregate.awk analytics/transactions.csv</code> محفوظ كأدلة تشغيل ضمن سجل المهمة، ويعرض إجماليات كل فئة وأصغر وأكبر عملية وعددها.</p>
  </div>
</main>
</body>
</html>
`;

const steps = [
  {
    text: 'سأبني خط تحليل كلاسيكي بلغات AWK وPerl. أولاً خطة العمل:',
    tool: {
      id: 'call-d-todo',
      name: 'todo_write',
      args: {
        todos: [
          { id: 'd1', content: 'بيانات حقيقية analytics/transactions.csv (32 عملية)', status: 'in_progress' },
          { id: 'd2', content: 'برنامج AWK حقيقي analytics/aggregate.awk', status: 'pending' },
          { id: 'd3', content: 'برنامج Perl حقيقي analytics/report.pl يولد تقرير HTML+SVG', status: 'pending' },
          { id: 'd4', content: 'تنفيذ awk ثم perl عبر run_command والتحقق من المخرجات', status: 'pending' },
          { id: 'd5', content: 'index.html يربط ويعرض التقرير', status: 'pending' },
        ],
      },
    },
  },
  {
    text: 'أولاً بيانات المبيعات الحقيقية:',
    tool: { id: 'call-d-csv', name: 'write_file', args: { path: 'analytics/transactions.csv', content: TRANSACTIONS_CSV } },
  },
  {
    text: 'ثم برنامج AWK الحقيقي للتحليل:',
    tool: { id: 'call-d-awk', name: 'write_file', args: { path: 'analytics/aggregate.awk', content: AGGREGATE_AWK } },
  },
  {
    text: 'ثم برنامج Perl الحقيقي لتوليد التقرير:',
    tool: { id: 'call-d-pl', name: 'write_file', args: { path: 'analytics/report.pl', content: REPORT_PL } },
  },
  {
    text: 'تنفيذ برنامج AWK على البيانات:',
    tool: { id: 'call-d-runawk', name: 'run_command', args: { command: 'awk -f analytics/aggregate.awk analytics/transactions.csv' } },
  },
  {
    text: 'تنفيذ برنامج Perl لتوليد التقرير:',
    tool: { id: 'call-d-runpl', name: 'run_command', args: { command: 'perl analytics/report.pl' } },
  },
  {
    text: 'أخيراً صفحة رئيسية تعرض التقرير المولّد:',
    tool: { id: 'call-d-index', name: 'write_file', args: { path: 'index.html', content: RARE_INDEX_HTML } },
  },
  {
    text: 'فحص جودة الواجهة بأداة فحص الجودة (يحتاج نافذة Electron حقيقية للبروسِل الكامل):',
    tool: { id: 'call-d-uiq', name: 'ui_quality_check', args: { path: 'index.html' } },
  },
  { text: 'RARE LANGUAGE SYSTEM COMPLETE' },
];

export const RARE_STEPS = steps;

export async function runRare() {
  const ws = freshWorkspace('rare-language');
  const t0 = Date.now();
  let results = null;
  let pass = false;
  let error = null;
  try {
    results = await drive({
      name: 'rare-language',
      prompt: PROMPT,
      steps,
      workspace: ws,
      timeoutMs: 240_000,
    });

    // --- script fully consumed; no engine errors ---
    assert.equal(results.providerExhausted.length, 0, 'fake provider script must not be exhausted');
    assert.equal(results.errors.length, 0, `no engine errors (got: ${JSON.stringify(results.errors)})`);

    // --- both run_command tool results ok:true with NON-EMPTY real output ---
    const awkCall = results.toolCalls.find((c) => c.name === 'run_command' && /awk/.test(String(c.args?.command)));
    const perlCall = results.toolCalls.find((c) => c.name === 'run_command' && /perl/.test(String(c.args?.command)));
    assert.ok(awkCall && perlCall, 'both awk and perl commands were run');

    assert.equal(awkCall.ok, true, `awk exit ok (output: ${String(awkCall.output).slice(0, 300)})`);
    assert.equal(perlCall.ok, true, `perl exit ok (output: ${String(perlCall.output).slice(0, 300)})`);
    assert.match(String(awkCall.output), /\[exit code: 0\]/, 'awk exit code 0 captured');
    assert.match(String(perlCall.output), /\[exit code: 0\]/, 'perl exit code 0 captured');

    // awk output is the REAL formatted report (category rows + grand line)
    assert.ok(String(awkCall.output).trim().length > 200, `awk output non-empty (${String(awkCall.output).length} chars)`);
    assert.match(String(awkCall.output), /CATEGORY/, 'awk report header present');
    assert.match(String(awkCall.output), /GRAND/, 'awk grand total line present');
    assert.match(String(awkCall.output), /coffee/, 'awk coffee row present');
    assert.match(String(awkCall.output), /sandwich/, 'awk sandwich row present');

    // perl output announces the generated report
    assert.match(String(perlCall.output), /report written/, 'perl announces the report file');

    // --- artifacts ---
    for (const rel of ['analytics/transactions.csv', 'analytics/aggregate.awk', 'analytics/report.pl', 'analytics/report.html', 'index.html']) {
      assert.ok(existsSync(join(ws, rel)), `file exists: ${rel}`);
    }
    const csvRows = readFileSync(join(ws, 'analytics', 'transactions.csv'), 'utf8').trim().split('\n');
    assert.ok(csvRows.length >= 31, `CSV has header + >=30 data rows (got ${csvRows.length} lines)`);
    assert.equal(csvRows[0], 'txn_id,date,category,amount,qty', 'CSV header intact');

    // --- report.html contains a table AND an inline SVG ---
    const reportHtml = readFileSync(join(ws, 'analytics', 'report.html'), 'utf8');
    assert.ok(/<table/.test(reportHtml), 'report.html contains <table');
    assert.ok(/<svg/.test(reportHtml), 'report.html contains inline <svg');
    assert.ok(/<rect/.test(reportHtml), 'SVG bar chart has rects');

    // --- the final index.html embeds/links the report ---
    const indexHtml = readFileSync(join(ws, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('analytics/report.html'), 'index.html links/embeds the report');

    // --- task_report ---
    assert.ok(results.taskReport, 'task_report emitted');
    assert.equal(results.taskReport.outcome, 'completed');
    assert.ok((results.finalText || '').includes('RARE LANGUAGE SYSTEM COMPLETE'), 'final completion marker present');

    pass = true;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const commandsRun = results ? commandsRunOf(results) : [];
    const summary = {
      scenario: 'D — rare/old languages (awk 1977 + perl 1987) with live-previewable artifact',
      pass,
      toolsUsed: results ? results.toolsUsed : [],
      commandsRun,
      taskReport: results ? results.taskReport : null,
      finalText: results ? results.finalText : null,
      providerRequests: results ? results.providerRequests.length : 0,
      durationMs: Date.now() - t0,
      note: 'LLM is SCRIPTED (fake SSE provider) — proves the REAL engine executes artifacts in genuinely different language runtimes (awk/perl via run_command) and the artifact is previewable, not model intelligence.',
      error: error ? String(error.message || error).slice(0, 2000) : null,
    };
    try {
      writeSummary('d', summary);
    } catch (e) {
      console.error('summary write failed:', e);
    }
    if (ws) {
      try {
        copyArtifacts('rare-language', ws);
      } catch (e) {
        console.error('artifact copy failed:', e);
      }
    }
  }
  return { ws, results, pass, error };
}

// Register the node:test suite only when this file runs as the test entrypoint
// (node --test tests/e2e-scenario-rare.mjs) — importing it for debugging or
// from the CLI wrapper must NOT auto-run the engine.
import { fileURLToPath as _futp } from 'node:url';
import { resolve as _resolve } from 'node:path';
const __isMain = (() => {
  try {
    return _resolve(process.argv[1] ?? '') === _futp(import.meta.url);
  } catch {
    return false;
  }
})();

if (__isMain) {
  test('scenario D: real engine runs genuine awk (1977) and perl (1987) programs', { timeout: 300_000 }, async () => {
    const { pass, error } = await runRare();
    if (error) throw error;
    assert.ok(pass, 'scenario D passed');
  });
}
