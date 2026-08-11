import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    // Issue #93: responsive behavior lives in CSS, so unit tests must see the
    // injected rules (computed styles); jsdom still has no layout engine.
    css: true,
    setupFiles: ['src/test-setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
