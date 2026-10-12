import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./tests/obsidian-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      // Floor against regressions, not a goal: raise it when coverage rises, never lower it to
      // make a red go away. Last measured on 12 Oct 2026 (100 files, 899 tests, with the Hebra
      // bundle built): statements 79.82, branches 73.80, functions 73.09, lines 83.68. The floor
      // below is the first measurement (527 tests) and has not been raised yet.
      thresholds: { statements: 70, branches: 66, functions: 64, lines: 74 },
    },
  },
});
