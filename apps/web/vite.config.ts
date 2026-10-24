import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error The transport is also used by the plain Node static host.
import { networkRelayPlugin } from '../../scripts/network-relay.mjs';
export default defineConfig({
  envDir: '../..',
  plugins: [react(), networkRelayPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'], markdown: ['marked', 'dompurify'] },
      },
    },
  },
});
