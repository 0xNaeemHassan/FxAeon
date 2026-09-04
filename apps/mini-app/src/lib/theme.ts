/** FxAeon palettes shared by the compact toggle and full appearance control. */
export type ThemeId = 'official' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'fxaeon_theme_id_v2';
const LEGACY_THEME_STORAGE_KEY = 'fxaeon_theme_id';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  accent: string;
  colors: Record<string, string>;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  official: {
    id: 'official',
    name: 'Official',
    accent: '#b9a0ff',
    colors: {
      '--bg': '#100e18', '--bg-raised': '#15121e', '--surface': '#1a1726',
      '--surface-2': '#242033', '--surface-3': '#302a42', '--card': '#1a1726',
      '--input': '#221e30', '--line': '#322b43', '--line-strong': '#57496d',
      '--text': '#f7f5fc', '--mut': '#b1a9bf', '--mut-2': '#93889f',
      '--mint': '#b9a0ff', '--mint-bright': '#d1bfff', '--on-accent': '#211737',
      '--mint-dim': 'rgba(185, 160, 255, 0.12)', '--mint-glow': 'rgba(185, 160, 255, 0.20)',
      '--cyan': '#d6c7ff', '--brand-coral': '#c495ff',
      '--success': '#53d5a0', '--danger': '#ff5368', '--warn': '#f2b84b',
    },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    accent: '#b9a0ff',
    colors: {
      '--bg': '#090a0c', '--bg-raised': '#0e1013', '--surface': '#13161a',
      '--surface-2': '#1a1e24', '--surface-3': '#232830', '--card': '#13161a',
      '--input': '#171b20', '--line': '#282e36', '--line-strong': '#46505c',
      '--text': '#f5f7fa', '--mut': '#a7b0bb', '--mut-2': '#89939f',
      '--mint': '#b9a0ff', '--mint-bright': '#d1bfff', '--on-accent': '#211737',
      '--mint-dim': 'rgba(185, 160, 255, 0.12)', '--mint-glow': 'rgba(185, 160, 255, 0.20)',
      '--cyan': '#d6c7ff', '--brand-coral': '#c495ff',
      '--success': '#53d5a0', '--danger': '#ff5368', '--warn': '#f2b84b',
    },
  },
  light: {
    id: 'light',
    name: 'Light',
    accent: '#7341c8',
    colors: {
      '--bg': '#f7f5fb', '--bg-raised': '#ffffff', '--surface': '#ffffff',
      '--surface-2': '#f0ecf7', '--surface-3': '#e7e0f2', '--card': '#ffffff',
      '--input': '#f2eef8', '--line': '#e8e1f0', '--line-strong': '#b6a8cb',
      '--text': '#251b35', '--mut': '#71637f', '--mut-2': '#7c6d8c',
      '--mint': '#7341c8', '--mint-bright': '#5f2cb4', '--on-accent': '#ffffff',
      '--mint-dim': 'rgba(115, 65, 200, 0.09)', '--mint-glow': 'rgba(115, 65, 200, 0.16)',
      '--cyan': '#8655c7', '--brand-coral': '#a362c4',
      '--success': '#128354', '--danger': '#c92b49', '--warn': '#90630c',
    },
  },
};

export function getSavedTheme(): ThemeId {
  if (typeof window === 'undefined') return 'official';
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'official' || saved === 'dark' || saved === 'light') return saved;
    // The previous release used "dark" for today's Official palette. Preserve
    // that appearance during migration; an existing light choice stays light.
    return localStorage.getItem(LEGACY_THEME_STORAGE_KEY) === 'light' ? 'light' : 'official';
  } catch {
    return 'official';
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof window === 'undefined') return;
  const theme = THEMES[themeId] || THEMES.official;
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
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
    const settings = JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}') as Record<string, unknown>;
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ ...settings, theme: themeId }));
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<ThemeId>('fxaeon:theme', { detail: themeId }));
}
