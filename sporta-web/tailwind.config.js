/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Sporta brand — orange on black (from @sporta.kw).
        brand: {
          DEFAULT: '#F26522', // Sporta orange
          dark: '#C24E12',
          light: '#FFF1E8',
        },
        ink: {
          DEFAULT: '#0d0d0d', // near-black brand base
          soft: '#1a1a1a',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
