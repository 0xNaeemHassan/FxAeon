/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a12',
        surface: 'rgba(255,255,255,0.04)',
        card: '#13131f',
        line: 'rgba(255,255,255,0.08)',
        'line-strong': 'rgba(255,255,255,0.14)',
        mut: '#9498b3',
        // Brand accent — FxAeon Violet. (Token name is historical; see globals.css.)
        mint: '#7c5cff',
        cyan: '#a88bff',
        // Positive / up / long / healthy.
        success: '#22d39a',
        danger: '#ff5a5f',
        warn: '#ffb547',
        // legacy aliases used by older class names
        primary: '#7c5cff',
        accent: '#7c5cff',
        warning: '#ffb547',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
      },
      borderRadius: {
        xl2: '20px',
      },
    },
  },
  plugins: [],
};
