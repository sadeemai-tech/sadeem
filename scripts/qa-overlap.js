(async () => {
  const rep = { stage: 'start', bars: [], error: null };
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btns = () => [...document.querySelectorAll('button')];
    let c = btns().find((b) => b.querySelector('.lucide-folder-open'));
    if (!c) c = btns().find((b) => (b.textContent || '').includes('demo'));
    if (c) { c.click(); await sleep(3500); }
    rep.stage = 'workspace-opened';
    rep.vw = innerWidth; rep.vh = innerHeight;

    const bars = [];
    document.querySelectorAll('.glass-chrome, .glass-strip').forEach((el, i) => {
      const cls = (typeof el.className === 'string' ? el.className : String(el.className)).slice(0, 40);
      bars.push(['bar#' + i + ' ' + cls, el]);
    });
    // chat panel header: the h-11 row that contains BOTH sec-titled and the download icon
    const chatHdr = [...document.querySelectorAll('div')].find((d) => {
      if (typeof d.className !== 'string' || !d.className.includes('h-11')) return false;
      return d.querySelector(':scope > .sec-titled') && d.querySelector('.lucide-download');
    });
    if (chatHdr) bars.push(['CHAT-HEADER', chatHdr]);
    const composer = document.querySelector('.glass-dock');
    if (composer) bars.push(['COMPOSER', composer]);

    const intersects = (a, b) =>
      !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
    // effective PAINT rect: intersect with every overflow-clip ancestor
    const paintRect = (el) => {
      let r = el.getBoundingClientRect();
      let p = el.parentElement;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(hidden|clip|auto|scroll)/.test(s.overflow + s.overflowX + s.overflowY)) {
          const pr = p.getBoundingClientRect();
          r = {
            left: Math.max(r.left, pr.left), right: Math.min(r.right, pr.right),
            top: Math.max(r.top, pr.top), bottom: Math.min(r.bottom, pr.bottom),
          };
          if (r.right <= r.left || r.bottom <= r.top) return null; // fully clipped
        }
        p = p.parentElement;
      }
      return r;
    };

    for (const [name, root] of bars) {
      const entry = { bar: name, leaves: 0, overlaps: [], offscreen: [] };
      const rr = root.getBoundingClientRect();
      if (rr.width < 4 || rr.height < 4) { entry.leaves = -1; rep.bars.push(entry); continue; }
      const leaves = [...root.querySelectorAll('*')].filter((el) => {
        if (el.children.length > 0) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const b = el.getBoundingClientRect();
        return b.width > 3 && b.height > 3;
      });
      entry.leaves = leaves.length;
      const sameIcon = (x, y) => {
        const sx = x.closest && x.closest('svg'); const sy = y.closest && y.closest('svg');
        return sx && sy && sx === sy;
      };
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) {
          if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
          if (sameIcon(leaves[i], leaves[j])) continue;
          const ra = paintRect(leaves[i]);
          const rb = paintRect(leaves[j]);
          if (!ra || !rb) continue; // fully clipped — cannot paint over anything
          const a = ra, b = rb;
          if (!intersects(a, b)) continue;
          const ov = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (ov < 12) continue;
          entry.overlaps.push({
            a: (leaves[i].textContent || leaves[i].tagName).trim().slice(0, 24),
            b: (leaves[j].textContent || leaves[j].tagName).trim().slice(0, 24),
            px: Math.round(ov),
            aR: [a.left, a.top, a.width, a.height].map(Math.round),
            bR: [b.left, b.top, b.width, b.height].map(Math.round),
          });
        }
      }
      // offscreen overflow: leaf sticking out of the viewport horizontally
      for (const el of leaves) {
        const b = el.getBoundingClientRect();
        if (b.right > innerWidth + 2 || b.left < -2) {
          entry.offscreen.push({
            t: (el.textContent || el.tagName).trim().slice(0, 24),
            r: [b.left, b.top, b.width, b.height].map(Math.round),
          });
        }
      }
      entry.overlaps = entry.overlaps.slice(0, 10);
      entry.offscreen = entry.offscreen.slice(0, 10);
      rep.bars.push(entry);
    }
    rep.stage = 'done';
  } catch (e) {
    rep.error = String(e && e.stack ? e.stack : e).slice(0, 400);
  }
  return JSON.stringify(rep);
})()
