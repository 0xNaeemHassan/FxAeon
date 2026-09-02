/** Official FxAeon palette with one accessible light/dark control. */
export type ThemeId = 'dark' | 'light';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  accent: string;
  colors: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  dark: {
    id: 'dark',
    name: 'Official dark',
    accent: '#4f7cff',
    colors: {
      '--bg': '#080b10', '--bg-raised': '#0c1017', '--surface': '#10151d',
      '--surface-2': '#161c26', '--surface-3': '#1c2430', '--card': '#10151d',
      '--input': '#0b1017', '--line': '#252d38', '--line-strong': '#3a4554',
      '--text': '#f5f7fa', '--mut': '#9ca6b5', '--mut-2': '#6f7a89',
      '--mint': '#4f7cff', '--mint-bright': '#7c9cff',
      '--mint-dim': 'rgba(79, 124, 255, 0.13)', '--mint-glow': 'rgba(79, 124, 255, 0.22)',
      '--cyan': '#52c7ff', '--brand-coral': '#ff5368',
    },
  },
  light: {
    id: 'light',
    name: 'Official light',
    accent: '#315efb',
    colors: {
      '--bg': '#f5f7fb', '--bg-raised': '#ffffff', '--surface': '#ffffff',
      '--surface-2': '#eef2f7', '--surface-3': '#e3e8f0', '--card': '#ffffff',
      '--input': '#ffffff', '--line': '#d9e0ea', '--line-strong': '#aab5c4',
      '--text': '#11151c', '--mut': '#596579', '--mut-2': '#7c8798',
      '--mint': '#315efb', '--mint-bright': '#2149d8',
      '--mint-dim': 'rgba(49, 94, 251, 0.11)', '--mint-glow': 'rgba(49, 94, 251, 0.18)',
      '--cyan': '#087ca7', '--brand-coral': '#d83f59',
    },
  },
};

export function getSavedTheme(): ThemeId {
  if (typeof window === 'undefined') return 'dark';
  try {
    // Every retired palette migrates to official dark. Existing light users
    // keep their preference across the reduced two-theme release.
    return localStorage.getItem('fxaeon_theme_id') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.dark;
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => root.style.setProperty(key, value));
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
    // Theme still applies for this session when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<ThemeId>('fxaeon:theme', { detail: themeId }));
}
