import { type App, TFile, TFolder } from "obsidian";
import { buildIndex, type JdIndex } from "../jd/index";
import type { JdexManagerSettings } from "../settings";

/** Every folder path in the vault, root excluded. Vault API only, so it is the same on mobile. */
export function allFolderPaths(app: App): string[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFolder => f instanceof TFolder && f.path !== "/" && f.path !== "")
    .map((f) => f.path);
}

/** Every Markdown note path in the vault. */
export function allNotePaths(app: App): string[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
    .map((f) => f.path);
}

/** Builds the JD index from the live vault according to the settings. */
export function scanVault(app: App, settings: JdexManagerSettings): JdIndex {
  return buildIndex({
    systemRoot: settings.systemRoot,
    folderPaths: allFolderPaths(app),
    jdexFolder: settings.jdexFolder,
    notePaths: allNotePaths(app),
  });
}
