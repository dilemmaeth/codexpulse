import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dashboard',
  base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react(), {
    name: 'codexpulse-offline-manifest',
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'sw-assets.json', source: JSON.stringify(Object.keys(bundle).filter((name) => name.startsWith('assets/'))) });
    },
  }],
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  build: {
    outDir: '../dist/codexpulse',
    emptyOutDir: true,
  },
});
