/**
 * Folder settings follow their folder by id (audit 12 Oct 2026, finding 15). The settings
 * keep paths (the pure engine works on paths), and next to them the id of the folder each
 * path resolved to. On every walk:
 *  - a configured path that resolves to a live folder is authoritative (a manual change in
 *    the settings panel wins): its id is recorded;
 *  - a path that resolves to nothing, whose recorded folder is still alive under another
 *    path (renamed, moved, or an ancestor renamed), follows it: the setting is updated;
 *  - otherwise nothing changes, and the audit reports the missing folder. Nothing is ever
 *    created at the old path.
 */
import type { JdexManagerSettings } from './engine';
import { updateJdexStoredSettings, type JdexSettingsStorage } from './settings';

export const TRACKED_FOLDER_KEYS = ['jdexFolder', 'systemRoot', 'reportsFolder', 'templatesFolder'] as const;
export type TrackedFolderKey = (typeof TRACKED_FOLDER_KEYS)[number];
export type TrackedFolderIds = Partial<Record<TrackedFolderKey, string>>;

/** Stored next to the settings, in the same per-library key. */
const STORAGE_KEY = 'jdexFolderIds';

export async function loadTrackedFolderIds(storage: JdexSettingsStorage): Promise<TrackedFolderIds> {
  try {
    const raw = await storage.load<Record<string, unknown> | null>();
    const stored = raw?.[STORAGE_KEY];
    if (typeof stored !== 'object' || stored === null) return {};
    const out: TrackedFolderIds = {};
    for (const key of TRACKED_FOLDER_KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function persistTrackedFolderIds(storage: JdexSettingsStorage, ids: TrackedFolderIds): Promise<void> {
  return updateJdexStoredSettings(storage, { [STORAGE_KEY]: ids });
}

export interface FollowedFolder {
  readonly key: TrackedFolderKey;
  readonly from: string;
  readonly to: string;
}

export interface FollowResult {
  readonly settings: JdexManagerSettings;
  readonly ids: TrackedFolderIds;
  /** Settings whose folder was renamed or moved: the path now follows it. */
  readonly moved: readonly FollowedFolder[];
  /** Something to persist (a moved setting or a newly recorded id). */
  readonly changed: boolean;
}

/** `folderPaths`: id → full path of every live folder (`jdexFolderPaths`). */
export function followTrackedFolders(
  settings: JdexManagerSettings,
  ids: TrackedFolderIds,
  folderPaths: ReadonlyMap<string, string>
): FollowResult {
  const idByPath = new Map([...folderPaths].map(([id, path]) => [path, id]));
  let next = settings;
  const nextIds: TrackedFolderIds = { ...ids };
  const moved: FollowedFolder[] = [];
  let changed = false;
  for (const key of TRACKED_FOLDER_KEYS) {
    const path = next[key];
    // Empty: unset (or the library root for `systemRoot`); nothing to follow.
    if (path === '') {
      if (nextIds[key] !== undefined) {
        delete nextIds[key];
        changed = true;
      }
      continue;
    }
    const resolved = idByPath.get(path);
    if (resolved !== undefined) {
      if (nextIds[key] !== resolved) {
        nextIds[key] = resolved;
        changed = true;
      }
      continue;
    }
    const known = nextIds[key];
    const followed = known === undefined ? undefined : folderPaths.get(known);
    if (followed === undefined) continue;
    next = { ...next, [key]: followed };
    moved.push({ key, from: path, to: followed });
    changed = true;
  }
  return { settings: next, ids: nextIds, moved, changed };
}

const LABELS: Record<TrackedFolderKey, string> = {
  jdexFolder: 'La carpeta JDex',
  systemRoot: 'La raíz del sistema',
  reportsFolder: 'La carpeta de informes',
  templatesFolder: 'La carpeta de plantillas'
};

export function followedFolderNotice(moved: FollowedFolder): string {
  return `${LABELS[moved.key]} cambió de sitio: el ajuste pasa de «${moved.from}» a «${moved.to}».`;
}
