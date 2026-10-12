/**
 * `activateJdex` no longer waits for the first walk of the library (the host abandons a
 * slow activation). Tests that read the index right after activating use this wrapper,
 * which also waits for that first rebuild.
 */
import type { HebraPluginApi, PluginCleanup } from 'hebra-plugin-api';
import { activateJdex as activateWithoutWaiting, jdexActivationSettled } from '../../../src/hebra/jdex-runtime';

export async function activateJdex(api: HebraPluginApi): Promise<PluginCleanup> {
  const cleanup = await activateWithoutWaiting(api);
  await jdexActivationSettled(cleanup);
  return cleanup;
}
