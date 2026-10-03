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

/** Solo los campos de la primera versión (carpeta JDex, raíz, plantillas, informes, id
 *  de sistema): el resto del motor (fechado, patrones, autocompletado…) se queda en su
 *  valor por defecto hasta que un lote posterior le dé ajustes propios. */
function normalizeStored(raw: unknown): Partial<JdexManagerSettings> {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<JdexManagerSettings> = {};
  const strings: (keyof JdexManagerSettings)[] = [
    'jdexFolder',
    'systemRoot',
    'templatesFolder',
    'reportsFolder',
    'systemId'
  ];
  for (const key of strings) {
    const value = source[key];
    if (typeof value === 'string') (out as Record<string, unknown>)[key] = value;
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
  await storage.save(normalizeStored(settings));
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
