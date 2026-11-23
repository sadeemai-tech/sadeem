/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        acc: 'var(--acc)',
        acc2: 'var(--acc2)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
      },
      fontFamily: {
        ui: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
        code: ['IBM Plex Mono', 'Menlo', 'Consolas', 'monospace'],
        display: ['Inter', 'Cairo', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl2: '14px',
      },
      boxShadow: {
        glow: '0 0 0 1px var(--line)',
        card: 'var(--sh-card)',
        float: 'var(--sh-float)',
        key: 'var(--sh-key)',
        'key-acc': 'var(--sh-key-acc)',
      },
    },
  },
  plugins: [],
};
