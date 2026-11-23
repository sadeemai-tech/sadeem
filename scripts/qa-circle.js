(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btns = () => [...document.querySelectorAll('button')];
  let c = btns().find((b) => b.querySelector('.lucide-folder-open'));
  if (!c) c = btns().find((b) => (b.textContent || '').includes('demo'));
  if (c) { c.click(); await sleep(3500); }
  const dock = document.querySelector('.glass-dock');
  if (!dock) return JSON.stringify({ err: 'no dock' });
  const hits = [];
  const input = dock.querySelector('textarea, input');
  const ir = input ? input.getBoundingClientRect() : null;
  dock.querySelectorAll('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    const isCircle = el.tagName.toLowerCase() === 'circle' || cls.includes('rounded-full') ||
      (el.tagName === 'SPAN' && cls.includes('sb-dot'));
    if (!isCircle) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.width > 20) return;
    if (ir && !(r.right < ir.left || ir.right < r.left || r.bottom < ir.top || ir.bottom < r.top)) {
      const parent = el.closest('button,div,label');
      hits.push({
        tag: el.tagName, cls: cls.slice(0, 60),
        parentTag: parent ? parent.tagName : null,
        parentCls: parent && typeof parent.className === 'string' ? parent.className.slice(0, 80) : null,
        html: el.outerHTML.slice(0, 120),
        r: [r.left, r.top, r.width, r.height].map(Math.round),
      });
    }
  });
  return JSON.stringify({ inputRect: ir && [ir.left, ir.top, ir.width, ir.height].map(Math.round), hits: hits.slice(0, 6) });
})()
