import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: {proxy: {'/api': {target: 'http://127.0.0.1:3400', changeOrigin: false}}},
  build: {rollupOptions: {output: {manualChunks: {react: ['react', 'react-dom'], markdown: ['marked', 'dompurify']}}}},
});
