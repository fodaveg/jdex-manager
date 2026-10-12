// @vitest-environment happy-dom
/**
 * The palette as one table (audit 12 Oct 2026, 5.1 cut 3): every row has a unique id, a
 * «JDex: …» name and a handler, and activation registers exactly the table plus the
 * active-note commands, in the order the palette has always had.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  JDEX_COMMAND_ARCHIVE_NOTE,
  JDEX_COMMAND_COPY_JD_PATH,
  JDEX_COMMAND_COPY_NOTE_ID,
  JDEX_COMMAND_SEARCH_CATEGORY,
  JDEX_COMMAND_SEND_TO_INBOX
} from '../../src/hebra/jdex-active-note-commands';
import { JDEX_COMMANDS, registerJdexCommands, type JdexCommandHandlers } from '../../src/hebra/jdex-commands';
import { activateJdex } from './support/activate';
import { createJdexTestApi } from './support/fakes';

const ACTIVE_NOTE = [JDEX_COMMAND_SEND_TO_INBOX, JDEX_COMMAND_ARCHIVE_NOTE, JDEX_COMMAND_COPY_NOTE_ID, JDEX_COMMAND_COPY_JD_PATH, JDEX_COMMAND_SEARCH_CATEGORY];

function handlers(): JdexCommandHandlers {
  return Object.fromEntries(JDEX_COMMANDS.map((command) => [command.handler, vi.fn()])) as unknown as JdexCommandHandlers;
}

describe('Hebra command table', () => {
  it('has unique ids, unique handlers and «JDex: …» names', () => {
    expect(new Set(JDEX_COMMANDS.map((command) => command.id)).size).toBe(JDEX_COMMANDS.length);
    expect(new Set(JDEX_COMMANDS.map((command) => command.handler)).size).toBe(JDEX_COMMANDS.length);
    for (const command of JDEX_COMMANDS) expect(command.name).toMatch(/^JDex: \S/);
  });

  it('registers one group in table order, each running its handler, and unregisters it', () => {
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    const registered: Array<{ id: string; run: () => unknown }> = [];
    const ui = { registerCommand: vi.fn((command: { id: string; run: () => unknown }) => { registered.push(command); const off = vi.fn(); offs.push(off); return off; }) };
    const table = handlers();
    const off = registerJdexCommands(ui, table, 'main');
    expect(registered.map((command) => command.id)).toEqual(JDEX_COMMANDS.filter((command) => command.group === 'main').map((command) => command.id));
    for (const command of registered) void command.run();
    for (const spec of JDEX_COMMANDS.filter((command) => command.group === 'main')) expect(table[spec.handler]).toHaveBeenCalledOnce();
    off();
    for (const unregister of offs) expect(unregister).toHaveBeenCalledOnce();
  });

  it('activation registers the main group, the active-note commands, then the late group', async () => {
    const { api, fake } = await createJdexTestApi();
    const cleanup = await activateJdex(api);
    const byGroup = (group: string) => JDEX_COMMANDS.filter((command) => command.group === group).map((command) => command.id);
    expect(fake.recorded.commands.map((command) => command.id)).toEqual([...byGroup('main'), ...ACTIVE_NOTE, ...byGroup('late')]);
    for (const command of fake.recorded.commands) expect(typeof command.run).toBe('function');
    await cleanup();
    expect(fake.recorded.commands).toHaveLength(0);
  });
});
