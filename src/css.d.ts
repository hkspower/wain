// A side-effect `import '@/global.css'` is how the web build picks up the
// font-family custom properties. TypeScript has no idea what a .css file is
// and refuses the import outright, so it is declared here as a module with no
// exports — which is exactly what it is on native, where Metro drops it.
declare module '*.css';
