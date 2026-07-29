/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Sporta live-site palette (sporta.com.kw): burnt orange on charcoal,
        // warm beige content sections.
        brand: {
          DEFAULT: '#E0561C', // live-site UI orange (sporta.com.kw surfaces)
          bright: '#FF7B17', // official logo orange (accents/gradients)
          dark: '#B8430F',
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
        sans: ['IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
        display: ['Alexandria', 'IBM Plex Sans Arabic', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
