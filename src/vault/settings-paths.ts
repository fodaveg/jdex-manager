/**
 * Folder settings are vault paths. Renaming or moving one of those folders, or any of its
 * ancestors, leaves the setting pointing at a dead path (audit 12 Oct 2026, finding 15).
 * Pure: no Obsidian import.
 */
import { relativeTo } from "../jd/detect";
import type { JdexManagerSettings } from "../settings";

export const FOLDER_SETTING_KEYS = ["jdexFolder", "systemRoot", "reportsFolder", "templatesFolder"] as const;
export type FolderSettingKey = (typeof FOLDER_SETTING_KEYS)[number];

const LABELS: Record<FolderSettingKey, string> = {
  jdexFolder: "JDex folder",
  systemRoot: "System root",
  reportsFolder: "Reports folder",
  templatesFolder: "Templates folder",
};

export interface RenamedFolderSetting {
  key: FolderSettingKey;
  label: string;
  from: string;
  to: string;
}

/** Settings whose folder is `oldPath` or lies inside it, with their path after the rename. */
export function renamedFolderSettings(
  settings: Pick<JdexManagerSettings, FolderSettingKey>,
  oldPath: string,
  newPath: string,
): RenamedFolderSetting[] {
  const out: RenamedFolderSetting[] = [];
  for (const key of FOLDER_SETTING_KEYS) {
    const current = settings[key];
    if (current === "") continue;
    const rest = relativeTo(oldPath, current);
    if (rest === null) continue;
    out.push({ key, label: LABELS[key], from: current, to: rest === "" ? newPath : `${newPath}/${rest}` });
  }
  return out;
}
