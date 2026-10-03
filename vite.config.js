import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html, so the board's flash only needs one file.
export default defineConfig(({ mode }) => {
  // Dev only: the app's file requests go to the board (VITE_FLUIDNC_HOST, from the environment or a .env file)
  // or the fake, so they stay same-origin. loadEnv reads .env files the same way the app's import.meta.env does.
  const env = loadEnv(mode, process.cwd(), '')
  const target = `http://${env.VITE_FLUIDNC_HOST || 'localhost:8081'}`
  return {
    plugins: [svelte(), viteSingleFile()],
    server: { proxy: { '/upload': target, '/sd/': target } },
  }
})
