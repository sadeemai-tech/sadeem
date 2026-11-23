// SADEEM — theme metadata: the single source of truth for theme swatches,
// display labels and editor backgrounds. Values mirror the CSS custom
// properties defined in styles.css (keep them in sync) under the
// SADEEM PALETTE LAW (v11.5 — black / white / lime #A3E635 ONLY):
//   follow   → SADEEM System  (default · the DEVICE decides light/dark)
//   light    → SADEEM Light   (PRIMARY design · white canvas + lime)
//   soft     → SADEEM Carbon  (secondary dark · neutral graphite)
//   obsidian → SADEEM Dark    (secondary dark · true black)
//   midnight → SADEEM Deep    (secondary dark · near-black)
//   high     → accessibility instrument skin
// Palette law (v11.5): lime #A3E635 + black/white/grays ONLY.
// Every other hue was removed. Used by the settings theme cards
// and the onboarding live-preview cards so every theme dot/painted preview
// shows REAL palette values.

export type ThemeId = 'follow' | 'soft' | 'obsidian' | 'midnight' | 'light';

export interface ThemeMeta {
  /** Bilingual display name (the settings i18n keys remain authoritative). */
  label: { en: string; ar: string };
  /** 4 swatch dots: background · panel · accent · accent-2. */
  swatch: string[];
  /** Monaco/editor background for the theme. */
  editorBg: string;
  /** Extra surface tones for painted mini-UI previews (real token values). */
  ui: { line: string; ink: string; dim: string };
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  follow: {
    label: { en: 'SADEEM System (default)', ar: 'سديم حسب الجهاز (افتراضي)' },
    // Painted as the light primary — the device may resolve it dark.
    swatch: ['#FFFFFF', '#FAFAFA', '#A3E635', '#8A8A8A'],
    editorBg: '#FAFAFA',
    ui: { line: '#E5E5E5', ink: '#0A0A0A', dim: '#525252' },
  },
  soft: {
    label: { en: 'SADEEM Carbon', ar: 'سديم كربوني' },
    // --bg · --panel · --acc · --acc2 (styles.css, html[data-theme='soft'])
    swatch: ['#1A1A18', '#272724', '#A3E635', '#A8A8A8'],
    editorBg: '#1A1A18',
    ui: { line: '#33322E', ink: '#F2F2F2', dim: '#A6A6A6' },
  },
  obsidian: {
    label: { en: 'SADEEM Dark', ar: 'سديم الداكن' },
    // --bg0 · --panel(bg3) · --acc · --acc2 (styles.css, html[data-theme='obsidian']) — Deep Space (v11.8)
    swatch: ['#0A0E14', '#131A23', '#98D83B', '#A9A49A'],
    editorBg: '#0D1219',
    ui: { line: '#263041', ink: '#E9EEF6', dim: '#97A5B8' },
  },
  midnight: {
    label: { en: 'SADEEM Deep', ar: 'سديم العمق' },
    // --bg0 · --panel(bg3) · --acc · --acc2 (styles.css, html[data-theme='midnight']) — Deep Space (v11.8)
    swatch: ['#060A10', '#10161E', '#98D83B', '#A19D94'],
    editorBg: '#0A0F16',
    ui: { line: '#202B3A', ink: '#ECF1F8', dim: '#9DAABD' },
  },
  light: {
    label: { en: 'SADEEM Light (primary)', ar: 'سديم الفاتح (الأساسي)' },
    // --bg0 · --panel(bg3) · --acc · --acc2 (styles.css, html[data-theme='light']) — cool paper (v11.8)
    swatch: ['#FFFFFF', '#FAFBFC', '#4F7A10', '#636B76'],
    editorBg: '#FAFBFC',
    ui: { line: '#DBDFE5', ink: '#0C0F14', dim: '#4E5661' },
  },
};

/** Ordered theme ids for swatch grids — light primary, follow device default. */
export const THEME_IDS: ThemeId[] = ['follow', 'light', 'soft', 'obsidian', 'midnight'];
