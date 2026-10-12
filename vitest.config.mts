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
      // Initial floor, measured on 12 Oct 2026 (67 files, 527 tests): statements 71.00,
      // branches 67.09, functions 64.58, lines 74.51. A floor against regressions, not a goal:
      // raise it when coverage rises, never lower it to make a red go away.
      thresholds: { statements: 70, branches: 66, functions: 64, lines: 74 },
    },
  },
});
