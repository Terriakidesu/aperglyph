import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
  benchmark: {
    include: ['benchmarks/**/*.bench.{ts,tsx}'],
  },
});
