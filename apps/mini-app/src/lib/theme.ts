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
    name: 'Aeon Signal',
    subtitle: 'Trading blue and signal coral',
    accent: '#4f7cff',
    badge: 'Signal',
    colors: {
      '--bg': '#080b10',
      '--bg-raised': '#0c1017',
      '--surface': '#10151d',
      '--surface-2': '#161c26',
      '--surface-3': '#1c2430',
      '--card': '#10151d',
      '--input': '#0b1017',
      '--line': '#252d38',
      '--line-strong': '#3a4554',
      '--text': '#f5f7fa',
      '--mut': '#9ca6b5',
      '--mut-2': '#6f7a89',
      '--mint': '#4f7cff',
      '--mint-bright': '#7c9cff',
      '--mint-dim': 'rgba(79, 124, 255, 0.13)',
      '--mint-glow': 'rgba(79, 124, 255, 0.22)',
      '--cyan': '#52c7ff',
      '--brand-coral': '#ff5368',
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
      '--input': '#071009',
      '--line': '#1e3926',
      '--line-strong': '#315b3e',
      '--text': '#f4fff8',
      '--mut': '#9bb7a5',
      '--mut-2': '#6f8c79',
      '--mint': '#00ff88',
      '--mint-bright': '#4dffaa',
      '--mint-dim': 'rgba(0, 255, 136, 0.14)',
      '--mint-glow': 'rgba(0, 255, 136, 0.32)',
      '--cyan': '#66ffbb',
      '--brand-coral': '#ff6b7f',
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
      '--input': '#0e0817',
      '--line': '#35234b',
      '--line-strong': '#563674',
      '--text': '#fff7fc',
      '--mut': '#bea7cb',
      '--mut-2': '#8a7299',
      '--mint': '#ff2a85',
      '--mint-bright': '#ff5ba3',
      '--mint-dim': 'rgba(255, 42, 133, 0.14)',
      '--mint-glow': 'rgba(255, 42, 133, 0.32)',
      '--cyan': '#00e5ff',
      '--brand-coral': '#ff6b7f',
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
      '--input': '#101014',
      '--line': '#30303a',
      '--line-strong': '#494957',
      '--text': '#f8fafc',
      '--mut': '#a1a1aa',
      '--mut-2': '#71717a',
      '--mint': '#e2e8f0',
      '--mint-bright': '#f8fafc',
      '--mint-dim': 'rgba(226, 232, 240, 0.14)',
      '--mint-glow': 'rgba(226, 232, 240, 0.25)',
      '--cyan': '#94a3b8',
      '--brand-coral': '#fb7185',
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
