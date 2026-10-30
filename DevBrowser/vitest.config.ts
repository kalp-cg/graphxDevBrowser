import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'dist-electron/', 'tests/']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  }
});
