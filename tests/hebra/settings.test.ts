import { createFakePluginApi } from 'hebra-plugin-api/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import {
  autodetectJdexSettings,
  loadJdexSettings,
  persistJdexSettings,
  type JdexSettingsStorage
} from '../../src/hebra/settings';

/** `api.storage.settings` del host falso: en memoria, JSON como lo guarda Hebra. La clave
 *  (`hebra.library-v1.module.jdex-manager.settings:<libraryId>`) y el aislamiento entre
 *  bibliotecas son de la fachada de Hebra (`createPluginStorage`), no del plugin. */
function memoryStorage() {
  return createFakePluginApi().api.storage.settings;
}

describe('loadJdexSettings / persistJdexSettings', () => {
  it('sin nada guardado, los valores por defecto del motor', async () => {
    expect(await loadJdexSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('guarda y relee solo los campos de esta versión, con el resto por defecto', async () => {
    const storage = memoryStorage();
    const settings = { ...DEFAULT_SETTINGS, jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex' };
    await persistJdexSettings(storage, settings);
    expect(await loadJdexSettings(storage)).toEqual(settings);
  });

  it('lo que se guarda es lo de siempre: solo las cinco claves de texto de la primera versión', async () => {
    // Mismos datos que escribía el módulo compilado (`normalizeStored`): el plugin lee los
    // ajustes ya guardados sin migrar nada.
    const storage = memoryStorage();
    await persistJdexSettings(storage, {
      ...DEFAULT_SETTINGS,
      jdexFolder: 'J',
      systemRoot: 'R',
      templatesFolder: 'T',
      reportsFolder: 'I',
      systemId: 'S'
    });
    expect(await storage.load()).toEqual({
      jdexFolder: 'J',
      systemRoot: 'R',
      templatesFolder: 'T',
      reportsFolder: 'I',
      systemId: 'S'
    });
  });

  it('un valor guardado que no es un objeto (o una lectura que falla) cae a los valores por defecto', async () => {
    for (const raw of ['texto', 42, [1, 2], true]) {
      const storage = memoryStorage();
      await storage.save(raw);
      expect(await loadJdexSettings(storage)).toEqual(DEFAULT_SETTINGS);
    }
    const broken: JdexSettingsStorage = {
      load: () => Promise.reject(new Error('almacén caído')),
      save: async () => {}
    };
    expect(await loadJdexSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });

  it('un campo que no es de esta versión (un valor ajeno) se descarta', async () => {
    const storage = memoryStorage();
    await storage.save({ jdexFolder: 42, otraCosa: 'x' });
    const loaded = await loadJdexSettings(storage);
    expect(loaded).toEqual(DEFAULT_SETTINGS);
  });
});

describe('autodetectJdexSettings', () => {
  const folderPaths = [
    '00-09 Sistema',
    '00-09 Sistema/00 Sistema',
    '00-09 Sistema/00 Sistema/00.00 JDex',
    '00-09 Sistema/00 Sistema/00.02 Auditorías',
    '00-09 Sistema/00 Sistema/00.03 Plantillas',
    '20-29 Trabajo',
    '20-29 Trabajo/21 Productos'
  ];

  it('rellena los tres campos vacíos con lo que detecta', () => {
    const { settings, changed } = autodetectJdexSettings(DEFAULT_SETTINGS, folderPaths);
    expect(changed).toBe(true);
    expect(settings.jdexFolder).toBe('00-09 Sistema/00 Sistema/00.00 JDex');
    expect(settings.reportsFolder).toBe('00-09 Sistema/00 Sistema/00.02 Auditorías');
    expect(settings.templatesFolder).toBe('00-09 Sistema/00 Sistema/00.03 Plantillas');
  });

  it('un valor YA configurado nunca se sustituye', () => {
    const configured = { ...DEFAULT_SETTINGS, jdexFolder: 'Mi JDex a mano' };
    const { settings, changed } = autodetectJdexSettings(configured, folderPaths);
    expect(settings.jdexFolder).toBe('Mi JDex a mano');
    // Los otros dos sí se rellenan: cambia igual.
    expect(changed).toBe(true);
    expect(settings.reportsFolder).not.toBe('');
  });

  it('sin nada que detectar, no cambia nada', () => {
    const { settings, changed } = autodetectJdexSettings(DEFAULT_SETTINGS, []);
    expect(changed).toBe(false);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});
