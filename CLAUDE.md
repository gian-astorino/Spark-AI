# Spark

The frontend of spark.skyground.ai: onboarding for Italian beauty businesses.
Vite + React 19 + TypeScript, pnpm, deployed to GitHub Pages from main.
All UI copy is in Italian; code and comments in English.

## UI: the Pipelean Design System

All UI comes from `@skyground-media/pipelean-design-system` (private, GitHub
Packages). Catalogue: https://skyground-media.github.io/pipelean-design-system/

Setup (already done once per project; check before redoing):
- `.npmrc` at the root: `@skyground-media:registry=https://npm.pkg.github.com`
  and `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`. Never write a
  token into any file; it lives in the NODE_AUTH_TOKEN environment variable.
  pnpm 12 does not expand `${…}` in a project `.npmrc`: the same `_authToken`
  line is also in the user's `~/.npmrc` (and written there by the deploy
  workflow), where it is expanded.
- `import "@skyground-media/pipelean-design-system/styles.css"` once, at the
  app root. No Tailwind in this project: the stylesheet is pre-compiled.
- The Inter font is loaded by this project (the package declares it only).
- `ThemeProvider` wraps the app; `themeScript()` from
  `@skyground-media/pipelean-design-system/theme-script` is the first script
  in <head>.

Rules:
- Build screens only from the package's components and layout primitives
  (Box, Stack, Inline, Grid, Container). No other UI or styling library, no
  CSS files, no raw styled HTML for things the package provides.
- Components accept no `className` or `style`. Never work around it (wrapper
  divs with styles, `asChild` with classes, global CSS). If a look cannot be
  expressed with the props, stop and say it is a gap in the design system.
- Pass meaning, not appearance: `variant="destructive"`, `gap={3}` (scale 0,
  1, 2, 3, 4, 6, 8, 12), responsive values as `{ base: …, md: … }`.
- Spacing belongs to the container, never margins on the child.
- Icons come from the package's own components; if a screen needs a free
  icon, use `@hugeicons/react` with `@hugeicons/core-free-icons`, the same
  set, imported by its published name.
