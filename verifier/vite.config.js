// Owner: Archit (frozen; ask before changing) | Vite config for the verifier (port 5274, no proxy, no server URL)
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const SHARED_DIR = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5274,
    strictPort: true,
    // Keep Vite's default (the monorepo root, for core/ and hoisted deps) and name shared/ explicitly.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), SHARED_DIR] },
  },
});
