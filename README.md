# Spark

Frontend for [spark.skyground.ai](https://spark.skyground.ai). Vite + React + TypeScript,
built on the [Pipelean design system](https://github.com/Skyground-Media/pipelean-design-system).

```bash
pnpm install
pnpm dev
```

## Design system

Until the first release is published to GitHub Packages, the design system is
installed from a packed tarball in `vendor/`. To refresh it from a local checkout:

```bash
cd ../pipelean-design-system/packages/ui && pnpm pack --pack-destination ../../../Spark-AI/vendor
cd ../../../Spark-AI && pnpm install
```

Once it is released, switch to the registry version (imports do not change):

```bash
pnpm add @skyground-media/pipelean-design-system@<version>
```

and add an `.npmrc` pointing `@skyground-media` at `https://npm.pkg.github.com`.

## Deploy

Every push to `main` deploys to GitHub Pages (`.github/workflows/deploy-pages.yml`).
