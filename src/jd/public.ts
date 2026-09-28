/**
 * Stable entry point of the pure JDex engine for hosts that are not Obsidian
 * (web, Tauri, CLI). Re-exports the public API of every module in `src/jd/`.
 * It only depends on standard JS: no Obsidian, no Node, no DOM. All paths are
 * relative to the vault root and use "/" as separator.
 * The plugin does not import this file; it exists for external consumers.
 * Exported names are unique across modules (`tests/jd-purity.test.ts` guards it).
 */

export * from "./audit";
export * from "./audit-report";
export * from "./description";
export * from "./detect";
export * from "./files";
export * from "./headers";
export * from "./health";
export * from "./index";
export * from "./journal";
export * from "./pair";
export * from "./parse";
export * from "./patterns";
export * from "./reading-links";
export * from "./retire";
export * from "./settings";
export * from "./structure";
export * from "./system-index";
export * from "./template";
