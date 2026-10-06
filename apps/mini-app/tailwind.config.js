/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Semantic colors resolve through the same runtime CSS tokens used by
        // the component layer. Theme changes therefore cannot leave Tailwind
        // utilities stuck on a compile-time violet palette.
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        card: 'var(--card)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        mut: 'var(--mut)',
        mint: 'var(--mint)',
        cyan: 'var(--cyan)',
        success: 'var(--success)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        // Legacy names remain aliases, not independent color definitions.
        primary: 'var(--mint)',
        accent: 'var(--mint)',
        warning: 'var(--warn)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
      },
      borderRadius: {
        xl2: 'var(--radius-lg)',
      },
    },
  },
  plugins: [],
};
