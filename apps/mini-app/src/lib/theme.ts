/**
 * FxAeon semantic theme tokens
 *
 * Provides instant dynamic theme switching using CSS custom properties with zero
 * external image assets or bundle overhead.
 */

export type ThemeId = 'violet' | 'matrix' | 'neon' | 'titanium';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  subtitle: string;
  accent: string;
  badge: string;
  colors: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  violet: {
    id: 'violet',
    name: 'Deep Space',
    subtitle: 'Classic FxAeon Violet & Aurora',
    accent: '#8b6dff',
    badge: 'Violet',
    colors: {
      '--bg': '#07070d',
      '--bg-raised': '#0b0b14',
      '--surface': 'rgba(18, 18, 30, 0.88)',
      '--surface-2': 'rgba(26, 26, 42, 0.90)',
      '--surface-3': 'rgba(34, 33, 54, 0.92)',
      '--card': '#12121d',
      '--mint': '#8b6dff',
      '--mint-bright': '#aa96ff',
      '--mint-dim': 'rgba(139, 109, 255, 0.14)',
      '--mint-glow': 'rgba(139, 109, 255, 0.28)',
      '--cyan': '#b9a8ff',
    },
  },
  matrix: {
    id: 'matrix',
    name: 'Matrix Terminal',
    subtitle: 'Cyber Green & Deep Black',
    accent: '#00ff88',
    badge: 'Terminal',
    colors: {
      '--bg': '#050906',
      '--bg-raised': '#08120a',
      '--surface': 'rgba(13, 26, 15, 0.88)',
      '--surface-2': 'rgba(18, 36, 21, 0.90)',
      '--surface-3': 'rgba(23, 46, 27, 0.92)',
      '--card': '#0d1a0f',
      '--mint': '#00ff88',
      '--mint-bright': '#4dffaa',
      '--mint-dim': 'rgba(0, 255, 136, 0.14)',
      '--mint-glow': 'rgba(0, 255, 136, 0.32)',
      '--cyan': '#66ffbb',
    },
  },
  neon: {
    id: 'neon',
    name: 'Neon Velocity',
    subtitle: 'Synthwave Magenta & Cyan',
    accent: '#ff2a85',
    badge: 'Cyberpunk',
    colors: {
      '--bg': '#0a0610',
      '--bg-raised': '#110a1c',
      '--surface': 'rgba(25, 14, 40, 0.88)',
      '--surface-2': 'rgba(36, 20, 58, 0.90)',
      '--surface-3': 'rgba(47, 26, 75, 0.92)',
      '--card': '#190e28',
      '--mint': '#ff2a85',
      '--mint-bright': '#ff5ba3',
      '--mint-dim': 'rgba(255, 42, 133, 0.14)',
      '--mint-glow': 'rgba(255, 42, 133, 0.32)',
      '--cyan': '#00e5ff',
    },
  },
  titanium: {
    id: 'titanium',
    name: 'Monochrome Slate',
    subtitle: 'Minimalist Titanium Platinum',
    accent: '#e2e8f0',
    badge: 'Titanium',
    colors: {
      '--bg': '#09090b',
      '--bg-raised': '#121216',
      '--surface': 'rgba(24, 24, 31, 0.90)',
      '--surface-2': 'rgba(34, 34, 44, 0.92)',
      '--surface-3': 'rgba(44, 44, 56, 0.94)',
      '--card': '#18181f',
      '--mint': '#e2e8f0',
      '--mint-bright': '#f8fafc',
      '--mint-dim': 'rgba(226, 232, 240, 0.14)',
      '--mint-glow': 'rgba(226, 232, 240, 0.25)',
      '--cyan': '#94a3b8',
    },
  },
};

export function getSavedTheme(): ThemeId {
  if (typeof window === 'undefined') return 'violet';
  const saved = localStorage.getItem('fxaeon_theme_id') as ThemeId;
  return saved && THEMES[saved] ? saved : 'violet';
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.violet;
  const root = document.documentElement;

  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  root.setAttribute('data-theme', themeId);
  localStorage.setItem('fxaeon_theme_id', themeId);
}
