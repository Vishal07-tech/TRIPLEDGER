/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#EA580C',
        secondary: '#0891B2',
        accent: '#D97706',
        background: '#FFF7ED',
        foreground: '#0F172A',
        card: '#FFFFFF',
        border: '#FCEAE1',
        muted: '#FDF4F0',
        destructive: '#DC2626',
      },
      boxShadow: {
        soft: '0 4px 18px rgba(15, 23, 42, 0.08)',
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'serif'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
