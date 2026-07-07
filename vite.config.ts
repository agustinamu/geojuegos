import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        siluetas: resolve(import.meta.dirname, 'siluetas/index.html'),
        banderas: resolve(import.meta.dirname, 'banderas/index.html'),
      },
    },
  },
});
