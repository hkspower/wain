import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' makes asset paths relative so the build works when the
// contents of dist/ are uploaded straight into Hostinger's public_html.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    // Modern browsers only → smaller, faster output (no legacy transpile).
    target: 'es2020',
    cssCodeSplit: true,
    // Warn later; our chunks are intentionally split below.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split rarely-changing framework code into its own chunk so it stays
        // cached across content deploys. Supabase stays in the lazy admin
        // chunk automatically (only the admin imports it).
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
