/**
 * The palette commands of the Hebra runtime as one table (audit 12 Oct 2026, 5.1 cut 3): id,
 * name and the handler each one runs. The runtime supplies the handlers; a test checks that
 * every row has a unique id, a «JDex: …» name and a handler. The five commands about the
 * active note live in `./jdex-active-note-commands.ts` and are registered between the two
 * groups, in the order the palette has always had.
 */
import type { PluginUi, PluginUnregister } from 'hebra-plugin-api';

export const JDEX_COMMAND_LOCATE = 'jdex-donde-vive-esta-nota';
export const JDEX_COMMAND_TOGGLE = 'jdex-alternar-nota-y-carpeta';
export const JDEX_COMMAND_AUDIT = 'jdex-auditar-el-sistema';
export const JDEX_COMMAND_REPAIR = 'jdex-reparar';
export const JDEX_COMMAND_CREATE_ID = 'jdex-crear-id';
export const JDEX_COMMAND_CREATE_CATEGORY = 'jdex-crear-categoria';
export const JDEX_COMMAND_CREATE_AREA = 'jdex-crear-area';
export const JDEX_COMMAND_CREATE_HEADER = 'jdex-crear-cabecera';
export const JDEX_COMMAND_CREATE_CHILD = 'jdex-crear-id-hijo';
export const JDEX_COMMAND_NORMALIZE_NOTE = 'jdex-normalizar-esta-nota';
export const JDEX_COMMAND_NORMALIZE_ALL = 'jdex-normalizar-toda-la-jdex';
export const JDEX_COMMAND_REFRESH_HEADERS = 'jdex-actualizar-cabeceras';
export const JDEX_COMMAND_REFRESH_INDEX = 'jdex-actualizar-indice';
export const JDEX_COMMAND_WRAP_HEADERS = 'jdex-envolver-cabeceras';
export const JDEX_COMMAND_GOTO_ID = 'jdex-ir-a-un-id';
export const JDEX_COMMAND_PROCESS_INBOX = 'jdex-procesar-inbox';
export const JDEX_COMMAND_UNDO = 'jdex-deshacer-ultima-operacion';
export const JDEX_COMMAND_HEALTH = 'jdex-informe-de-salud';
export const JDEX_COMMAND_SYSTEM_REPORT = 'jdex-informe-del-sistema';
export const JDEX_COMMAND_WRITE_TEMPLATES = 'jdex-escribir-plantillas-integradas';

export type JdexCommandHandler =
  | 'locate'
  | 'toggle'
  | 'audit'
  | 'repair'
  | 'createId'
  | 'createCategory'
  | 'createArea'
  | 'createHeader'
  | 'createChild'
  | 'normalizeNote'
  | 'normalizeAll'
  | 'refreshHeaders'
  | 'refreshIndex'
  | 'wrapHeaders'
  | 'gotoId'
  | 'processInbox'
  | 'undo'
  | 'health'
  | 'systemReport'
  | 'writeTemplates';

export type JdexCommandHandlers = Record<JdexCommandHandler, () => void | Promise<void>>;

/** `main` goes before the active-note commands, `late` after them. */
export type JdexCommandGroup = 'main' | 'late';

export interface JdexCommandSpec {
  readonly id: string;
  readonly name: string;
  readonly handler: JdexCommandHandler;
  readonly group: JdexCommandGroup;
}

export const JDEX_COMMANDS: readonly JdexCommandSpec[] = [
  { id: JDEX_COMMAND_LOCATE, name: 'JDex: dónde vive esta nota', handler: 'locate', group: 'main' },
  { id: JDEX_COMMAND_TOGGLE, name: 'JDex: alternar nota y carpeta', handler: 'toggle', group: 'main' },
  { id: JDEX_COMMAND_AUDIT, name: 'JDex: auditar el sistema', handler: 'audit', group: 'main' },
  { id: JDEX_COMMAND_REPAIR, name: 'JDex: reparar', handler: 'repair', group: 'main' },
  { id: JDEX_COMMAND_CREATE_ID, name: 'JDex: crear ID', handler: 'createId', group: 'main' },
  { id: JDEX_COMMAND_CREATE_CATEGORY, name: 'JDex: crear categoría', handler: 'createCategory', group: 'main' },
  { id: JDEX_COMMAND_CREATE_AREA, name: 'JDex: crear área', handler: 'createArea', group: 'main' },
  { id: JDEX_COMMAND_CREATE_HEADER, name: 'JDex: crear cabecera', handler: 'createHeader', group: 'main' },
  { id: JDEX_COMMAND_CREATE_CHILD, name: 'JDex: crear ID hijo (+)', handler: 'createChild', group: 'main' },
  { id: JDEX_COMMAND_NORMALIZE_NOTE, name: 'JDex: normalizar el frontmatter de esta nota', handler: 'normalizeNote', group: 'main' },
  { id: JDEX_COMMAND_NORMALIZE_ALL, name: 'JDex: normalizar el frontmatter de toda la JDex', handler: 'normalizeAll', group: 'main' },
  { id: JDEX_COMMAND_REFRESH_HEADERS, name: 'JDex: actualizar las listas de cabeceras', handler: 'refreshHeaders', group: 'main' },
  { id: JDEX_COMMAND_REFRESH_INDEX, name: 'JDex: actualizar el índice del sistema', handler: 'refreshIndex', group: 'main' },
  { id: JDEX_COMMAND_WRAP_HEADERS, name: 'JDex: envolver las listas de cabeceras en marcadores', handler: 'wrapHeaders', group: 'main' },
  { id: JDEX_COMMAND_GOTO_ID, name: 'JDex: ir a un ID…', handler: 'gotoId', group: 'main' },
  { id: JDEX_COMMAND_PROCESS_INBOX, name: 'JDex: procesar inbox', handler: 'processInbox', group: 'main' },
  { id: JDEX_COMMAND_UNDO, name: 'JDex: deshacer la última operación', handler: 'undo', group: 'late' },
  { id: JDEX_COMMAND_HEALTH, name: 'JDex: informe de salud del sistema', handler: 'health', group: 'late' },
  { id: JDEX_COMMAND_SYSTEM_REPORT, name: 'JDex: informe del sistema', handler: 'systemReport', group: 'late' },
  { id: JDEX_COMMAND_WRITE_TEMPLATES, name: 'JDex: escribir plantillas integradas en la carpeta de plantillas', handler: 'writeTemplates', group: 'late' }
];

/** Registers the commands of `group` in table order; the result unregisters them all. */
export function registerJdexCommands(
  ui: Pick<PluginUi, 'registerCommand'>,
  handlers: JdexCommandHandlers,
  group: JdexCommandGroup
): PluginUnregister {
  const offs = JDEX_COMMANDS.filter((command) => command.group === group).map((command) =>
    ui.registerCommand({ id: command.id, name: command.name, run: handlers[command.handler] })
  );
  return () => {
    for (const off of offs) off();
  };
}
