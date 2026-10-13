/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { pwa } from './scripts/pwa.mjs';

export default defineConfig({
  // Rutas relativas: el build funciona servido desde cualquier carpeta (o como artefacto).
  base: './',
  // app instalable: genera dist/sw.js con la versión y los archivos del juego
  plugins: [pwa()],
  server: { port: 5173 },
  // Rapier incluye su WASM en base64 (~4 MB): el bundle principal es grande a propósito.
  build: { chunkSizeWarningLimit: 6000 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
