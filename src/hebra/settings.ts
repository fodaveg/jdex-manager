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
    return jdexSettingsFromStored(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Ajustes a partir de un valor guardado (el de `storage.settings.onChange`, por ejemplo). */
export function jdexSettingsFromStored(raw: unknown): JdexManagerSettings {
  return raw === null ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...normalizeStored(raw) };
}

/**
 * Guarda los ajustes. Con `baseline` (los ajustes antes del cambio) escribe SOLO las claves
 * que cambiaron aquí: una clave cambiada desde otra pestaña o dispositivo y no tocada aquí
 * conserva el valor que llegó, en vez de pisarse con la copia en memoria.
 */
export async function persistJdexSettings(
  storage: JdexSettingsStorage,
  settings: JdexManagerSettings,
  baseline?: JdexManagerSettings
): Promise<void> {
  const next = normalizeStored(settings) as Record<string, unknown>;
  if (!baseline) {
    await updateJdexStoredSettings(storage, next);
    return;
  }
  const before = normalizeStored(baseline) as Record<string, unknown>;
  const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));
  if (Object.keys(patch).length > 0) await updateJdexStoredSettings(storage, patch);
}

const storageTails = new WeakMap<JdexSettingsStorage, Promise<void>>();

/**
 * Serializes settings and journal merges, reading the latest stored value before each save.
 * `patch` may be a function of that value, so a journal can be joined with the stored one
 * inside the same serialized write.
 */
export function updateJdexStoredSettings(storage: JdexSettingsStorage, patch: object | ((current: Record<string, unknown>) => object)): Promise<void> {
  const next = (storageTails.get(storage) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const raw = await storage.load<unknown>();
    const current = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    await storage.save({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) });
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
