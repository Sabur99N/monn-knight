import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  server: {
    host: true,
    open: true,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          gsap: ['gsap'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['three', 'gsap'],
  },
});
