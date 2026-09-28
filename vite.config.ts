import { themeScript } from '@skyground-media/pipelean-design-system/theme-script'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/.
  base: process.env.GITHUB_PAGES ? '/Spark-AI/' : '/',
  plugins: [
    react(),
    {
      // Applies the saved theme before first paint, so dark mode never flashes.
      name: 'theme-script',
      transformIndexHtml: () => [
        { tag: 'script', children: themeScript(), injectTo: 'head-prepend' },
      ],
    },
  ],
})
