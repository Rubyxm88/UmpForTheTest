import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: process.env.VERCEL_DEV_URL || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
