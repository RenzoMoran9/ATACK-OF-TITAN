/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el build funciona servido desde cualquier carpeta (o como artefacto).
  base: './',
  server: { port: 5173 },
  // Rapier incluye su WASM en base64 (~4 MB): el bundle principal es grande a propósito.
  build: { chunkSizeWarningLimit: 6000 },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
