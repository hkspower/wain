/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Placeholder brand palette — adjust to match Sporta's real colors.
        brand: {
          DEFAULT: '#0e7a5f',
          dark: '#0a5c47',
          light: '#e8f5f0',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
