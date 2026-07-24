/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Sporta live-site palette (sporta.com.kw): burnt orange on charcoal,
        // warm beige content sections.
        brand: {
          DEFAULT: '#FF7B17', // official logo orange
          dark: '#C25A00',
          light: '#F7E9DF',
        },
        ink: {
          DEFAULT: '#171A1E', // charcoal
          soft: '#20252C',
          card: '#1B2026',
        },
        sand: {
          DEFAULT: '#E2DBCE', // warm beige
          light: '#ECE6DB',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
