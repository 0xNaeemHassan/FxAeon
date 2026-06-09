'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';

interface ThemeContextType {
  isDark: boolean;
  toggleTheme: () => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  isTransitioning: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggleTheme: () => {},
  theme: 'system',
  setTheme: () => {},
  isTransitioning: false,
});

function getSystemTheme(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getTelegramTheme(): boolean | null {
  if (typeof window === 'undefined') return null;
  const tg = (window as any).Telegram?.WebApp;
  if (tg) {
    return tg.colorScheme === 'dark';
  }
  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [isDark, setIsDark] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [mounted, setMounted] = useState(false);

  const resolveTheme = useCallback((t: 'light' | 'dark' | 'system'): boolean => {
    if (t === 'system') {
      const tgTheme = getTelegramTheme();
      if (tgTheme !== null) return tgTheme;
      return getSystemTheme();
    }
    return t === 'dark';
  }, []);

  const setTheme = useCallback((newTheme: 'light' | 'dark' | 'system') => {
    setIsTransitioning(true);
    setThemeState(newTheme);
    
    // Small delay for transition animation
    setTimeout(() => {
      const resolved = resolveTheme(newTheme);
      setIsDark(resolved);
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('fxaeon-theme', newTheme);
      }
      
      setTimeout(() => setIsTransitioning(false), 300);
    }, 50);
  }, [resolveTheme]);

  const toggleTheme = useCallback(() => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
  }, [isDark, setTheme]);

  useEffect(() => {
    setMounted(true);
    
    // Check localStorage first, then Telegram, then system
    const saved = typeof window !== 'undefined' 
      ? localStorage.getItem('fxaeon-theme') as 'light' | 'dark' | 'system' | null
      : null;
    
    const initialTheme = saved || 'system';
    setThemeState(initialTheme);
    setIsDark(resolveTheme(initialTheme));
  }, [resolveTheme]);

  useEffect(() => {
    if (!mounted) return;
    
    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        setIsDark(resolveTheme('system'));
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    
    // Listen for Telegram theme changes
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.onEvent('themeChanged', () => {
        if (theme === 'system') {
          setIsDark(tg.colorScheme === 'dark');
        }
      });
    }
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [mounted, theme, resolveTheme]);

  useEffect(() => {
    if (!mounted) return;
    
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    
    // Update Telegram WebApp header color
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.setHeaderColor(isDark ? '#0f172a' : '#f8fafc');
      tg.setBackgroundColor(isDark ? '#0f172a' : '#f8fafc');
    }
  }, [isDark, mounted]);

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <div style={{ visibility: 'hidden' }}>
        {children}
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme, theme, setTheme, isTransitioning }}>
      <div 
        className={`transition-colors duration-300 ${isTransitioning ? 'opacity-95' : 'opacity-100'}`}
        style={{ transitionProperty: 'background-color, color, border-color, opacity' }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
