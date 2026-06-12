/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07090b',
        surface: 'rgba(255,255,255,0.04)',
        line: 'rgba(255,255,255,0.08)',
        'line-strong': 'rgba(255,255,255,0.14)',
        mut: '#8b9492',
        mint: '#2ee6a8',
        cyan: '#67e3f9',
        danger: '#ff6b6b',
        warn: '#ffc24b',
        // legacy aliases used by older class names
        primary: '#2ee6a8',
        accent: '#2ee6a8',
        warning: '#ffc24b',
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
