/**
 * FxAeon semantic theme tokens
 *
 * Provides instant dynamic theme switching using CSS custom properties with zero
 * external image assets or bundle overhead.
 */

export type ThemeId = 'violet' | 'black' | 'light' | 'matrix' | 'neon' | 'titanium';

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
  black: {
    id: 'black',
    name: 'Midnight Black',
    subtitle: 'True black with restrained blue',
    accent: '#6f8cff',
    badge: 'Dark',
    colors: {
      '--bg': '#000000',
      '--bg-raised': '#050506',
      '--surface': '#0b0b0e',
      '--surface-2': '#121216',
      '--surface-3': '#1a1a20',
      '--card': '#0b0b0e',
      '--input': '#050506',
      '--line': '#23232a',
      '--line-strong': '#3b3b46',
      '--text': '#fafafa',
      '--mut': '#a1a1aa',
      '--mut-2': '#71717a',
      '--mint': '#6f8cff',
      '--mint-bright': '#9aabff',
      '--mint-dim': 'rgba(111, 140, 255, 0.14)',
      '--mint-glow': 'rgba(111, 140, 255, 0.22)',
      '--cyan': '#70d7ff',
      '--brand-coral': '#ff6276',
    },
  },
  light: {
    id: 'light',
    name: 'Paper White',
    subtitle: 'Clean white with high-contrast ink',
    accent: '#315efb',
    badge: 'Light',
    colors: {
      '--bg': '#f5f7fb',
      '--bg-raised': '#ffffff',
      '--surface': '#ffffff',
      '--surface-2': '#eef2f7',
      '--surface-3': '#e3e8f0',
      '--card': '#ffffff',
      '--input': '#ffffff',
      '--line': '#d9e0ea',
      '--line-strong': '#aab5c4',
      '--text': '#11151c',
      '--mut': '#596579',
      '--mut-2': '#7c8798',
      '--mint': '#315efb',
      '--mint-bright': '#2149d8',
      '--mint-dim': 'rgba(49, 94, 251, 0.11)',
      '--mint-glow': 'rgba(49, 94, 251, 0.18)',
      '--cyan': '#087ca7',
      '--brand-coral': '#d83f59',
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
  try {
    const saved = localStorage.getItem('fxaeon_theme_id') as ThemeId;
    return saved && THEMES[saved] ? saved : 'violet';
  } catch {
    // A privacy mode or blocked storage should not make the app unusable.
    return 'violet';
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.violet;
  const root = document.documentElement;

  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  root.style.colorScheme = themeId === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', themeId);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.colors['--bg']);
  const telegram = (window as unknown as { Telegram?: { WebApp?: { setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void; setBottomBarColor?: (color: string) => void } } }).Telegram?.WebApp;
  try {
    telegram?.setHeaderColor?.(theme.colors['--bg']);
    telegram?.setBackgroundColor?.(theme.colors['--bg']);
    telegram?.setBottomBarColor?.(theme.colors['--bg']);
  } catch {
    // Older Telegram clients can reject dynamic chrome colors.
  }
  try {
    localStorage.setItem('fxaeon_theme_id', themeId);
    const settings = JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}') as Record<string, unknown>;
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ ...settings, theme: themeId }));
  } catch {
    // Theme changes still apply for this session when storage is unavailable.
  }
}
