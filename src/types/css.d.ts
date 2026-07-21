// Allow side-effect imports of CSS files (e.g. `import '@/global.css'`).
// Expo bundles these on web; on native they are a no-op. Without this
// declaration, TypeScript's strict mode errors on the import (TS2882).
declare module '*.css';
