import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        'content-script': resolve(__dirname, 'src/content-script.ts'),
      },
      output: {
        format: 'iife',
        name: 'BtoolsContentScript',
        inlineDynamicImports: true,
        entryFileNames: 'content-script.js',
      },
    },
  },
})