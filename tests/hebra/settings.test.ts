import { createFakePluginApiV2 } from 'hebra-plugin-api/v2/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/hebra/engine';
import {
  HEBRA_DEFAULTS,
  autodetectJdexSettings,
  loadJdexSettings,
  persistJdexSettings,
  type JdexSettingsStorage
} from '../../src/hebra/settings';

/** `api.storage.settings` del host falso: en memoria, JSON como lo guarda Hebra. La clave
 *  (`hebra.library-v1.module.jdex-manager.settings:<libraryId>`) y el aislamiento entre
 *  bibliotecas son de la fachada de Hebra (`createPluginStorage`), no del plugin. */
function memoryStorage() {
  return createFakePluginApiV2().api.storage.settings;
}

describe('loadJdexSettings / persistJdexSettings', () => {
  it('sin nada guardado, los valores por defecto del motor', async () => {
    expect(await loadJdexSettings(memoryStorage())).toEqual(HEBRA_DEFAULTS);
  });

  it('guarda y relee solo los campos de esta versión, con el resto por defecto', async () => {
    const storage = memoryStorage();
    const settings = { ...DEFAULT_SETTINGS, jdexFolder: '00-09 Sistema/00 Sistema/00.00 JDex' };
    await persistJdexSettings(storage, settings);
    expect(await loadJdexSettings(storage)).toEqual(settings);
  });

  it('conserva las claves de la primera versión y persiste patrones y cabeceras', async () => {
    // Mismos datos que escribía el módulo compilado (`normalizeStored`): el plugin lee los
    // ajustes ya guardados sin migrar nada.
    const storage = memoryStorage();
    await persistJdexSettings(storage, {
      ...DEFAULT_SETTINGS,
      jdexFolder: 'J',
      systemRoot: 'R',
      templatesFolder: 'T',
      reportsFolder: 'I',
      systemId: 'D01',
      systemIndexNote: '', subfolderPattern: '', subfolderPatternsByCategory: {},
      createPatternByDefault: true, liveHeaders: true, healthMaxFiles: 50,
      automaticMaintenance: false, inboxStaleDays: 30, structureNotesAreFindings: false, dateFormat: 'YYYY-MM-DD'
    });
    expect(await storage.load()).toEqual({
      jdexFolder: 'J',
      systemRoot: 'R',
      templatesFolder: 'T',
      reportsFolder: 'I',
      systemId: 'D01',
      systemIndexNote: '', subfolderPattern: '', subfolderPatternsByCategory: {},
      createPatternByDefault: true, liveHeaders: true, healthMaxFiles: 50,
      automaticMaintenance: false, inboxStaleDays: 30, structureNotesAreFindings: false, dateFormat: 'YYYY-MM-DD',
      autocomplete: true, autocompleteInsert: 'link',
      prefixNamesWithSystem: false, debugLog: false,
      createFolderByDefault: false, descriptionIsFinding: true, noteWithoutFolderIsFinding: false, renamePairsWithoutAsking: false,
      templateNames: DEFAULT_SETTINGS.templateNames
    });
  });

  it('persists the settings Hebra was missing: template names and four switches (263b284a)', async () => {
    const storage = memoryStorage();
    const next = {
      ...DEFAULT_SETTINGS,
      createFolderByDefault: true, descriptionIsFinding: false, noteWithoutFolderIsFinding: true, renamePairsWithoutAsking: true,
      healthMaxFiles: 80,
      templateNames: { ...DEFAULT_SETTINGS.templateNames, id: 'Mi plantilla de ID' }
    };
    await persistJdexSettings(storage, next);
    expect(await loadJdexSettings(storage)).toEqual(next);
  });

  it('a stored template name that is empty or not text keeps the default of that type', async () => {
    const storage = memoryStorage();
    await storage.save({ templateNames: { id: '  ', area: 7, cabecera: 'Mi cabecera' } });
    expect((await loadJdexSettings(storage)).templateNames).toEqual({ ...DEFAULT_SETTINGS.templateNames, cabecera: 'Mi cabecera' });
  });

  it('persists prefixNamesWithSystem and a valid system id, normalized (27d68243)', async () => {
    const storage = memoryStorage();
    await persistJdexSettings(storage, { ...DEFAULT_SETTINGS, systemId: 'D01', prefixNamesWithSystem: true });
    expect(await loadJdexSettings(storage)).toMatchObject({ systemId: 'D01', prefixNamesWithSystem: true });
    await storage.save({ systemId: ' d02 ' });
    expect((await loadJdexSettings(storage)).systemId).toBe('D02');
  });

  it('drops a stored system id the parser cannot read (d1), keeping the default', async () => {
    const storage = memoryStorage();
    await storage.save({ systemId: 'd1', prefixNamesWithSystem: true });
    const loaded = await loadJdexSettings(storage);
    expect(loaded.systemId).toBe('');
    expect(loaded.prefixNamesWithSystem).toBe(true);
  });

  it('el autocompletado de Hebra inserta el número por defecto y respeta lo guardado', async () => {
    expect(HEBRA_DEFAULTS.autocompleteInsert).toBe('number');
    const storage = memoryStorage();
    await storage.save({ autocomplete: false, autocompleteInsert: 'link' });
    expect(await loadJdexSettings(storage)).toMatchObject({ autocomplete: false, autocompleteInsert: 'link' });
    await storage.save({ autocomplete: 'no', autocompleteInsert: 'otro' });
    expect(await loadJdexSettings(storage)).toMatchObject({ autocomplete: true, autocompleteInsert: 'number' });
  });

  it('un valor guardado que no es un objeto (o una lectura que falla) cae a los valores por defecto', async () => {
    for (const raw of ['texto', 42, [1, 2], true]) {
      const storage = memoryStorage();
      await storage.save(raw);
      expect(await loadJdexSettings(storage)).toEqual(HEBRA_DEFAULTS);
    }
    const broken: JdexSettingsStorage = {
      load: () => Promise.reject(new Error('almacén caído')),
      save: async () => {}
    };
    expect(await loadJdexSettings(broken)).toEqual(HEBRA_DEFAULTS);
  });

  it('un campo que no es de esta versión (un valor ajeno) se descarta', async () => {
    const storage = memoryStorage();
    await storage.save({ jdexFolder: 42, otraCosa: 'x' });
    const loaded = await loadJdexSettings(storage);
    expect(loaded).toEqual(HEBRA_DEFAULTS);
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
  it('persists the archive date format and structure opt-in, rejecting unknown formats', async () => {
    const storage = memoryStorage();
    await persistJdexSettings(storage, { ...DEFAULT_SETTINGS, dateFormat: 'YYYY-MM', structureNotesAreFindings: true });
    expect(await loadJdexSettings(storage)).toMatchObject({ dateFormat: 'YYYY-MM', structureNotesAreFindings: true });
    await storage.save({ dateFormat: 'invalid' });
    expect((await loadJdexSettings(storage)).dateFormat).toBe('YYYY-MM-DD');
  });

});
