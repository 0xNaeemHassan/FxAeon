/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0b5cab',
        accent: '#00d4aa',
        danger: '#ef4444',
        warning: '#f59e0b',
      },
    },
  },
  plugins: [],
};
