import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/tpml-website-manager/', // must match your repo name exactly
  plugins: [react()],
  server: {
    port: 5173,
  },
});