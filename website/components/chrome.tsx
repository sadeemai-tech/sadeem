'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Languages, Menu, Moon, Sun, X, Terminal } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SITE } from '@/lib/site';
import { GlassLayer } from '@/components/visuals/GlassLayer';

const LINKS = [
  { href:'/', en:'About', ar:'عن سديم' },
  { href:'/features', en:'Features', ar:'الميزات' },
  { href:'/download', en:'Download', ar:'التحميل' },
  { href:'/pricing', en:'Pricing', ar:'الأسعار' },
  { href:'/docs', en:'Docs', ar:'الدليل' },
  { href:'/changelog', en:'Changelog', ar:'التحديثات' },
];

function ThemeToggle() {
  const { tx } = useLang();
  const [theme, setTheme] = useState<'light'|'dark'>('dark');
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as 'light'|'dark') || 'dark');
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('sadeem-theme', next);
    setTheme(next);
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label={theme==='dark'?tx('Switch to light mode','الوضع الفاتح'):tx('Switch to dark mode','الوضع الداكن')} title={theme==='dark'?tx('Light mode','فاتح'):tx('Dark mode','داكن')}>
      {theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}
    </button>
  );
}

export function SiteHeader() {
  const { lang, toggle, tx } = useLang();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  /* The glass hairline only appears once the page starts moving under the
     sticky header. rAF-throttled; React state updates only on a real change. */
  const [scrolled, setScrolled] = useState(false);
  const wasScrolled = useRef(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = window.scrollY > 8;
      if (next !== wasScrolled.current) {
        wasScrolled.current = next;
        setScrolled(next);
      }
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', queue, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', queue);
    };
  }, []);

  return <header className={'site-head glass-host' + (scrolled ? ' is-scrolled' : '')}>
    <GlassLayer className="glass-header" blur={18} radius={0} tone="quiet" />
    <div className="wrap row" style={{ height:70 }}>
      <Link href="/" className="brand" onClick={()=>setOpen(false)}>
        <span className="brand-mark brand-mark--logo"><img className="brand-logo" src="/sadeem-app-logo.png" alt="SADEEM" width={26} height={26}/></span>
        <span>SADEEM</span>
        <span className="brand-ver">v{SITE.version}</span>
      </Link>
      <nav className="nav">
        {LINKS.map(l => <Link key={l.href} href={l.href} className={'nav-link'+(path===l.href?' active':'')}>{lang==='ar'?l.ar:l.en}</Link>)}
      </nav>
      <div className="spacer" />
      <button className="icon-btn" onClick={toggle} title={tx('العربية','English')} aria-label={tx('Switch language','تغيير اللغة')}><Languages size={17}/></button>
      <ThemeToggle />
      <Link className="btn btn-solid" href="/download"><ArrowDownToLine size={16}/>{tx('Download','حمّل الآن')}</Link>
      <button className="icon-btn menu-btn" onClick={()=>setOpen(!open)} aria-label={tx('Menu','القائمة')} aria-expanded={open}>{open?<X size={19}/>:<Menu size={19}/>}</button>
    </div>
    {open && <nav className="mobile-nav wrap">
      {LINKS.map(l => <Link key={l.href} href={l.href} onClick={()=>setOpen(false)} className="nav-link">{lang==='ar'?l.ar:l.en}</Link>)}
    </nav>}
  </header>;
}

export function SiteFooter() {
  const { tx } = useLang();
  return <footer className="site-foot">
    <div className="wrap">
      <div className="foot-grid">
        <div>
          <Link href="/" className="brand"><span className="brand-mark"><Terminal size={16}/></span><span>SADEEM</span></Link>
          <p className="dim" style={{ fontSize:14, maxWidth:400, marginTop:16 }}>{tx('A local-first agent that learns from every run. Your keys, your machine, your playbook.','وكيل يعمل محلياً ويتعلم من كل مهمة. مفاتيحك، جهازك، ودليل حياتك.')}</p>
        </div>
        <div className="foot-col">
          <span className="label">{tx('PRODUCT','المنتج')}</span>
          <Link href="/features">{tx('Features','الميزات')}</Link>
          <Link href="/download">{tx('Download','التحميل')}</Link>
          <Link href="/pricing">{tx('Pricing','الأسعار')}</Link>
        </div>
        <div className="foot-col">
          <span className="label">{tx('RESOURCES','الموارد')}</span>
          <Link href="/docs">{tx('Docs','الدليل')}</Link>
          <Link href="/changelog">{tx('Changelog','التحديثات')}</Link>
          <a href={SITE.repo} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
      <div className="wordmark" aria-hidden="true">SADEEM</div>
      <div className="foot-bottom">
        <span>© 2026 SADEEM · v{SITE.version}</span>
        <span>{tx('Ink on paper. Built in the open.','حبر على ورق. صُنع في العلن.')}</span>
      </div>
    </div>
  </footer>;
}
