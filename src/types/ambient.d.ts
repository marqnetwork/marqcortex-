// Ambient module declarations for non-code asset imports that the TypeScript
// compiler cannot resolve on its own.
//
// `figma:asset/*` is Figma Make's virtual import scheme for raster assets
// (e.g. `import img from "figma:asset/<hash>.png"`); Vite resolves it at build
// time to a served URL. Vite's own `vite/client` types already cover ordinary
// asset modules (`*.css`, `*.png`, …), so only the Figma virtual scheme needs a
// declaration here.
//
// Scope is deliberately narrow: this must never become a `declare module "*"`
// catch-all that would mask genuine "cannot find module" errors in source.

declare module 'figma:asset/*' {
  const src: string;
  export default src;
}
