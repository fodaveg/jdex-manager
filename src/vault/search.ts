import type { App } from "obsidian";

/** The core search plugin is not public API: only the pieces used here, checked at runtime. */
interface GlobalSearchHost {
  internalPlugins?: {
    getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (query: string) => void } } | null;
  };
}

/** A search query restricted to one folder, quoted for Obsidian's `path:` operator. */
export function pathQuery(folder: string): string {
  return `path:"${folder.replace(/"/g, '\\"')}/"`;
}

/**
 * Opens the global search pane with `query` typed in. Returns false when the core search plugin
 * is not reachable (disabled, or the private API changed); the caller then falls back.
 */
export function openGlobalSearch(app: App, query: string): boolean {
  const host = app as unknown as GlobalSearchHost;
  const open = host.internalPlugins?.getPluginById?.("global-search")?.instance?.openGlobalSearch;
  if (typeof open !== "function") return false;
  open(query);
  return true;
}
