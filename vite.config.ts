/// <reference types="vite/client" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2020', outDir: 'dist', sourcemap: false,
    rollupOptions: { input: { main: 'index.html', viewer: 'viewer.html' } },
  },
})
