import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefdfb',
          100: '#d4faf3',
          500: '#14b8a6',
          700: '#0f766e',
          900: '#134e4a'
        }
      },
      boxShadow: {
        soft: '0 10px 25px -15px rgb(20 184 166 / 0.55)'
      }
    }
  },
  plugins: []
};

export default config;
