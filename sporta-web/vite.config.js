import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/' — the site is served at the domain root (public_html). Absolute
// asset paths are required so deep routes (/product/:slug) and refreshes on
// any route still load /assets/* correctly. ('./' breaks 2-segment routes.)
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // Latest broadly-supported ES: class fields, top-level await, .at(),
    // logical assignment — less downleveling, smaller output.
    target: 'es2022',
    cssCodeSplit: true,
    // Warn later; our chunks are intentionally split below.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split rarely-changing framework code into its own chunk so it stays
        // cached across content deploys. Supabase stays in the lazy admin
        // chunk automatically (only the admin imports it).
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
