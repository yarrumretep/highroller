import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// One self-contained index.html, so the board's flash only needs one file.
export default defineConfig({
  plugins: [svelte(), viteSingleFile()],
})
