/**
 * Ajustes del plugin JDex, por DISPOSITIVO y por biblioteca (`api.storage.settings`,
 * que Hebra guarda en la misma clave que usaba el módulo compilado,
 * `hebra.library-v1.module.jdex-manager.settings:<libraryId>`: no hay migración): un
 * valor configurado nunca se sustituye por la autodetección, y una biblioteca nueva
 * empieza en los valores por defecto del motor (`DEFAULT_SETTINGS`).
 */
import type { PluginSettingsStorage } from 'hebra-plugin-api';
import { DEFAULT_SETTINGS, detectFolders, fillEmpty, type JdexManagerSettings } from './engine';

/** Lo único que este fichero pide a `api.storage.settings`. */
export type JdexSettingsStorage = Pick<PluginSettingsStorage, 'load' | 'save'>;

/** Valida los campos que Hebra permite configurar y conserva los valores por defecto
 *  del motor para los demás. El diario se persiste aparte en la misma clave. */
function normalizeStored(raw: unknown): Partial<JdexManagerSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<JdexManagerSettings> = {};
  const strings: (keyof JdexManagerSettings)[] = [
    'jdexFolder',
    'systemRoot',
    'templatesFolder',
    'reportsFolder',
    'systemId', 'systemIndexNote', 'subfolderPattern'
  ];
  for (const key of strings) {
    const value = source[key];
    if (typeof value === 'string') (out as Record<string, unknown>)[key] = value;
  }
  for (const key of ['createPatternByDefault', 'liveHeaders', 'automaticMaintenance', 'structureNotesAreFindings'] as const) if (typeof source[key] === 'boolean') out[key] = source[key];
  if (source.dateFormat === 'YYYY-MM-DD' || source.dateFormat === 'YYYY-MM') out.dateFormat = source.dateFormat;
  if (typeof source.inboxStaleDays === 'number' && Number.isInteger(source.inboxStaleDays) && source.inboxStaleDays >= 1) out.inboxStaleDays = source.inboxStaleDays;
  if (typeof source.healthMaxFiles === 'number' && Number.isFinite(source.healthMaxFiles) && source.healthMaxFiles >= 0) out.healthMaxFiles = source.healthMaxFiles;
  if (typeof source.subfolderPatternsByCategory === 'object' && source.subfolderPatternsByCategory !== null && !Array.isArray(source.subfolderPatternsByCategory)) {
    out.subfolderPatternsByCategory = Object.fromEntries(Object.entries(source.subfolderPatternsByCategory).filter(([, value]) => typeof value === 'string'));
  }
  return out;
}

/** Ajustes guardados de esta biblioteca, sobre los valores por defecto del motor; sin
 *  nada guardado (o corrupto), `DEFAULT_SETTINGS` tal cual. */
export async function loadJdexSettings(storage: JdexSettingsStorage): Promise<JdexManagerSettings> {
  try {
    const raw = await storage.load<unknown>();
    if (raw === null) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...normalizeStored(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function persistJdexSettings(
  storage: JdexSettingsStorage,
  settings: JdexManagerSettings
): Promise<void> {
  await updateJdexStoredSettings(storage, normalizeStored(settings));
}

const storageTails = new WeakMap<JdexSettingsStorage, Promise<void>>();

/** Serializes settings and journal merges, reading the latest stored value before each save. */
export function updateJdexStoredSettings(storage: JdexSettingsStorage, patch: object): Promise<void> {
  const next = (storageTails.get(storage) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const raw = await storage.load<unknown>();
    const current = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
    await storage.save({ ...current, ...patch });
  });
  storageTails.set(storage, next);
  return next;
}

/**
 * Autodetección (`vendor/jdex-manager/src/jd/detect.ts`): busca `00.00`, `00.02` y
 * `00.03` como carpetas `ÁREA/CATEGORÍA/ID` bajo `settings.systemRoot` y rellena SOLO los
 * campos que siguen vacíos — «un valor configurado nunca se sustituye» (decisión de la
 * sesión de JDex, contrato del 28 sep 2026). `changed` dice si hay algo nuevo que
 * persistir.
 */
export function autodetectJdexSettings(
  settings: JdexManagerSettings,
  folderPaths: readonly string[]
): { settings: JdexManagerSettings; changed: boolean } {
  const detected = detectFolders([...folderPaths], settings.systemRoot);
  const { next, changed } = fillEmpty(settings, detected);
  return { settings: next, changed };
}
