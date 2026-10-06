import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is the billing app's; this one sits beside it.
    port: 5174,
    proxy: { '/api': { target: 'http://localhost:4200', changeOrigin: true } },
  },
  // No sourcemap in the build: it was 2 MB shipped beside the app for nobody.
  build: { outDir: 'dist', sourcemap: false },
});
