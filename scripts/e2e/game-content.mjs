// E2E harness (Task e2e-harness-A) — the SCENARIO-A artifact bodies.
// ------------------------------------------------------------
// These are the file contents the scripted model "writes" through the REAL
// engine (write_file / edit_file). They are honest, runnable artifacts:
// a large Arabic-language canvas shooting game (index.html + game.js +
// style.css) and a workspace SKILL.md body.
//
// NOTE: no backticks / template literals inside the bodies (they live inside
// template literals here); game.js uses plain string concatenation.

const INDEX_HTML = `<!DOCTYPE html>
<!-- ============================================================
     سهم السديم — لعبة إطلاق نار كاملة تعمل على لوحة الرسم (Canvas)
     كُتبت هذه الصفحة بواسطة محرك الوكيل الحقيقي في سديم ضمن اختبار
     نهاية-النهاية: مزود لغة مبرمَج يوجّه المحرك، والمحرك يكتب الملفات.
     الملفات: index.html (هذه الصفحة) + style.css (التصميم) + game.js (المنطق)
     ============================================================ -->
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="لعبة إطلاق نار فضائية على لوحة الرسم مع موجات وأعداء وجسيمات انفجار ومراحل متصاعدة.">
  <meta name="theme-color" content="#0b1020">
  <title>سهم السديم — لعبة إطلاق نار فضائية</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">

    <!-- ======= ترويسة اللعبة ======= -->
    <header id="game-header">
      <h1 id="game-title">سهم السديم</h1>
      <p id="game-subtitle">دافع عن آخر محطة فضائية ضد موجات الكويكبات المعادية</p>
    </header>

    <!-- ======= شريط المعلومات (HUD) ======= -->
    <!-- تُحدَّث قيم هذا الشريط من game.js عبر معرّفات العناصر كل إطار رسم -->
    <section id="hud" aria-label="شريط معلومات اللعبة">
      <div class="hud-item" id="hud-item-score">
        <span class="hud-label">النقاط</span>
        <span class="hud-value" id="hud-score">0</span>
      </div>
      <div class="hud-item" id="hud-item-lives">
        <span class="hud-label">الأرواح</span>
        <span class="hud-value" id="hud-lives">3</span>
      </div>
      <div class="hud-item" id="hud-item-level">
        <span class="hud-label">المرحلة</span>
        <span class="hud-value" id="hud-level">1</span>
      </div>
      <div class="hud-item" id="hud-item-wave">
        <span class="hud-label">الموجة</span>
        <span class="hud-value" id="hud-wave">1</span>
      </div>
      <div class="hud-item" id="hud-item-best">
        <span class="hud-label">أعلى نتيجة</span>
        <span class="hud-value" id="hud-best">0</span>
      </div>
      <div class="hud-item" id="hud-item-status">
        <span class="hud-label">الحالة</span>
        <span class="hud-value" id="hud-status">متوقفة</span>
      </div>
    </section>

    <!-- ======= ساحة اللعب ======= -->
    <main id="stage">
      <canvas id="game-canvas" width="800" height="600" aria-label="ساحة اللعب">
        متصفحك لا يدعم عنصر لوحة الرسم — حدّث المتصفح لتشغيل اللعبة.
      </canvas>
      <!-- الطبقة العلوية: تظهر قبل البدء وعند الإيقاف المؤقت وعند نهاية اللعبة -->
      <div id="overlay" class="overlay visible">
        <h2 id="overlay-title">استعد للمعركة</h2>
        <p id="overlay-text">اضغط زر البدء أو مفتاح المسافة للانطلاق.</p>
        <button id="btn-start" type="button">ابدأ اللعب</button>
      </div>
    </main>

    <!-- ======= التحكم ======= -->
    <section id="controls-help" class="panel">
      <h2>التحكم</h2>
      <table class="help-table">
        <thead>
          <tr>
            <th>المفتاح</th>
            <th>الوظيفة</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><kbd>→</kbd> <kbd>←</kbd></td>
            <td>تحريك السفينة يمينا ويسارا</td>
          </tr>
          <tr>
            <td><kbd>↑</kbd> <kbd>↓</kbd></td>
            <td>تحريك السفينة أعلى وأسفل ضمن حدود الساحة</td>
          </tr>
          <tr>
            <td><kbd>مسافة</kbd></td>
            <td>إطلاق طلقة مع زمن انتظار قصير بين الطلقات</td>
          </tr>
          <tr>
            <td><kbd>P</kbd></td>
            <td>إيقاف مؤقت ثم استئناف</td>
          </tr>
          <tr>
            <td><kbd>R</kbd></td>
            <td>إعادة تشغيل اللعبة بعد الخسارة</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ======= نظام النقاط ======= -->
    <section id="scoring-rules" class="panel">
      <h2>نظام النقاط</h2>
      <ul class="rules-list">
        <li>كويكب صغير: 15 نقطة.</li>
        <li>كويكب متوسط: 25 نقطة.</li>
        <li>سفينة معادية: 40 نقطة.</li>
        <li>زعيم الموجة (كل ثلاث موجات): 150 نقطة.</li>
        <li>كل مرحلة جديدة ترفع سرعة الأعداء ومعدل ظهورهم.</li>
        <li>الارتطام بأي عدو يكلّفك روحا واحدا، وفقدان ثلاث أرواح ينتهي بالخسارة.</li>
      </ul>
    </section>

    <!-- ======= دليل الأعداء ======= -->
    <section id="enemy-guide" class="panel">
      <h2>دليل الأعداء</h2>
      <table class="help-table">
        <thead>
          <tr>
            <th>العدو</th>
            <th>الشكل على الساحة</th>
            <th>السلوك</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>كويكب صغير</td>
            <td>مربع رمادي فاتح صغير</td>
            <td>يهبط بسرعة عالية بمسار شبه مستقيم</td>
          </tr>
          <tr>
            <td>كويكب متوسط</td>
            <td>مربع رمادي داكن كبير</td>
            <td>يهبط ببطء ويتمايل أفقيا</td>
          </tr>
          <tr>
            <td>سفينة معادية</td>
            <td>مثلث أحمر</td>
            <td>يطلق طلقات نحو الأسفل بشكل دوري</td>
          </tr>
          <tr>
            <td>زعيم الموجة</td>
            <td>ثماني بنفسجي كبير</td>
            <td>صحة عالية، يتحرك جانبيا ويطلق بوارق متتالية</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ======= المراحل ======= -->
    <section id="level-notes" class="panel">
      <h2>المراحل</h2>
      <ol class="rules-list">
        <li>المرحلة 1: موجات خفيفة لتعلّم التحكم.</li>
        <li>المرحلة 2: ظهور السفن المعادية للأسفل.</li>
        <li>المرحلة 3: كثافة ظهور أعلى وتمايل أوسع.</li>
        <li>المرحلة 4: بوارق أعداء كثيفة وحركة أسرع.</li>
        <li>المرحلة 5 وما بعدها: كل شيء يتسارع — حظا موفقا يا قائد.</li>
      </ol>
    </section>

    <!-- ======= نصائح القتال ======= -->
    <section id="tips" class="panel">
      <h2>نصائح القتال</h2>
      <ul class="rules-list">
        <li>لا تبقَ مكانا واحدا طويلا: الحركة المستمرة أصعب في الاستهداف.</li>
        <li>استخدم حواف الساحة لتجنب بوارق الزعيم.</li>
        <li>الزعيم يستحق 150 نقطة — ركّز عليه أولا إن استطعت.</li>
        <li>الجسيمات البرتقالية تعني اصطداما حديثا: ابتعد عن مصدرها.</li>
        <li>الإيقاف المؤقت P يجمّد كل شيء بما فيه بوارق العدو.</li>
      </ul>
    </section>

    <!-- ======= دليل الألوان ======= -->
    <section id="color-legend" class="panel">
      <h2>دليل الألوان</h2>
      <ul class="rules-list">
        <li>سماوي: سفينتك.</li>
        <li>أصفر: طلقاتك.</li>
        <li>أحمر: سفن العدو وبارقاتها.</li>
        <li>رمادي: الكويكبات.</li>
        <li>بنفسجي: زعيم الموجة.</li>
        <li>برتقالي: جسيمات الانفجار والوقود المحترق.</li>
      </ul>
    </section>

    <!-- ======= سجل التغييرات ======= -->
    <section id="changelog" class="panel">
      <h2>سجل التغييرات</h2>
      <ul class="rules-list">
        <li>الإصدار 1.0 — أول نسخة كاملة: موجات، أعداء، جسيمات، مراحل.</li>
        <li>الإصدار 1.1 — رفع سرعة الأعداء الأساسية من 1.6 إلى 2.1 بعد اختبار اللعب.</li>
        <li>الإصدار 1.2 — تحسين واجهة عربية من اليمين إلى اليسار.</li>
      </ul>
    </section>

    <!-- ======= أسئلة متكررة ======= -->
    <section id="faq" class="panel">
      <h2>أسئلة متكررة</h2>
      <dl class="faq-list">
        <dt>اللعبة لا تستجيب للمفاتيح؟</dt>
        <dd>اضغط داخل الصفحة أولا ثم جرّب مجددا — التركيز لازم بعد فتح الملف.</dd>
        <dt>أريد اللعب من جديد بعد الخسارة؟</dt>
        <dd>اضغط زر إعادة اللعب في الطبقة العلوية أو المفتاح R.</dd>
        <dt>هل الإيقاف المؤقت يخفي الساحة؟</dt>
        <dd>لا — الساحة تتجمد كما هي وتظهر طبقة الإيقاف المؤقت فوقها.</dd>
        <dt>أين تُحفظ أعلى نتيجة؟</dt>
        <dd>داخل هذه الجلسة فقط في الذاكرة — لا يوجد تخزين خارجي في هذه النسخة.</dd>
        <dt>هل تعمل اللعبة على الهاتف؟</dt>
        <dd>الصفحة متجاوبة، لكن التحكم الحالي مبني على لوحة مفاتيح فعلية.</dd>
        <dt>ما مصدر الأصوات؟</dt>
        <dd>هذه النسخة صامتة عمدا — الجسيمات والألوان تحمل الإحساس بالانفجار.</dd>
      </dl>
    </section>

    <!-- ======= ملاحظات الأداء ======= -->
    <section id="perf-notes" class="panel">
      <h2>ملاحظات الأداء</h2>
      <ul class="rules-list">
        <li>حلقة واحدة فقط عبر requestAnimationFrame — لا مؤقتات متوازية.</li>
        <li>الجسيمات لها عمر زمني ثابت وتُحذف فور انتهائه بلا تراكم.</li>
        <li>الطلقات خارج الساحة تُحذف في نفس الإطار — المصفوفات لا تنمو بلا حدود.</li>
        <li>النجوم تُعاد إلى الأعلى عند مغادرة الأسفل بدلا من إعادة إنشائها.</li>
        <li>delta الزمني محدود بأقصى 50ms حتى لا يقفز المنطق عند تعليق قصير.</li>
      </ul>
    </section>

    <!-- ======= ملاحظات الوصول ======= -->
    <section id="a11y-notes" class="panel">
      <h2>ملاحظات الوصول</h2>
      <ul class="rules-list">
        <li>الاتجاه العام للصفحة من اليمين إلى اليسار عبر dir="rtl" و lang="ar".</li>
        <li>الكانفس يحمل aria-label يصف الساحة لقارئات الشاشة.</li>
        <li>شريط المعلومات نصي كليا: النقاط والأرواح والمرحلة قيم مقروءة.</li>
        <li>زر البدء زر فعلي وليس عنصرا قابلا للنقر بلا دور.</li>
      </ul>
    </section>

    <!-- ======= التذييل ======= -->
    <footer id="game-footer">
      <p>
        هذه اللعبة أُنتجت داخل اختبار «نهاية النهاية» لمحرك الوكيل في سديم:
        خط أنابيب كامل من المحرك إلى الأدوات إلى نظام الملفات، بلا أي وسيط يدوي.
      </p>
    </footer>
  </div>

  <script src="game.js"></script>
</body>
</html>
`;

const GAME_JS = `/* ============================================================
 * سهم السديم — منطق اللعبة الكامل (بدون أي مكتبات خارجية)
 * كُتب بواسطة محرك الوكيل الحقيقي في سديم ضمن اختبار نهاية-النهاية.
 * البنية: حالة مركزية + حلقة رسم عبر requestAnimationFrame + إدخال
 * لوحة مفاتيح + توليد أعداء + تصادمات + جسيمات + مراحل متصاعدة.
 * ============================================================ */
(function () {
  'use strict';

  // ---------- ثوابت الساحة والأسعار ----------
  const CANVAS_W = 800;
  const CANVAS_H = 600;
  const PLAYER_SPEED = 5.2;
  const PLAYER_W = 38;
  const PLAYER_H = 30;
  const BULLET_SPEED = 9.5;
  const BULLET_COOLDOWN_MS = 170;
  const ENEMY_BASE_SPEED = 1.6;
  const ENEMY_SMALL_W = 22;
  const ENEMY_SMALL_H = 22;
  const ENEMY_BIG_W = 34;
  const ENEMY_BIG_H = 34;
  const ENEMY_SHIP_W = 30;
  const ENEMY_SHIP_H = 26;
  const BOSS_W = 64;
  const BOSS_H = 46;
  const ENEMY_FIRE_INTERVAL_MS = 1400;
  const ENEMY_BULLET_SPEED = 4.2;
  const WAVE_SIZE_BASE = 6;
  const MAX_LIVES = 3;
  const STAR_COUNT = 90;
  const PARTICLE_LIFE_MS = 700;
  const WAVE_BREAK_MS = 1500;

  // ---------- لوحة الألوان (تصميم داكن نظيف) ----------
  const COLORS = {
    bgTop: '#0b1020',
    bgBottom: '#131a33',
    player: '#4fd1c5',
    playerFlame: '#f6ad55',
    bullet: '#fbbf24',
    enemyBullet: '#f87171',
    enemySmall: '#cbd5e1',
    enemyBig: '#94a3b8',
    enemyShip: '#ef4444',
    boss: '#a78bfa',
    star: '#e2e8f0',
    particleHot: '#f472b6',
    particleCool: '#60a5fa'
  };

  // ---------- عناصر الصفحة ----------
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const hudScore = document.getElementById('hud-score');
  const hudLives = document.getElementById('hud-lives');
  const hudLevel = document.getElementById('hud-level');
  const hudWave = document.getElementById('hud-wave');
  const hudBest = document.getElementById('hud-best');
  const hudStatus = document.getElementById('hud-status');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const btnStart = document.getElementById('btn-start');

  // ---------- الحالة المركزية ----------
  const state = {
    running: false,
    paused: false,
    over: false,
    score: 0,
    lives: MAX_LIVES,
    level: 1,
    wave: 1,
    best: 0,
    lastShotAt: 0,
    waveClearedAt: 0,
    shake: 0
  };

  // الكيانات: سفينة اللاعب، الطلقات، الأعداء، البوارق، الجسيمات، النجوم
  const player = { x: CANVAS_W / 2, y: CANVAS_H - 70, w: PLAYER_W, h: PLAYER_H, alive: true };
  const bullets = [];
  const enemies = [];
  const enemyBullets = [];
  const particles = [];
  const stars = [];
  const keys = new Set();

  // ---------- أدوات مساعدة ----------
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function nowMs() {
    return performance.now();
  }

  function rectHit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // ---------- خلفية النجوم ----------
  function initStars() {
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: rand(0, CANVAS_W),
        y: rand(0, CANVAS_H),
        r: rand(0.5, 1.8),
        v: rand(6, 26)
      });
    }
  }

  function updateStars(dtSec) {
    for (const s of stars) {
      s.y += s.v * dtSec;
      if (s.y > CANVAS_H) {
        s.y = -2;
        s.x = rand(0, CANVAS_W);
      }
    }
  }

  // ---------- الجسيمات (انفجارات ودخان) ----------
  function spawnParticles(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: x,
        y: y,
        vx: rand(-power, power),
        vy: rand(-power, power),
        life: PARTICLE_LIFE_MS,
        born: nowMs(),
        color: color,
        size: rand(1.5, 4)
      });
    }
  }

  function updateParticles(dtSec) {
    const t = nowMs();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dtSec * 60;
      p.y += p.vy * dtSec * 60;
      if (t - p.born > p.life) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - (nowMs() - p.born) / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- توليد الأعداء والموجات ----------
  function levelSpeedFactor() {
    return 1 + (state.level - 1) * 0.18;
  }

  function makeEnemy(kind, x, y) {
    if (kind === 'boss') {
      return {
        kind: 'boss',
        x: x,
        y: y,
        w: BOSS_W,
        h: BOSS_H,
        hp: 8 + state.level * 2,
        vx: 1.4 * levelSpeedFactor(),
        vy: 0.5 * levelSpeedFactor(),
        sway: 40
      };
    }
    if (kind === 'ship') {
      return {
        kind: 'ship',
        x: x,
        y: y,
        w: ENEMY_SHIP_W,
        h: ENEMY_SHIP_H,
        hp: 2,
        vx: rand(-30, 30) * levelSpeedFactor(),
        vy: rand(60, 95) * levelSpeedFactor(),
        fireAt: nowMs() + rand(400, ENEMY_FIRE_INTERVAL_MS)
      };
    }
    const big = kind === 'big';
    return {
      kind: kind,
      x: x,
      y: y,
      w: big ? ENEMY_BIG_W : ENEMY_SMALL_W,
      h: big ? ENEMY_BIG_H : ENEMY_SMALL_H,
      hp: big ? 3 : 1,
      vx: big ? rand(-45, 45) * levelSpeedFactor() : 0,
      vy: rand(85, 130) * (big ? 0.7 : 1.15) * levelSpeedFactor()
    };
  }

  function pickEnemyKind() {
    const roll = Math.random();
    if (state.level >= 2 && roll < 0.25) return 'ship';
    if (roll < 0.55) return 'small';
    return 'big';
  }

  function spawnEnemy() {
    const x = rand(20, CANVAS_W - 60);
    enemies.push(makeEnemy(pickEnemyKind(), x, -50));
  }

  function spawnBoss() {
    enemies.push(makeEnemy('boss', CANVAS_W / 2 - BOSS_W / 2, -70));
  }

  function isBossWave() {
    return state.wave % 3 === 0;
  }

  function startWave() {
    if (isBossWave()) {
      spawnBoss();
    } else {
      const count = WAVE_SIZE_BASE + state.wave + Math.floor(state.level / 2);
      for (let i = 0; i < count; i++) {
        // توزيع زمني للظهور عبر مواقع عشوائية داخل الموجة
        setTimeout(spawnEnemy, i * 260);
      }
    }
  }

  // ---------- الإدخال ----------
  function onKeyDown(e) {
    if (e.code === 'Space') e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyP' && state.running && !state.over) togglePause();
    if (e.code === 'KeyR' && state.over) startGame();
    if (e.code === 'Space' && !state.running && !state.over) startGame();
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function updatePlayer(dtSec) {
    if (!player.alive) return;
    const step = PLAYER_SPEED * dtSec * 60;
    if (keys.has('ArrowLeft')) player.x -= step;
    if (keys.has('ArrowRight')) player.x += step;
    if (keys.has('ArrowUp')) player.y -= step;
    if (keys.has('ArrowDown')) player.y += step;
    player.x = clamp(player.x, 10, CANVAS_W - player.w - 10);
    player.y = clamp(player.y, CANVAS_H / 2, CANVAS_H - player.h - 10);
  }

  // ---------- الإطلاق ----------
  function shoot() {
    const t = nowMs();
    if (t - state.lastShotAt < BULLET_COOLDOWN_MS) return;
    state.lastShotAt = t;
    bullets.push({ x: player.x + player.w / 2 - 2, y: player.y - 8, w: 4, h: 12 });
  }

  function updateBullets(dtSec) {
    const step = BULLET_SPEED * dtSec * 60;
    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].y -= step;
      if (bullets[i].y < -14) bullets.splice(i, 1);
    }
  }

  function updateEnemies(dtSec) {
    const t = nowMs();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.x += e.vx * dtSec;
      e.y += e.vy * dtSec;
      if (e.kind === 'big' || e.kind === 'boss') {
        if (e.x < 8 || e.x + e.w > CANVAS_W - 8) e.vx = -e.vx;
      }
      if (e.kind === 'ship' || e.kind === 'boss') {
        if (t >= e.fireAt) {
          e.fireAt = t + ENEMY_FIRE_INTERVAL_MS / (e.kind === 'boss' ? 2 : 1);
          enemyBullets.push({
            x: e.x + e.w / 2 - 2,
            y: e.y + e.h,
            w: 4,
            h: 12
          });
        }
      }
      if (e.y > CANVAS_H + 60) enemies.splice(i, 1);
    }
  }

  function updateEnemyBullets(dtSec) {
    const step = ENEMY_BULLET_SPEED * dtSec * 60;
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      enemyBullets[i].y += step;
      if (enemyBullets[i].y > CANVAS_H + 14) enemyBullets.splice(i, 1);
    }
  }

  // ---------- التصادمات ----------
  function damageEnemy(e, idx) {
    e.hp -= 1;
    if (e.hp <= 0) {
      const points = e.kind === 'boss' ? 150 : e.kind === 'ship' ? 40 : e.kind === 'big' ? 25 : 15;
      state.score += points;
      spawnParticles(e.x + e.w / 2, e.y + e.h / 2, e.kind === 'boss' ? COLORS.boss : COLORS.particleHot, e.kind === 'boss' ? 26 : 14, e.kind === 'boss' ? 3.4 : 2.4);
      enemies.splice(idx, 1);
    } else {
      spawnParticles(e.x + e.w / 2, e.y + e.h / 2, COLORS.particleCool, 4, 1.4);
    }
  }

  function handleCollisions() {
    // طلقات اللاعب ضد الأعداء
    for (let b = bullets.length - 1; b >= 0; b--) {
      for (let e = enemies.length - 1; e >= 0; e--) {
        if (rectHit(bullets[b], enemies[e])) {
          damageEnemy(enemies[e], e);
          bullets.splice(b, 1);
          break;
        }
      }
    }
    // أرواح اللاعب: ارتطام مباشر أو بارق
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (let e = enemies.length - 1; e >= 0; e--) {
      if (rectHit(body, enemies[e])) {
        spawnParticles(enemies[e].x + enemies[e].w / 2, enemies[e].y, COLORS.playerFlame, 16, 2.6);
        enemies.splice(e, 1);
        loseLife();
        continue;
      }
    }
    for (let b = enemyBullets.length - 1; b >= 0; b--) {
      if (rectHit(body, enemyBullets[b])) {
        enemyBullets.splice(b, 1);
        loseLife();
      }
    }
  }

  function loseLife() {
    if (!player.alive) return;
    state.lives -= 1;
    state.shake = 12;
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, COLORS.playerFlame, 20, 3);
    if (state.lives <= 0) {
      player.alive = false;
      gameOver();
    }
  }

  // ---------- المراحل والموجات ----------
  function maybeAdvanceWave() {
    if (enemies.length > 0) return;
    if (state.waveClearedAt === 0) {
      state.waveClearedAt = nowMs();
      return;
    }
    if (nowMs() - state.waveClearedAt < WAVE_BREAK_MS) return;
    state.waveClearedAt = 0;
    state.wave += 1;
    if (state.wave % 2 === 0) state.level += 1;
    updateHud();
    startWave();
  }

  // ---------- الرسم ----------
  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, COLORS.bgTop);
    grad.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = COLORS.star;
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + (s.r / 2);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    if (!player.alive) return;
    // لهب المحرك
    ctx.fillStyle = COLORS.playerFlame;
    ctx.fillRect(player.x + player.w / 2 - 3, player.y + player.h, 6, 8 + Math.sin(nowMs() / 40) * 3);
    // جسم السفينة
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.moveTo(player.x + player.w / 2, player.y);
    ctx.lineTo(player.x + player.w, player.y + player.h);
    ctx.lineTo(player.x, player.y + player.h);
    ctx.closePath();
    ctx.fill();
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.kind === 'ship') {
        ctx.fillStyle = COLORS.enemyShip;
        ctx.beginPath();
        ctx.moveTo(e.x + e.w / 2, e.y + e.h);
        ctx.lineTo(e.x + e.w, e.y);
        ctx.lineTo(e.x, e.y);
        ctx.closePath();
        ctx.fill();
      } else if (e.kind === 'boss') {
        ctx.fillStyle = COLORS.boss;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.fillStyle = '#f87171';
        ctx.fillRect(e.x + 8, e.y + e.h / 2 - 4, e.w - 16, 8);
      } else {
        ctx.fillStyle = e.kind === 'big' ? COLORS.enemyBig : COLORS.enemySmall;
        ctx.fillRect(e.x, e.y, e.w, e.h);
      }
    }
  }

  function drawBullets() {
    ctx.fillStyle = COLORS.bullet;
    for (const b of bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = COLORS.enemyBullet;
    for (const b of enemyBullets) ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      ctx.translate(rand(-state.shake, state.shake) / 2, rand(-state.shake, state.shake) / 2);
      state.shake -= 0.6;
    }
    drawBackground();
    drawPlayer();
    drawEnemies();
    drawBullets();
    drawParticles();
    ctx.restore();
  }

  // ---------- واجهة HUD ----------
  function updateHud() {
    hudScore.textContent = String(state.score);
    hudLives.textContent = String(Math.max(0, state.lives));
    hudLevel.textContent = String(state.level);
    hudWave.textContent = String(state.wave);
    hudBest.textContent = String(state.best);
    hudStatus.textContent = state.over ? 'انتهت' : state.paused ? 'إيقاف مؤقت' : state.running ? 'تعمل' : 'متوقفة';
  }

  function showOverlay(title, text, buttonLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    btnStart.textContent = buttonLabel;
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  // ---------- دورة الحياة ----------
  function resetGame() {
    state.score = 0;
    state.lives = MAX_LIVES;
    state.level = 1;
    state.wave = 1;
    state.lastShotAt = 0;
    state.waveClearedAt = 0;
    state.shake = 0;
    state.over = false;
    state.paused = false;
    player.x = CANVAS_W / 2 - PLAYER_W / 2;
    player.y = CANVAS_H - 70;
    player.alive = true;
    bullets.length = 0;
    enemies.length = 0;
    enemyBullets.length = 0;
    particles.length = 0;
  }

  function startGame() {
    resetGame();
    state.running = true;
    hideOverlay();
    updateHud();
    startWave();
  }

  function togglePause() {
    state.paused = !state.paused;
    if (state.paused) {
      showOverlay('إيقاف مؤقت', 'اضغط P أو زر الاستئناف للمتابعة.', 'استئناف');
    } else {
      hideOverlay();
    }
    updateHud();
  }

  function gameOver() {
    state.running = false;
    state.over = true;
    if (state.score > state.best) state.best = state.score;
    showOverlay('انتهت اللعبة', 'نتيجتك النهائية: ' + state.score + ' نقطة — اضغط R أو زر البدء لإعادة المحاولة.', 'إعادة اللعب');
    updateHud();
  }

  // ---------- الحلقة الرئيسية ----------
  let lastFrameAt = nowMs();

  function loop(ts) {
    const dtSec = Math.min(0.05, (ts - lastFrameAt) / 1000);
    lastFrameAt = ts;
    if (state.running && !state.paused && !state.over) {
      updatePlayer(dtSec);
      if (keys.has('Space')) shoot();
      updateBullets(dtSec);
      updateEnemies(dtSec);
      updateEnemyBullets(dtSec);
      handleCollisions();
      maybeAdvanceWave();
    }
    updateStars(dtSec);
    updateParticles(dtSec);
    draw();
    requestAnimationFrame(loop);
  }

  // ---------- التوصيل الأولي ----------
  function bindEvents() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    btnStart.addEventListener('click', function () {
      if (state.over || !state.running) startGame();
      else if (state.paused) togglePause();
    });
  }

  initStars();
  bindEvents();
  updateHud();
  requestAnimationFrame(loop);
})();
`;

const STYLE_CSS = `/* سهم السديم — تصميم داكن نظيف، اتجاه من اليمين إلى اليسار */
:root {
  --bg: #0b1020;
  --panel: #131a33;
  --panel-2: #1a2342;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #4fd1c5;
  --danger: #f87171;
  --border: #263055;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 24px 16px 40px;
  background: linear-gradient(180deg, #080c18 0%, var(--bg) 45%, #101735 100%);
  color: var(--text);
  font-family: "Segoe UI", Tahoma, Arial, sans-serif;
  line-height: 1.7;
}

#app {
  max-width: 880px;
  margin: 0 auto;
}

#game-header {
  text-align: center;
  margin-bottom: 18px;
}

#game-title {
  margin: 0;
  font-size: 2.1rem;
  letter-spacing: 1px;
  color: var(--accent);
  text-shadow: 0 0 18px rgba(79, 209, 197, 0.35);
}

#game-subtitle {
  margin: 6px 0 0;
  color: var(--muted);
}

#hud {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-bottom: 16px;
}

.hud-item {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 16px;
  min-width: 110px;
  text-align: center;
}

.hud-label {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
}

.hud-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent);
}

#stage {
  position: relative;
  text-align: center;
  margin-bottom: 20px;
}

#game-canvas {
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #0b1020;
  box-shadow: 0 0 30px rgba(79, 209, 197, 0.12);
}

.overlay {
  position: absolute;
  inset: 0;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(8, 12, 24, 0.82);
  border-radius: 12px;
}

.overlay.visible {
  display: flex;
}

#overlay-title {
  margin: 0;
  color: var(--accent);
}

#overlay-text {
  margin: 0;
  color: var(--muted);
  max-width: 520px;
}

#btn-start {
  padding: 10px 28px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #08131f;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  cursor: pointer;
}

#btn-start:hover {
  filter: brightness(1.1);
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  margin: 0 0 16px;
}

.panel h2 {
  margin: 0 0 10px;
  font-size: 1.15rem;
  color: var(--accent);
}

.help-table {
  width: 100%;
  border-collapse: collapse;
}

.help-table th,
.help-table td {
  text-align: right;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.help-table th {
  color: var(--muted);
  font-weight: 600;
}

kbd {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 8px;
  font-size: 0.9rem;
}

.rules-list {
  margin: 0;
  padding-right: 22px;
  color: var(--text);
}

#game-footer {
  text-align: center;
  color: var(--muted);
  font-size: 0.9rem;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}
`;

const SKILL_BODY = [
  '# Canvas game basics',
  '',
  'وصفة مختصرة لبناء لعبة كانفس كاملة داخل سديم. اتبع الترتيب:',
  '',
  '1. ابدأ بـ index.html: عنصر canvas واحد، شريط HUD بأرقام حقيقية، طبقة overlay للبدء والإيقاف، وعناوين عربية واضحة.',
  '2. اكتب style.css بثيم داكن: متغيرات ألوان في :root، لوحة HUD بشبكة flex، وإطار مضيء حول الساحة.',
  '3. في game.js داخل IIFE مع strict mode:',
  '   - ثوابت في الأعلى (أبعاد، سرعات، ألوان) لا أرقام سحرية داخل المنطق.',
  '   - حالة مركزية واحدة (score/lives/level/wave) ودالة updateHud تكتبها في DOM كل تغيير.',
  '   - حلقة رسم واحدة عبر requestAnimationFrame مع dtSec محسوب من الطابع الزمني.',
  '   - توليد أعداء على موجات: عدّاد موجة، فاصل راحة بين الموجات، وزعيم كل ثلاث موجات.',
  '   - تصادم AABB عبر rectHit، وجسيمات انفجار بعمق محدود وعمر زمني.',
  '   - مراحل تصاعدية: معامل سرعة يعتمد على المرحلة لا أرقام مطلقة.',
  '4. تحقق دائما بـ node --check على ملف الجافاسكربت قبل تسليم المهمة.',
  '',
  'أخطاء شائعة: نسيان clamp لموضع اللاعب، طلقات لا تُحذف خارج الساحة، وحلقة رسم تعمل أثناء الإيقاف المؤقت.',
].join('\n');

export { INDEX_HTML, GAME_JS, STYLE_CSS, SKILL_BODY };
