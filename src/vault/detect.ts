import type { App } from "obsidian";
import { detectFolders, fillEmpty, type DetectedFolders } from "../jd/detect";
import type { JdexManagerSettings } from "../settings";
import { allFolderPaths } from "./scan";

/** Detects 00.00, 00.02 and 00.03 in the live vault, relative to the configured system root. */
export function detectInVault(app: App, settings: JdexManagerSettings): DetectedFolders {
  return detectFolders(allFolderPaths(app), settings.systemRoot);
}

/** Fills the empty folder settings from the vault. Returns whether anything changed. */
export function applyDetection(app: App, settings: JdexManagerSettings): { detected: DetectedFolders; changed: boolean } {
  const detected = detectInVault(app, settings);
  const { next, changed } = fillEmpty(settings, detected);
  if (changed) {
    settings.jdexFolder = next.jdexFolder;
    settings.reportsFolder = next.reportsFolder;
    settings.templatesFolder = next.templatesFolder;
  }
  return { detected, changed };
}
