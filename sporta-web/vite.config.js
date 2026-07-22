import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' makes asset paths relative so the build works when the
// contents of dist/ are uploaded straight into Hostinger's public_html.
export default defineConfig({
  plugins: [react()],
  base: './',
})
