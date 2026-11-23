(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  let c = btns().find((b) => b.querySelector('.lucide-folder-open'));
  if (!c) c = btns().find((b) => (b.textContent || '').includes('demo'));
  if (c) { c.click(); await sleep(3500); }
  const out = { chat: [], circle: null };
  // 1) chat header leaves with rects
  const chatHdr = [...document.querySelectorAll('div')].find((d) => {
    if (typeof d.className !== 'string' || !d.className.includes('h-11')) return false;
    return d.querySelector(':scope > .sec-titled') && d.querySelector('.lucide-download');
  });
  if (chatHdr) {
    const cs = getComputedStyle(chatHdr.querySelector('.sec-titled'));
    out.secBlock = { display: cs.display, flex: cs.flex, overflow: cs.overflow, width: chatHdr.querySelector('.sec-titled').getBoundingClientRect().width };
    [...chatHdr.querySelectorAll('*')].filter((el) => !el.children.length).forEach((el) => {
      const r = el.getBoundingClientRect();
      out.chat.push({ t: (el.textContent || el.tagName).trim().slice(0, 20), r: [r.left, r.top, r.width].map(Math.round), cls: String(el.className).slice(0, 40) });
    });
  }
  // 2) circle x input
  const dock = document.querySelector('.glass-dock');
  if (dock) {
    const input = dock.querySelector('textarea, input');
    if (input) {
      const ir = input.getBoundingClientRect();
      dock.querySelectorAll('circle, span, svg').forEach((el) => {
        if (el.children.length > 0 && el.tagName !== 'svg' && el.tagName !== 'circle') return;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.width > 16 || r.height > 16) return;
        if (!(r.right > ir.left && ir.right > r.left && r.bottom > ir.top && ir.bottom < r.top + ir.height)) return;
        let p = el, chain = [];
        for (let i = 0; i < 5 && p; i++) { chain.push(p.tagName + '.' + String(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className).slice(0, 36)); p = p.parentElement; }
        out.circle = { html: el.outerHTML.slice(0, 100), r: [r.left, r.top, r.width, r.height].map(Math.round), chain, inputR: [ir.left, ir.top, ir.width, ir.height].map(Math.round) };
      });
    }
  }
  return JSON.stringify(out);
})()
