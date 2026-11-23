// E2E SCENARIO B (Task e2e-scenarios-B) — HOSPITAL MANAGEMENT SYSTEM.
// Drives the REAL SADEEM engine (electron/agent/engine.ts runAgent) with a
// scripted fake LLM (scripts/e2e/run-engine.mjs + fake-provider.mjs). The
// scripted model builds a complete Arabic RTL hospital management static web
// app through the engine's own tools:
//   todo_write → write_file index.html / css/hospital.css / js/data.js /
//   js/app.js → read_file → run_command `node --check js/app.js` → edit_file
//   (real fix) → run_command re-check → list_dir → final text.
//
// HONEST CAVEAT: the LLM is SCRIPTED — this proves the engine pipeline
// (tool dispatch, fs writes, approval gate, command execution, task_report),
// not model intelligence.
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

const PROMPT =
  'ابنِ نظام إدارة مستشفى كامل كتطبيق ويب ثابت متعدد الملفات: index.html مع لوحة تحكم وشريط تنقل جانبي ' +
  '(لوحة التحكم / المرضى / الأطباء / المواعيد / الصيدلية / الفواتير)، وواجهة عربية RTL بتصميم داكن احترافي. ' +
  'أضف js/data.js لبيانات البذر وjs/app.js لإدارة الواجهات والنماذج والجداول مع حفظ في localStorage، ' +
  'وcss/hospital.css للتنسيق. تحقق من js/app.js بأمر node --check ثم أصلح تنسيق المبالغ المالية.';

// ---------- the real fix applied via edit_file (exact strings) ----------
const FIX_OLD = `function fmtMoney(n) {
  // ملاحظة: تنسيق المبالغ — سيتم ضبط المنازل العشرية لاحقاً
  return n.toFixed(0);
}`;
const FIX_NEW = `function fmtMoney(n) {
  // الإصلاح: المبالغ المالية تعرض منزلتين عشريتين دائماً
  return Number(n || 0).toFixed(2);
}`;

// ---------- index.html ----------
const INDEX_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>سديم ميديكال — نظام إدارة المستشفى</title>
<link rel="stylesheet" href="css/hospital.css">
</head>
<body>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-logo">SM</div>
      <div class="brand-text">
        <h1>سديم ميديكال</h1>
        <p>نظام إدارة المستشفى</p>
      </div>
    </div>
    <nav class="nav" id="mainNav" aria-label="التنقل الرئيسي">
      <button class="nav-item active" data-view="dashboard">لوحة التحكم</button>
      <button class="nav-item" data-view="patients">المرضى</button>
      <button class="nav-item" data-view="doctors">الأطباء</button>
      <button class="nav-item" data-view="appointments">المواعيد</button>
      <button class="nav-item" data-view="pharmacy">الصيدلية</button>
      <button class="nav-item" data-view="billing">الفواتير</button>
    </nav>
    <div class="sidebar-footer">
      <span class="status-dot" aria-hidden="true"></span>
      وحدة المستشفى — الإصدار 1.0
    </div>
  </aside>

  <main class="main">
    <header class="topbar">
      <h2 id="viewTitle">لوحة التحكم</h2>
      <div class="topbar-actions">
        <span class="clock" id="clock">--:--</span>
        <span class="user-chip">د. إدارة النظام</span>
      </div>
    </header>

    <section id="view-dashboard" class="view active" aria-labelledby="viewTitle">
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-label">إجمالي المرضى</span><span class="stat-value" id="stat-patients">0</span></div>
        <div class="stat-card"><span class="stat-label">الأطباء</span><span class="stat-value" id="stat-doctors">0</span></div>
        <div class="stat-card"><span class="stat-label">مواعيد اليوم</span><span class="stat-value" id="stat-appointments">0</span></div>
        <div class="stat-card"><span class="stat-label">مستحقات غير مدفوعة</span><span class="stat-value" id="stat-due">0</span></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>تنبيهات مخزون الصيدلية</h3>
          <ul id="dash-lowstock" class="alert-list"></ul>
        </div>
        <div class="panel">
          <h3>أقرب المواعيد</h3>
          <table class="table">
            <thead><tr><th>المريض</th><th>الطبيب</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th></tr></thead>
            <tbody id="dash-recent"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="view-patients" class="view" aria-hidden="true">
      <div class="toolbar">
        <input type="search" id="patient-search" placeholder="بحث بالاسم أو الهاتف..." class="input">
        <button class="btn btn-primary" id="btn-add-patient">إضافة مريض</button>
      </div>
      <div class="panel">
        <table class="table">
          <thead><tr><th>الاسم</th><th>العمر</th><th>الهاتف</th><th>الجنس</th><th>التشخيص</th><th>إجراءات</th></tr></thead>
          <tbody id="patients-tbody"></tbody>
        </table>
        <p class="muted" id="patients-count">0 مريض</p>
      </div>
    </section>

    <section id="view-doctors" class="view" aria-hidden="true">
      <div class="panel">
        <table class="table">
          <thead><tr><th>الطبيب</th><th>التخصص</th><th>العيادة</th><th>الوردية</th></tr></thead>
          <tbody id="doctors-tbody"></tbody>
        </table>
        <p class="muted" id="doctors-count">0 طبيب</p>
      </div>
    </section>

    <section id="view-appointments" class="view" aria-hidden="true">
      <div class="grid-2">
        <div class="panel">
          <h3>حجز موعد جديد</h3>
          <form id="apt-form" class="form">
            <label>المريض <select id="apt-patient" class="input" required></select></label>
            <label>الطبيب <select id="apt-doctor" class="input" required></select></label>
            <label>التاريخ <input type="date" id="apt-date" class="input" required></label>
            <div class="slots" id="apt-slots" aria-label="الأوقات المتاحة"></div>
            <label>سبب الزيارة <input type="text" id="apt-reason" class="input" placeholder="متابعة، كشف، طوارئ..."></label>
            <button type="submit" class="btn btn-primary">تأكيد الحجز</button>
          </form>
        </div>
        <div class="panel">
          <div class="toolbar">
            <select id="apt-status-filter" class="input">
              <option value="all">كل الحالات</option>
              <option value="مؤكد">مؤكد</option>
              <option value="معلق">معلق</option>
              <option value="ملغي">ملغي</option>
            </select>
          </div>
          <table class="table">
            <thead><tr><th>المريض</th><th>الطبيب</th><th>التاريخ</th><th>الوقت</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody id="appointments-tbody"></tbody>
          </table>
          <p class="muted" id="appointments-count">0 موعد</p>
        </div>
      </div>
    </section>

    <section id="view-pharmacy" class="view" aria-hidden="true">
      <div class="toolbar">
        <input type="search" id="pharma-search" placeholder="بحث في الأدوية..." class="input">
      </div>
      <div class="panel">
        <table class="table">
          <thead><tr><th>الدواء</th><th>التصنيف</th><th>السعر</th><th>الكمية</th><th>الحالة</th></tr></thead>
          <tbody id="pharmacy-tbody"></tbody>
        </table>
        <p class="muted" id="pharmacy-count">0 صنف</p>
      </div>
    </section>

    <section id="view-billing" class="view" aria-hidden="true">
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-label">إجمالي الفواتير</span><span class="stat-value" id="bill-total">0</span></div>
        <div class="stat-card"><span class="stat-label">المحصّل</span><span class="stat-value" id="bill-paid">0</span></div>
        <div class="stat-card"><span class="stat-label">المتأخرات</span><span class="stat-value" id="bill-due">0</span></div>
      </div>
      <div class="toolbar">
        <select id="bill-status-filter" class="input">
          <option value="all">كل الفواتير</option>
          <option value="paid">مدفوعة</option>
          <option value="unpaid">غير مدفوعة</option>
        </select>
      </div>
      <div class="panel">
        <table class="table">
          <thead><tr><th>المريض</th><th>الوصف</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead>
          <tbody id="billing-tbody"></tbody>
        </table>
        <p class="muted" id="billing-count">0 فاتورة</p>
      </div>
    </section>
  </main>
</div>

<div class="modal-backdrop" id="modalBackdrop" hidden>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h3 id="modal-title">إضافة مريض</h3>
    <form id="patient-form" class="form">
      <input type="hidden" id="p-id">
      <label>الاسم الكامل <input type="text" id="p-name" class="input" required></label>
      <div class="form-row">
        <label>العمر <input type="number" id="p-age" class="input" min="0" max="120" required></label>
        <label>الجنس
          <select id="p-gender" class="input"><option>ذكر</option><option>أنثى</option></select>
        </label>
      </div>
      <label>الهاتف <input type="tel" id="p-phone" class="input" required></label>
      <label>التشخيص المبدئي <input type="text" id="p-diagnosis" class="input"></label>
      <div class="form-actions">
        <button type="button" class="btn" id="btn-modal-cancel">إلغاء</button>
        <button type="submit" class="btn btn-primary">حفظ</button>
      </div>
    </form>
  </div>
</div>

<div class="toast" id="toast" hidden></div>

<script src="js/data.js"></script>
<script src="js/app.js"></script>
</body>
</html>
`;

// ---------- css/hospital.css ----------
const HOSPITAL_CSS = `/* hospital.css — نظام إدارة المستشفى | تصميم داكن احترافي RTL */
:root {
  --bg: #0b1220;
  --bg-soft: #101a2e;
  --panel: #14203a;
  --panel-2: #1a2a4a;
  --line: #24365e;
  --text: #e8eefc;
  --muted: #93a4c8;
  --brand: #2f7cf6;
  --brand-2: #67a3ff;
  --ok: #2fbf71;
  --warn: #f2b036;
  --danger: #e5484d;
  --radius: 14px;
  --shadow: 0 10px 30px rgba(3, 10, 25, 0.45);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "Cairo", "Segoe UI", Tahoma, sans-serif;
  background: linear-gradient(160deg, var(--bg), var(--bg-soft));
  color: var(--text);
  min-height: 100vh;
}

.app-shell { display: flex; min-height: 100vh; }

/* ---------- الشريط الجانبي ---------- */
.sidebar {
  width: 250px;
  background: var(--panel);
  border-inline-start: none;
  border-inline-end: 1px solid var(--line);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.brand { display: flex; align-items: center; gap: 12px; }
.brand-logo {
  width: 44px; height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  display: grid; place-items: center;
  font-weight: 800; color: #fff;
}
.brand-text h1 { margin: 0; font-size: 17px; }
.brand-text p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }

.nav { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.nav-item {
  text-align: start;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover { background: var(--panel-2); color: var(--text); }
.nav-item.active {
  background: linear-gradient(135deg, rgba(47, 124, 246, 0.25), rgba(103, 163, 255, 0.12));
  border-color: var(--line);
  color: #fff;
  font-weight: 700;
}

.sidebar-footer {
  font-size: 12px;
  color: var(--muted);
  display: flex; align-items: center; gap: 8px;
}
.status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); display: inline-block; }

/* ---------- المحتوى الرئيسي ---------- */
.main { flex: 1; padding: 20px 26px; display: flex; flex-direction: column; gap: 18px; }

.topbar {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px 18px;
  box-shadow: var(--shadow);
}
.topbar h2 { margin: 0; font-size: 19px; }
.topbar-actions { display: flex; align-items: center; gap: 12px; }
.clock { font-variant-numeric: tabular-nums; color: var(--brand-2); font-size: 14px; }
.user-chip {
  background: var(--panel-2);
  border: 1px solid var(--line);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
}

/* ---------- الواجهات ---------- */
.view { display: none; flex-direction: column; gap: 16px; }
.view.active { display: flex; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.stat-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
  display: flex; flex-direction: column; gap: 6px;
  box-shadow: var(--shadow);
}
.stat-label { color: var(--muted); font-size: 13px; }
.stat-value { font-size: 26px; font-weight: 800; color: #fff; }

.grid-2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 14px; }

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
}
.panel h3 { margin: 0 0 12px; font-size: 15px; color: var(--brand-2); }

.alert-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.alert-list li {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  display: flex; justify-content: space-between;
}

/* ---------- الجداول ---------- */
.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.table th, .table td { padding: 10px 12px; text-align: start; border-bottom: 1px solid var(--line); }
.table th { color: var(--muted); font-weight: 600; background: rgba(26, 42, 74, 0.5); }
.table tbody tr:hover { background: rgba(47, 124, 246, 0.08); }
.muted { color: var(--muted); font-size: 12.5px; margin: 10px 2px 0; }

/* ---------- الشارات ---------- */
.badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; border: 1px solid transparent; }
.badge-ok { background: rgba(47, 191, 113, 0.15); color: var(--ok); border-color: rgba(47, 191, 113, 0.4); }
.badge-low { background: rgba(242, 176, 54, 0.15); color: var(--warn); border-color: rgba(242, 176, 54, 0.4); }
.badge-out { background: rgba(229, 72, 77, 0.15); color: var(--danger); border-color: rgba(229, 72, 77, 0.45); }
.badge-neutral { background: var(--panel-2); color: var(--muted); border-color: var(--line); }

/* ---------- الأزرار والحقول ---------- */
.btn {
  font: inherit; font-size: 13.5px;
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
  transition: filter 0.15s;
}
.btn:hover { filter: brightness(1.15); }
.btn-primary { background: linear-gradient(135deg, var(--brand), var(--brand-2)); border-color: transparent; color: #fff; font-weight: 700; }
.btn-danger { background: rgba(229, 72, 77, 0.15); color: var(--danger); border-color: rgba(229, 72, 77, 0.45); }
.btn-small { padding: 5px 10px; font-size: 12px; border-radius: 8px; }

.input {
  font: inherit;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 10px;
  padding: 9px 12px;
  outline: none;
}
.input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(47, 124, 246, 0.2); }

.toolbar { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.toolbar .input { flex: 1; max-width: 340px; }

/* ---------- النماذج ---------- */
.form { display: flex; flex-direction: column; gap: 12px; }
.form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-actions { display: flex; gap: 10px; justify-content: flex-start; }

.slots { display: flex; flex-wrap: wrap; gap: 8px; }
.slot {
  font: inherit; font-size: 13px;
  padding: 7px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--bg-soft);
  color: var(--muted);
  cursor: pointer;
}
.slot.selected { background: var(--brand); color: #fff; border-color: var(--brand); }
.slot:disabled { opacity: 0.35; cursor: not-allowed; }

/* ---------- النافذة المنبثقة ---------- */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(4, 9, 20, 0.7);
  display: grid; place-items: center;
  z-index: 50;
}
.modal {
  width: min(480px, 92vw);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: var(--shadow);
}
.modal h3 { margin: 0 0 14px; }

/* ---------- التنبيه العائم ---------- */
.toast {
  position: fixed;
  bottom: 22px; inset-inline-start: 22px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-inline-start: 4px solid var(--ok);
  border-radius: 12px;
  padding: 12px 18px;
  font-size: 14px;
  box-shadow: var(--shadow);
  z-index: 60;
}

/* ---------- الاستجابة ---------- */
@media (max-width: 900px) {
  .app-shell { flex-direction: column; }
  .sidebar { width: 100%; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .grid-2 { grid-template-columns: 1fr; }
}
`;

// ---------- js/data.js ----------
const DATA_JS = `'use strict';
/* data.js — نظام إدارة المستشفى: بيانات البذر + طبقة التخزين المحلي */

var STORAGE_KEY = 'sadeem-hospital-v1';

var SEED_PATIENTS = [
  { id: 'p1', name: 'أحمد المصري', age: 54, phone: '0100-123-4567', gender: 'ذكر', diagnosis: 'ارتفاع ضغط الدم', registeredAt: '2024-01-08' },
  { id: 'p2', name: 'فاطمة الزهراء', age: 33, phone: '0111-456-7890', gender: 'أنثى', diagnosis: 'حساسية صدرية', registeredAt: '2024-01-09' },
  { id: 'p3', name: 'محمد العنسي', age: 71, phone: '0122-234-5678', gender: 'ذكر', diagnosis: 'سكري النوع الثاني', registeredAt: '2024-01-10' },
  { id: 'p4', name: 'ليلى حسن', age: 27, phone: '0128-987-6543', gender: 'أنثى', diagnosis: 'شقيقة نصية', registeredAt: '2024-01-11' },
  { id: 'p5', name: 'عمر بن خالد', age: 45, phone: '0105-333-2211', gender: 'ذكر', diagnosis: 'التهاب مفاصل', registeredAt: '2024-01-12' },
  { id: 'p6', name: 'نورة السالم', age: 62, phone: '0113-777-8899', gender: 'أنثى', diagnosis: 'ضعف عضلي', registeredAt: '2024-01-13' },
  { id: 'p7', name: 'يوسف الشامي', age: 8, phone: '0106-555-4433', gender: 'ذكر', diagnosis: 'نزلة معوية', registeredAt: '2024-01-14' },
  { id: 'p8', name: 'هند العمري', age: 39, phone: '0110-222-1122', gender: 'أنثى', diagnosis: 'فقر دم', registeredAt: '2024-01-15' }
];

var SEED_DOCTORS = [
  { id: 'd1', name: 'د. سارة عبد الله', specialty: 'باطنة', room: '101', shift: 'صباحي' },
  { id: 'd2', name: 'د. خالد المنصور', specialty: 'قلب وأوعية', room: '204', shift: 'صباحي' },
  { id: 'd3', name: 'د. مريم القحطاني', specialty: 'أطفال', room: '108', shift: 'مسائي' },
  { id: 'd4', name: 'د. طارق حسين', specialty: 'عظام', room: '310', shift: 'مسائي' },
  { id: 'd5', name: 'د. ريم الفهد', specialty: 'جلدية', room: '115', shift: 'صباحي' }
];

var SEED_APPOINTMENTS = [
  { id: 'a1', patientId: 'p1', doctorId: 'd2', date: '2024-01-16', time: '09:00', reason: 'متابعة ضغط', status: 'مؤكد' },
  { id: 'a2', patientId: 'p2', doctorId: 'd1', date: '2024-01-16', time: '10:00', reason: 'كشف حساسية', status: 'مؤكد' },
  { id: 'a3', patientId: 'p3', doctorId: 'd1', date: '2024-01-17', time: '09:30', reason: 'متابعة سكري', status: 'معلق' },
  { id: 'a4', patientId: 'p4', doctorId: 'd1', date: '2024-01-17', time: '11:00', reason: 'شقيقة متكررة', status: 'مؤكد' },
  { id: 'a5', patientId: 'p5', doctorId: 'd4', date: '2024-01-18', time: '13:00', reason: 'ألم ركبة', status: 'معلق' },
  { id: 'a6', patientId: 'p6', doctorId: 'd2', date: '2024-01-18', time: '10:30', reason: 'استشارة قلبية', status: 'مؤكد' },
  { id: 'a7', patientId: 'p7', doctorId: 'd3', date: '2024-01-19', time: '14:00', reason: 'متابعة معوية', status: 'مؤكد' },
  { id: 'a8', patientId: 'p8', doctorId: 'd1', date: '2024-01-19', time: '15:00', reason: 'تحليل دم', status: 'ملغي' },
  { id: 'a9', patientId: 'p1', doctorId: 'd5', date: '2024-01-20', time: '09:30', reason: 'طفح جلدي', status: 'معلق' },
  { id: 'a10', patientId: 'p3', doctorId: 'd4', date: '2024-01-20', time: '16:30', reason: 'ألم أسفل الظهر', status: 'مؤكد' }
];

var SEED_PHARMACY = [
  { id: 'm1', name: 'أموكسيسيلين 500mg', category: 'مضاد حيوي', price: 45.5, qty: 60 },
  { id: 'm2', name: 'باراسيتامول 1g', category: 'مسكن', price: 12, qty: 8 },
  { id: 'm3', name: 'ميتفورمين 850mg', category: 'سكري', price: 38, qty: 45 },
  { id: 'm4', name: 'أوتينول 50mg', category: 'قلب', price: 55.25, qty: 30 },
  { id: 'm5', name: 'فنتولين بخاخ', category: 'تنفس', price: 72, qty: 0 },
  { id: 'm6', name: 'أوميبرازول 20mg', category: 'جهاز هضمي', price: 29.75, qty: 15 },
  { id: 'm7', name: 'لوراتادين 10mg', category: 'مضاد هيستامين', price: 18, qty: 90 },
  { id: 'm8', name: 'إيبوبروفين 400mg', category: 'مسكن', price: 15.5, qty: 3 },
  { id: 'm9', name: 'شراب فيتامين د', category: 'مكمل', price: 60, qty: 22 },
  { id: 'm10', name: 'أموكسيسيلين 1g (وريدي)', category: 'مضاد حيوي', price: 110, qty: 0 }
];

var SEED_INVOICES = [
  { id: 'i1', patientId: 'p1', desc: 'استشارة قلب + مخطط صدى', amount: 520, paid: true, issuedAt: '2024-01-09' },
  { id: 'i2', patientId: 'p2', desc: 'كشف باطنة + تحاليل', amount: 340, paid: true, issuedAt: '2024-01-10' },
  { id: 'i3', patientId: 'p3', desc: 'تحليل سكر تراكمي', amount: 180, paid: false, issuedAt: '2024-01-11' },
  { id: 'i4', patientId: 'p4', desc: 'استشارة عصبية', amount: 450, paid: false, issuedAt: '2024-01-12' },
  { id: 'i5', patientId: 'p5', desc: 'أشعة ركبة + علاج طبيعي', amount: 610, paid: true, issuedAt: '2024-01-13' },
  { id: 'i6', patientId: 'p6', desc: 'استشارة قلبية + تخطيط', amount: 490, paid: false, issuedAt: '2024-01-14' },
  { id: 'i7', patientId: 'p7', desc: 'كشف أطفال', amount: 220, paid: true, issuedAt: '2024-01-15' },
  { id: 'i8', patientId: 'p8', desc: 'تحليل CBC + حديد', amount: 260, paid: false, issuedAt: '2024-01-16' }
];

/** قراءة الحالة من localStorage مع الرجوع لبيانات البذر. */
function loadData() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.patients && parsed.doctors) return parsed;
    }
  } catch (e) {
    // التخزين غير متاح (وضع خاص) — نكمل بذاكرة مؤقتة
  }
  return seedState();
}

/** حفظ الحالة في localStorage (أفضل جهد). */
function saveData(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // تجاهل: الوضع الخاص أو الامتلاء
  }
}

function seedState() {
  return {
    patients: SEED_PATIENTS.slice(),
    doctors: SEED_DOCTORS.slice(),
    appointments: SEED_APPOINTMENTS.slice(),
    pharmacy: SEED_PHARMACY.slice(),
    invoices: SEED_INVOICES.slice()
  };
}
`;

// ---------- js/app.js (>= 350 lines) ----------
const APP_JS = `'use strict';
/* app.js — نظام إدارة المستشفى: التوجيه، المرضى، الأطباء، المواعيد،
   الصيدلية، الفواتير، البحث والفلاتر، والتخزين المحلي. */

// ---------- أدوات مساعدة عامة ----------
function qs(sel, root) {
  return (root || document).querySelector(sel);
}

function qsa(sel, root) {
  return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

${FIX_OLD}

function fmtDate(iso) {
  if (!iso) return '';
  var parts = String(iso).split('-');
  if (parts.length !== 3) return String(iso);
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000);
}

function todayISO() {
  var d = new Date();
  var m = String(d.getMonth() + 1);
  var day = String(d.getDate());
  if (m.length < 2) m = '0' + m;
  if (day.length < 2) day = '0' + day;
  return d.getFullYear() + '-' + m + '-' + day;
}

var toastTimer = null;
function toast(msg) {
  var t = qs('#toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
}

// ---------- الحالة والتخزين ----------
var state = loadData();

function persist() {
  saveData(state);
}

function byId(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

function patientName(id) {
  var p = byId(state.patients, id);
  return p ? p.name : '—';
}

function doctorName(id) {
  var d = byId(state.doctors, id);
  return d ? d.name : '—';
}

// ---------- التوجيه بين الواجهات ----------
var VIEW_TITLES = {
  dashboard: 'لوحة التحكم',
  patients: 'المرضى',
  doctors: 'الأطباء',
  appointments: 'المواعيد',
  pharmacy: 'الصيدلية',
  billing: 'الفواتير'
};

var currentView = 'dashboard';

function showView(name) {
  if (!VIEW_TITLES[name]) name = 'dashboard';
  currentView = name;
  qsa('.view').forEach(function (v) {
    var active = v.id === 'view-' + name;
    v.classList.toggle('active', active);
    v.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  qsa('#mainNav .nav-item').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-view') === name);
  });
  var title = qs('#viewTitle');
  if (title) title.textContent = VIEW_TITLES[name];
  renderCurrent();
}

function bindNav() {
  qsa('#mainNav .nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showView(btn.getAttribute('data-view'));
    });
  });
}

function renderCurrent() {
  renderDashboard();
  renderPatients();
  renderDoctors();
  renderAppointments();
  renderPharmacy();
  renderBilling();
}

// ---------- لوحة التحكم ----------
var LOW_STOCK = 10;

function renderDashboard() {
  var sp = qs('#stat-patients');
  var sd = qs('#stat-doctors');
  var sa = qs('#stat-appointments');
  var sDue = qs('#stat-due');
  if (!sp) return;

  sp.textContent = String(state.patients.length);
  sd.textContent = String(state.doctors.length);

  var today = todayISO();
  var todays = state.appointments.filter(function (a) { return a.date === today && a.status !== 'ملغي'; });
  sa.textContent = String(todays.length);

  var due = 0;
  state.invoices.forEach(function (inv) {
    if (!inv.paid) due += Number(inv.amount) || 0;
  });
  sDue.textContent = fmtMoney(due);

  var lowItems = state.pharmacy.filter(function (m) { return m.qty <= LOW_STOCK; });
  var list = qs('#dash-lowstock');
  if (list) {
    list.innerHTML = '';
    if (lowItems.length === 0) {
      list.appendChild(el('li', 'muted', 'المخزون في المستويات الآمنة'));
    }
    lowItems.forEach(function (m) {
      var li = el('li', '', '');
      var nameSpan = el('span', '', m.name);
      var qtyBadge = el('span', 'badge ' + stockClass(m.qty), stockLabel(m.qty) + ' (' + m.qty + ')');
      li.appendChild(nameSpan);
      li.appendChild(qtyBadge);
      list.appendChild(li);
    });
  }

  var upcoming = state.appointments
    .filter(function (a) { return a.status !== 'ملغي'; })
    .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
    .slice(0, 5);
  var tbody = qs('#dash-recent');
  if (tbody) {
    tbody.innerHTML = '';
    upcoming.forEach(function (a) {
      var tr = el('tr', '', '');
      tr.appendChild(el('td', '', patientName(a.patientId)));
      tr.appendChild(el('td', '', doctorName(a.doctorId)));
      tr.appendChild(el('td', '', fmtDate(a.date)));
      tr.appendChild(el('td', '', a.time));
      var tdStatus = el('td', '', '');
      tdStatus.appendChild(el('span', 'badge badge-neutral', a.status));
      tr.appendChild(tdStatus);
      tbody.appendChild(tr);
    });
    if (upcoming.length === 0) {
      var empty = el('tr', '', '');
      var td = el('td', 'muted', 'لا توجد مواعيد قادمة');
      td.colSpan = 5;
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
  }
}

// ---------- المرضى (CRUD) ----------
var patientSearch = '';

function patientRow(p) {
  var tr = el('tr', '', '');
  tr.appendChild(el('td', '', p.name));
  tr.appendChild(el('td', '', String(p.age)));
  tr.appendChild(el('td', '', p.phone));
  tr.appendChild(el('td', '', p.gender));
  tr.appendChild(el('td', '', p.diagnosis || '—'));

  var tdActions = el('td', '', '');
  var editBtn = el('button', 'btn btn-small', 'تعديل');
  editBtn.addEventListener('click', function () { openPatientModal(p.id); });
  var delBtn = el('button', 'btn btn-small btn-danger', 'حذف');
  delBtn.addEventListener('click', function () { deletePatient(p.id); });
  tdActions.appendChild(editBtn);
  tdActions.appendChild(document.createTextNode(' '));
  tdActions.appendChild(delBtn);
  tr.appendChild(tdActions);
  return tr;
}

function renderPatients() {
  var tbody = qs('#patients-tbody');
  if (!tbody) return;
  var term = patientSearch.trim().toLowerCase();
  var rows = state.patients.filter(function (p) {
    if (!term) return true;
    return p.name.toLowerCase().indexOf(term) >= 0 || String(p.phone).indexOf(term) >= 0;
  });
  tbody.innerHTML = '';
  rows.forEach(function (p) { tbody.appendChild(patientRow(p)); });
  if (rows.length === 0) {
    var empty = el('tr', '', '');
    var td = el('td', 'muted', 'لا نتائج مطابقة');
    td.colSpan = 6;
    empty.appendChild(td);
    tbody.appendChild(empty);
  }
  var count = qs('#patients-count');
  if (count) count.textContent = rows.length + ' مريض';
}

function openPatientModal(id) {
  var backdrop = qs('#modalBackdrop');
  var form = qs('#patient-form');
  if (!backdrop || !form) return;
  var p = id ? byId(state.patients, id) : null;
  qs('#modal-title').textContent = p ? 'تعديل بيانات المريض' : 'إضافة مريض';
  qs('#p-id').value = p ? p.id : '';
  qs('#p-name').value = p ? p.name : '';
  qs('#p-age').value = p ? p.age : '';
  qs('#p-gender').value = p ? p.gender : 'ذكر';
  qs('#p-phone').value = p ? p.phone : '';
  qs('#p-diagnosis').value = p && p.diagnosis ? p.diagnosis : '';
  backdrop.hidden = false;
  qs('#p-name').focus();
}

function closePatientModal() {
  var backdrop = qs('#modalBackdrop');
  if (backdrop) backdrop.hidden = true;
}

function savePatientFromForm(e) {
  e.preventDefault();
  var id = qs('#p-id').value;
  var data = {
    name: qs('#p-name').value.trim(),
    age: parseInt(qs('#p-age').value, 10) || 0,
    gender: qs('#p-gender').value,
    phone: qs('#p-phone').value.trim(),
    diagnosis: qs('#p-diagnosis').value.trim()
  };
  if (!data.name) {
    toast('الاسم مطلوب');
    return;
  }
  if (id) {
    var existing = byId(state.patients, id);
    if (existing) {
      Object.keys(data).forEach(function (k) { existing[k] = data[k]; });
      toast('تم تحديث بيانات المريض');
    }
  } else {
    var fresh = { id: uid('p'), registeredAt: todayISO() };
    Object.keys(data).forEach(function (k) { fresh[k] = data[k]; });
    state.patients.push(fresh);
    toast('تمت إضافة المريض');
  }
  persist();
  closePatientModal();
  renderCurrent();
}

function deletePatient(id) {
  var p = byId(state.patients, id);
  if (!p) return;
  if (!window.confirm('حذف المريض: ' + p.name + '؟')) return;
  state.patients = state.patients.filter(function (x) { return x.id !== id; });
  state.appointments = state.appointments.filter(function (a) { return a.patientId !== id; });
  persist();
  renderCurrent();
  toast('تم حذف المريض');
}

// ---------- الأطباء ----------
function renderDoctors() {
  var tbody = qs('#doctors-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  state.doctors.forEach(function (d) {
    var tr = el('tr', '', '');
    tr.appendChild(el('td', '', d.name));
    tr.appendChild(el('td', '', d.specialty));
    tr.appendChild(el('td', '', 'عيادة ' + d.room));
    var tdShift = el('td', '', '');
    tdShift.appendChild(el('span', 'badge badge-neutral', d.shift));
    tr.appendChild(tdShift);
    tbody.appendChild(tr);
  });
  var count = qs('#doctors-count');
  if (count) count.textContent = state.doctors.length + ' طبيب';
}

// ---------- المواعيد ----------
var SLOT_TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30'];
var selectedSlot = null;
var aptStatusFilter = 'all';

function fillPatientOptions() {
  var sel = qs('#apt-patient');
  if (!sel) return;
  sel.innerHTML = '';
  state.patients.forEach(function (p) {
    var opt = el('option', '', p.name);
    opt.value = p.id;
    sel.appendChild(opt);
  });
}

function fillDoctorOptions() {
  var sel = qs('#apt-doctor');
  if (!sel) return;
  sel.innerHTML = '';
  state.doctors.forEach(function (d) {
    var opt = el('option', '', d.name + ' — ' + d.specialty);
    opt.value = d.id;
    sel.appendChild(opt);
  });
  renderSlots();
}

function renderSlots() {
  var wrap = qs('#apt-slots');
  if (!wrap) return;
  var doctorSel = qs('#apt-doctor');
  var dateVal = qs('#apt-date').value;
  wrap.innerHTML = '';
  selectedSlot = null;
  var booked = state.appointments
    .filter(function (a) {
      return a.status !== 'ملغي' && a.date === dateVal && doctorSel && a.doctorId === doctorSel.value;
    })
    .map(function (a) { return a.time; });
  SLOT_TIMES.forEach(function (t) {
    var taken = booked.indexOf(t) >= 0;
    var btn = el('button', 'slot' + (taken ? ' taken' : ''), t);
    btn.type = 'button';
    btn.disabled = taken || !dateVal;
    btn.addEventListener('click', function () {
      qsa('.slot', wrap).forEach(function (s) { s.classList.remove('selected'); });
      btn.classList.add('selected');
      selectedSlot = t;
    });
    wrap.appendChild(btn);
  });
  if (!dateVal) {
    var hint = el('span', 'muted', 'اختر التاريخ أولاً لعرض الأوقات المتاحة');
    wrap.appendChild(hint);
  }
}

function renderAppointments() {
  var tbody = qs('#appointments-tbody');
  if (!tbody) return;
  var rows = state.appointments.filter(function (a) {
    return aptStatusFilter === 'all' || a.status === aptStatusFilter;
  });
  tbody.innerHTML = '';
  rows.forEach(function (a) {
    var tr = el('tr', '', '');
    tr.appendChild(el('td', '', patientName(a.patientId)));
    tr.appendChild(el('td', '', doctorName(a.doctorId)));
    tr.appendChild(el('td', '', fmtDate(a.date)));
    tr.appendChild(el('td', '', a.time));
    tr.appendChild(el('td', '', a.reason || '—'));
    var tdStatus = el('td', '', '');
    tdStatus.appendChild(el('span', 'badge badge-neutral', a.status));
    tr.appendChild(tdStatus);
    var tdActions = el('td', '', '');
    if (a.status !== 'ملغي') {
      var cancelBtn = el('button', 'btn btn-small btn-danger', 'إلغاء');
      cancelBtn.addEventListener('click', function () { setAppointmentStatus(a.id, 'ملغي'); });
      tdActions.appendChild(cancelBtn);
    }
    if (a.status === 'معلق') {
      var confirmBtn = el('button', 'btn btn-small', 'تأكيد');
      confirmBtn.addEventListener('click', function () { setAppointmentStatus(a.id, 'مؤكد'); });
      tdActions.appendChild(confirmBtn);
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    var empty = el('tr', '', '');
    var td = el('td', 'muted', 'لا توجد مواعيد مطابقة');
    td.colSpan = 7;
    empty.appendChild(td);
    tbody.appendChild(empty);
  }
  var count = qs('#appointments-count');
  if (count) count.textContent = rows.length + ' موعد';
}

function bookAppointmentFromForm(e) {
  e.preventDefault();
  var patientId = qs('#apt-patient').value;
  var doctorId = qs('#apt-doctor').value;
  var date = qs('#apt-date').value;
  var reason = qs('#apt-reason').value.trim();
  if (!patientId || !doctorId || !date) {
    toast('أكمل بيانات الحجز أولاً');
    return;
  }
  if (!selectedSlot) {
    toast('اختر الوقت المتاح من الأزرار');
    return;
  }
  state.appointments.push({
    id: uid('a'),
    patientId: patientId,
    doctorId: doctorId,
    date: date,
    time: selectedSlot,
    reason: reason,
    status: 'مؤكد'
  });
  persist();
  qs('#apt-reason').value = '';
  renderCurrent();
  toast('تم حجز الموعد ' + date + ' الساعة ' + selectedSlot);
}

function setAppointmentStatus(id, status) {
  var a = byId(state.appointments, id);
  if (!a) return;
  a.status = status;
  persist();
  renderCurrent();
  toast('تم تحديث حالة الموعد إلى: ' + status);
}

// ---------- الصيدلية ----------
function stockClass(qty) {
  if (Number(qty) === 0) return 'badge-out';
  if (Number(qty) <= LOW_STOCK) return 'badge-low';
  return 'badge-ok';
}

function stockLabel(qty) {
  if (Number(qty) === 0) return 'نافد';
  if (Number(qty) <= LOW_STOCK) return 'منخفض';
  return 'متوفر';
}

var pharmaSearch = '';

function renderPharmacy() {
  var tbody = qs('#pharmacy-tbody');
  if (!tbody) return;
  var term = pharmaSearch.trim().toLowerCase();
  var rows = state.pharmacy.filter(function (m) {
    if (!term) return true;
    return (m.name + ' ' + m.category).toLowerCase().indexOf(term) >= 0;
  });
  tbody.innerHTML = '';
  rows.forEach(function (m) {
    var tr = el('tr', '', '');
    tr.appendChild(el('td', '', m.name));
    tr.appendChild(el('td', '', m.category));
    tr.appendChild(el('td', '', fmtMoney(m.price)));
    tr.appendChild(el('td', '', String(m.qty)));
    var tdStock = el('td', '', '');
    tdStock.appendChild(el('span', 'badge ' + stockClass(m.qty), stockLabel(m.qty)));
    tr.appendChild(tdStock);
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    var empty = el('tr', '', '');
    var td = el('td', 'muted', 'لا نتائج مطابقة');
    td.colSpan = 5;
    empty.appendChild(td);
    tbody.appendChild(empty);
  }
  var count = qs('#pharmacy-count');
  if (count) count.textContent = rows.length + ' صنف';
}

// ---------- الفواتير ----------
var billFilter = 'all';

function renderBilling() {
  var tbody = qs('#billing-tbody');
  if (!tbody) return;
  var rows = state.invoices.filter(function (inv) {
    if (billFilter === 'all') return true;
    if (billFilter === 'paid') return inv.paid;
    return !inv.paid;
  });
  tbody.innerHTML = '';
  rows.forEach(function (inv) {
    var tr = el('tr', '', '');
    tr.appendChild(el('td', '', patientName(inv.patientId)));
    tr.appendChild(el('td', '', inv.desc));
    tr.appendChild(el('td', '', fmtMoney(inv.amount)));
    tr.appendChild(el('td', '', fmtDate(inv.issuedAt)));
    var tdStatus = el('td', '', '');
    tdStatus.appendChild(el('span', 'badge ' + (inv.paid ? 'badge-ok' : 'badge-out'), inv.paid ? 'مدفوعة' : 'غير مدفوعة'));
    tr.appendChild(tdStatus);
    var tdActions = el('td', '', '');
    if (!inv.paid) {
      var payBtn = el('button', 'btn btn-small', 'تسجيل الدفع');
      payBtn.addEventListener('click', function () { markInvoicePaid(inv.id); });
      tdActions.appendChild(payBtn);
    }
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
  var total = 0;
  var paid = 0;
  state.invoices.forEach(function (inv) {
    total += Number(inv.amount) || 0;
    if (inv.paid) paid += Number(inv.amount) || 0;
  });
  var tTotal = qs('#bill-total');
  var tPaid = qs('#bill-paid');
  var tDue = qs('#bill-due');
  if (tTotal) tTotal.textContent = fmtMoney(total);
  if (tPaid) tPaid.textContent = fmtMoney(paid);
  if (tDue) tDue.textContent = fmtMoney(total - paid);
  var count = qs('#billing-count');
  if (count) count.textContent = rows.length + ' فاتورة';
}

function markInvoicePaid(id) {
  var inv = byId(state.invoices, id);
  if (!inv) return;
  inv.paid = true;
  persist();
  renderCurrent();
  toast('تم تسجيل دفع الفاتورة');
}

// ---------- البحث والفلاتر ----------
function bindSearch() {
  var pSearch = qs('#patient-search');
  if (pSearch) {
    pSearch.addEventListener('input', function () {
      patientSearch = pSearch.value;
      renderPatients();
    });
  }
  var mSearch = qs('#pharma-search');
  if (mSearch) {
    mSearch.addEventListener('input', function () {
      pharmaSearch = mSearch.value;
      renderPharmacy();
    });
  }
  var aptFilter = qs('#apt-status-filter');
  if (aptFilter) {
    aptFilter.addEventListener('change', function () {
      aptStatusFilter = aptFilter.value;
      renderAppointments();
    });
  }
  var billSel = qs('#bill-status-filter');
  if (billSel) {
    billSel.addEventListener('change', function () {
      billFilter = billSel.value;
      renderBilling();
    });
  }
}

// ---------- الساعة ----------
function startClock() {
  var clock = qs('#clock');
  if (!clock) return;
  function tick() {
    var d = new Date();
    var h = String(d.getHours());
    var m = String(d.getMinutes());
    if (h.length < 2) h = '0' + h;
    if (m.length < 2) m = '0' + m;
    clock.textContent = h + ':' + m;
  }
  tick();
  setInterval(tick, 15000);
}

// ---------- الإقلاع ----------
function bindForms() {
  var addBtn = qs('#btn-add-patient');
  if (addBtn) addBtn.addEventListener('click', function () { openPatientModal(null); });
  var cancelBtn = qs('#btn-modal-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closePatientModal);
  var backdrop = qs('#modalBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closePatientModal();
    });
  }
  var pForm = qs('#patient-form');
  if (pForm) pForm.addEventListener('submit', savePatientFromForm);
  var aForm = qs('#apt-form');
  if (aForm) aForm.addEventListener('submit', bookAppointmentFromForm);
  var dateInput = qs('#apt-date');
  if (dateInput) dateInput.addEventListener('change', renderSlots);
  var docSel = qs('#apt-doctor');
  if (docSel) docSel.addEventListener('change', renderSlots);
}

function init() {
  bindNav();
  bindForms();
  bindSearch();
  var dateInput = qs('#apt-date');
  if (dateInput && !dateInput.value) dateInput.value = todayISO();
  fillPatientOptions();
  fillDoctorOptions();
  showView('dashboard');
  startClock();
}

document.addEventListener('DOMContentLoaded', init);
`;

// ---------- the scripted model turns ----------
const steps = [
  {
    text: 'سأبني نظام إدارة المستشفى الكامل عبر خطوات منظمة. أولاً أضع خطة العمل:',
    tool: {
      id: 'call-b-todo',
      name: 'todo_write',
      args: {
        todos: [
          { id: 'h1', content: 'هيكل HTML مع لوحة تنقل جانبية RTL داكنة', status: 'in_progress' },
          { id: 'h2', content: 'التنسيق الاحترافي css/hospital.css', status: 'pending' },
          { id: 'h3', content: 'بيانات البذر js/data.js مع طبقة localStorage', status: 'pending' },
          { id: 'h4', content: 'منطق التطبيق js/app.js: توجيه، CRUD، مواعيد، صيدلية، فواتير، بحث', status: 'pending' },
          { id: 'h5', content: 'فحص node --check ثم إصلاح تنسيق المبالغ وإعادة الفحص', status: 'pending' },
        ],
      },
    },
  },
  {
    text: 'أولاً هيكل الواجهة الرئيسي بالتنقل الجانبي:',
    tool: { id: 'call-b-index', name: 'write_file', args: { path: 'index.html', content: INDEX_HTML } },
  },
  {
    text: 'ثم ورقة التنسيق الداكنة الاحترافية:',
    tool: { id: 'call-b-css', name: 'write_file', args: { path: 'css/hospital.css', content: HOSPITAL_CSS } },
  },
  {
    text: 'ثم ملف البيانات مع طبقة التخزين المحلي:',
    tool: { id: 'call-b-data', name: 'write_file', args: { path: 'js/data.js', content: DATA_JS } },
  },
  {
    text: 'الآن منطق التطبيق الكامل:',
    tool: { id: 'call-b-app', name: 'write_file', args: { path: 'js/app.js', content: APP_JS } },
  },
  {
    text: 'أقرأ الملف قبل التعديل (شرط edit_file):',
    tool: { id: 'call-b-read', name: 'read_file', args: { path: 'js/app.js', limit: 500 } },
  },
  {
    text: 'فحص صياغة الملف:',
    tool: { id: 'call-b-check1', name: 'run_command', args: { command: 'node --check js/app.js' } },
  },
  {
    text: 'أصلح تنسيق المبالغ المالية ليعرض منزلتين عشريتين:',
    tool: {
      id: 'call-b-fix',
      name: 'edit_file',
      args: { path: 'js/app.js', old_string: FIX_OLD, new_string: FIX_NEW },
    },
  },
  {
    text: 'إعادة الفحص بعد الإصلاح:',
    tool: { id: 'call-b-check2', name: 'run_command', args: { command: 'node --check js/app.js' } },
  },
  {
    text: 'أتحقق من شجرة ملفات المشروع النهائية:',
    tool: { id: 'call-b-ls', name: 'list_dir', args: { path: '.' } },
  },
  {
    text: 'أفحص جودة الواجهة المكتوبة بأداة فحص الجودة (يحتاج نافذة Electron حقيقية للبروسِل الكامل):',
    tool: { id: 'call-b-uiq', name: 'ui_quality_check', args: { path: 'index.html' } },
  },
  {
    text: 'HOSPITAL SYSTEM COMPLETE',
  },
];

const countLines = (s) => s.split('\n').length;
const APP_JS_LINES = countLines(APP_JS);
const CSS_LINES = countLines(HOSPITAL_CSS);

test('scenario B: real engine builds a complete hospital management system', { timeout: 300_000 }, async (t) => {
  const ws = freshWorkspace('hospital');
  const t0 = Date.now();
  let results = null;
  let pass = false;
  let error = null;
  try {
    results = await drive({
      name: 'hospital',
      prompt: PROMPT,
      steps,
      workspace: ws,
      timeoutMs: 240_000,
    });

    // --- scripted sequence consumed exactly; no engine overrun ---
    assert.equal(results.providerExhausted.length, 0, 'fake provider script must not be exhausted');
    assert.equal(results.errors.length, 0, `no engine errors (got: ${JSON.stringify(results.errors)})`);

    // --- task_report outcome ---
    assert.ok(results.taskReport, 'task_report emitted');
    assert.equal(results.taskReport.outcome, 'completed');

    // --- final text ---
    assert.ok(
      (results.finalText || '').includes('HOSPITAL SYSTEM COMPLETE'),
      `final text carries the completion marker (got: ${JSON.stringify(results.finalText?.slice(-200))})`,
    );

    // --- >= 6 distinct tools ---
    assert.ok(
      results.toolsUsed.length >= 6,
      `>=6 distinct tools used (got ${results.toolsUsed.length}: ${results.toolsUsed.join(', ')})`,
    );
    for (const tool of ['todo_write', 'write_file', 'read_file', 'edit_file', 'run_command', 'list_dir', 'ui_quality_check']) {
      assert.ok(results.toolsUsed.includes(tool), `tool ${tool} used`);
    }

    // --- every tool call succeeded ---
    const failed = results.toolCalls.filter((c) => c.ok !== true);
    assert.deepEqual(
      failed.map((c) => c.name),
      [],
      `all tool calls ok (failed: ${failed.map((c) => `${c.name}: ${String(c.output).slice(0, 200)}`).join(' | ')})`,
    );

    // --- files exist on disk with promised sizes ---
    const appPath = join(ws, 'js', 'app.js');
    const cssPath = join(ws, 'css', 'hospital.css');
    for (const rel of ['index.html', 'js/data.js', 'js/app.js', 'css/hospital.css']) {
      assert.ok(existsSync(join(ws, rel)), `file exists: ${rel}`);
    }
    const appLines = readFileSync(appPath, 'utf8').split('\n').length;
    const cssLines = readFileSync(cssPath, 'utf8').split('\n').length;
    assert.ok(appLines >= 350, `js/app.js has >=350 lines (got ${appLines})`);
    assert.ok(cssLines >= 200, `css/hospital.css has >=200 lines (got ${cssLines})`);

    // --- content assertions: Arabic RTL sidebar nav labels ---
    const html = readFileSync(join(ws, 'index.html'), 'utf8');
    for (const label of ['لوحة التحكم', 'المرضى', 'الأطباء', 'المواعيد', 'الصيدلية', 'الفواتير']) {
      assert.ok(html.includes(label), `index.html has nav label: ${label}`);
    }
    assert.ok(html.includes('dir="rtl"'), 'index.html is RTL');
    assert.ok(html.includes('lang="ar"'), 'index.html is Arabic');

    // --- the edit_file fix really landed ---
    const appSrc = readFileSync(appPath, 'utf8');
    assert.ok(appSrc.includes('toFixed(2)'), 'the fmtMoney fix (toFixed(2)) is on disk');
    assert.ok(!appSrc.includes('return n.toFixed(0)'), 'the buggy fmtMoney version is gone');

    // --- node --check tool results really succeeded (exit code evidence) ---
    const checks = results.toolCalls.filter((c) => c.name === 'run_command');
    assert.equal(checks.length, 2, 'two node --check runs (before + after fix)');
    for (const c of checks) {
      assert.equal(c.ok, true, `node --check ok for: ${c.args.command}`);
      assert.match(String(c.output), /\[exit code: 0\]/, 'exit code 0 captured in tool_result');
    }

    pass = true;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const commandsRun = results ? commandsRunOf(results) : [];
    const summary = {
      scenario: 'B — hospital management system',
      pass,
      toolsUsed: results ? results.toolsUsed : [],
      commandsRun,
      taskReport: results ? results.taskReport : null,
      finalText: results ? results.finalText : null,
      providerRequests: results ? results.providerRequests.length : 0,
      appJsLines: APP_JS_LINES,
      cssLines: CSS_LINES,
      durationMs: Date.now() - t0,
      note: 'LLM is SCRIPTED (fake SSE provider) — proves the REAL engine pipeline (tool dispatch, fs writes, approval gate, run_command, task_report), not model intelligence.',
      error: error ? String(error.message || error).slice(0, 2000) : null,
    };
    try {
      writeSummary('b', summary);
    } catch (e) {
      console.error('summary write failed:', e);
    }
    if (ws) {
      try {
        copyArtifacts('hospital', ws);
      } catch (e) {
        console.error('artifact copy failed:', e);
      }
    }
  }
});
