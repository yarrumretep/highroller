import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Dev only: the app's file requests go to the board (VITE_FLUIDNC_HOST) or the fake, so they stay same-origin.
const target = `http://${process.env.VITE_FLUIDNC_HOST || 'localhost:8081'}`

// One self-contained index.html, so the board's flash only needs one file.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
  server: { proxy: { '/upload': target, '/sd/': target } },
})
