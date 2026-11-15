import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2023', sourcemap: false },
  preview: { port: 4175, strictPort: true },
  server: { port: 5175 },
  test: { include: ['tests/**/*.test.ts'] },
});
