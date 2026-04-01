import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-cyan': { DEFAULT: '#00D4FF', light: '#00BCD4', dark: '#0099CC' },
        'brand-navy': { DEFAULT: '#0A0E27', light: '#1a1e3f', dark: '#050711' },
        'chameleon': {
          magenta: '#FF1493', pink: '#E91E63', purple: '#9C27B0',
          violet: '#673AB7', blue: '#2196F3', 'blue-light': '#03A9F4',
          cyan: '#00BCD4', green: '#4CAF50', 'green-light': '#8BC34A',
          lime: '#CDDC39', yellow: '#FFEB3B', amber: '#FFC107',
          orange: '#FF9800', 'orange-deep': '#FF5722', red: '#F44336',
        },
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
      fontFamily: {
        sans: ['var(--font-roboto)', 'Roboto', 'sans-serif'],
        heading: ['var(--font-limelight)', 'Limelight', 'sans-serif'],
      },
    },
  },
  plugins: [typography],
};

export default config;
