(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  let c = btns().find((b) => b.querySelector('.lucide-folder-open'));
  if (!c) c = btns().find((b) => (b.textContent || '').includes('demo'));
  if (c) { c.click(); await sleep(3500); }

  const parse = (s) => {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const comp = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (f, b) => {
    const l1 = lum(f), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effBg = (el) => {
    let n = el;
    let acc = [255, 255, 255, 1];
    const html = parse(getComputedStyle(document.documentElement).backgroundColor) || [26, 33, 38, 1];
    acc = html;
    const stack = [];
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) stack.push(c);
      n = n.parentElement;
    }
    acc = html;
    for (let i = stack.length - 1; i >= 0; i--) acc = comp(stack[i], acc);
    return acc;
  };

  // sample: every text-bearing leaf in chrome + sidebar + chat header + welcome
  const S = ['button', '.sec-tt', '.chip', '.stamp', 'input::placeholder', 'textarea::placeholder',
    'label', 'h1', 'h2', 'h3', '.text-dim', '.text-faint', '.text-ghost', 'td', 'th', 'code', 'a'];
  const els = [...document.querySelectorAll('button, .sec-tt, .chip, .stamp, label, h1, h2, h3, span, div, p, td, th, a, code')];
  const bad = [];
  const seen = new Set();
  for (const el of els) {
    if (el.children.length > 1) continue;
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 6) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < 0.5) continue;
    const fg = parse(st.color);
    if (!fg) continue;
    // skip pseudo placeholder (can't read its color reliably here)
    const bg = effBg(el);
    const cr = ratio(fg, bg);
    const key = txt.slice(0, 30) + Math.round(cr * 10);
    if (cr >= 3.0 || seen.has(key)) continue;
    seen.add(key);
    bad.push({
      t: txt.slice(0, 34),
      cr: +cr.toFixed(2),
      fg: st.color,
      cls: String(el.className).slice(0, 44),
      fs: st.fontSize,
      w: Math.round(r.width),
    });
  }
  bad.sort((a, b) => a.cr - b.cr);
  return JSON.stringify({ theme: document.documentElement.dataset.theme, count: bad.length, worst: bad.slice(0, 26) });
})()
