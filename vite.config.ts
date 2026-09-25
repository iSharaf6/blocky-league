import { defineConfig } from 'vite';

// Relative base so the build runs from any sub-path (itch.io, CrazyGames, Poki zips).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
