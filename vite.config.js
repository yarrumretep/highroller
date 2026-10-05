import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// One self-contained index.html, so the board's flash only needs one file.
export default defineConfig(({ mode }) => {
  // Dev only: the app's file requests go to the board (VITE_FLUIDNC_HOST, from the environment or a .env file)
  // or the fake, so they stay same-origin. loadEnv reads .env files the same way the app's import.meta.env does.
  const env = loadEnv(mode, process.cwd(), '')
  const target = `http://${env.VITE_FLUIDNC_HOST || 'localhost:8081'}`
  return {
    plugins: [svelte(), viteSingleFile()],
    define: { __APP_VERSION__: JSON.stringify(version) }, // from package.json, shown in the settings sheet
    // a key starting with ^ is a regex: flash files the app reads at /<name> (config, settings, the backup)
    server: { proxy: { '/upload': target, '/sd/': target, '/files': target, '/fake/': target, '^/[^/]+\\.(yaml|json|bak)$': target } },
  }
})
