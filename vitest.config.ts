import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    globals: false,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        // Global thresholds — server.ts and device modules need hardware,
        // keeping realistic targets for what's testable without mocks
        statements: 40,
        branches: 35,
        functions: 30,
        lines: 40,
      },
    },
  },
});
