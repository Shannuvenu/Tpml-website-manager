import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    base: '/Tpml-website-manager/', // capital T — must match repo name exactly, case included
    plugins: [react()],
    server: {
        port: 5173,
    },
});
