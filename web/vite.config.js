// Owner: Archit (frozen; ask before changing) | Vite config for the registry app (port 5273, /api -> server)
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
