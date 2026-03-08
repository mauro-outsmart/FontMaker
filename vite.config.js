import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: process.env.NODE_ENV === 'production' ? '/FontMaker/' : '/',
  build: {
    outDir: 'dist',
  },
});
