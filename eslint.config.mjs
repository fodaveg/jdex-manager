import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
  },
  {
    // Build and test tooling runs in Node, never inside Obsidian.
    files: ["vitest.config.mts", "tests/**/*.ts"],
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
]);
