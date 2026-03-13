import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    include: ['three', 'resonance-audio', 'fft.js', 'lil-gui', 'chart.js'],
  },
});
