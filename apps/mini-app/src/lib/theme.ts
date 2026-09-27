/** FxAeon palettes shared by the compact toggle and full appearance control. */
import { applyTelegramChromeColors } from './telegram';

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
      '--bg': '#101018', '--bg-raised': '#14131d', '--surface': '#181721',
      '--surface-2': '#211f2c', '--surface-3': '#2b2739', '--card': '#181721',
      '--input': '#1d1b28', '--line': '#302c3f', '--line-strong': '#504760',
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
      '--bg': '#faf8f4', '--bg-raised': '#fffdfa', '--surface': '#fffdfa',
      '--surface-2': '#eee7f7', '--surface-3': '#e7def2', '--card': '#fffdfa',
      '--input': '#f4f0f8', '--line': '#ded5e7', '--line-strong': '#ad9cc3',
      '--text': '#302340', '--mut': '#6c617b', '--mut-2': '#786987',
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
  applyTelegramChromeColors(theme.colors['--bg']);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
    const settings = JSON.parse(localStorage.getItem('fxaeon.settings.v1') || '{}') as Record<string, unknown>;
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ ...settings, theme: themeId }));
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<ThemeId>('fxaeon:theme', { detail: themeId }));
}
