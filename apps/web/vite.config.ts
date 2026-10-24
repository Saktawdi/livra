import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.LIVRA_API_TARGET || 'http://127.0.0.1:3400',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'], markdown: ['marked', 'dompurify'] },
      },
    },
  },
});
