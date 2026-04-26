import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'
import UnoCSS from 'unocss/vite'
import { resolve } from 'path'
import * as fs from 'fs'

const extractInlineScriptPlugin = () => {
  return {
    name: 'extract-inline-script',
    enforce: 'post' as const,
    transformIndexHtml(html: string) {
      const match = html.match(/<script>(self\["MonacoEnvironment"\].*?)<\/script>/s)
      if (match) {
        fs.writeFileSync(resolve(__dirname, 'dist/monaco-env.js'), match[1])
        return html.replace(match[0], '<script src="/monaco-env.js"></script>')
      }
      return html
    }
  }
}

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    (monacoEditorPlugin as any).default({
      languageWorkers: ['json', 'editorWorkerService'],
    }),
    extractInlineScriptPlugin(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'service-worker.js'
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
