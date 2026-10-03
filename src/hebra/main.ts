/**
 * Entrada de JDex Manager como plugin EXTERNO de Hebra (`hebra-main.mjs`, manifiesto
 * `hebra.json`). Hebra importa este módulo y llama a `activate(api)`; lo que devuelve es
 * la limpieza que corre al apagar el plugin. La entrada de Obsidian (`src/main.ts`) no
 * importa nada de `src/hebra/`, y esta no importa nada de Obsidian.
 */
import type { HebraPluginApi, PluginCleanup } from 'hebra-plugin-api';
import { activateJdex } from './jdex-runtime';

export function activate(api: HebraPluginApi): Promise<PluginCleanup> {
  return activateJdex(api);
}
