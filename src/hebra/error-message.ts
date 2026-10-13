import { isPluginApiError } from 'hebra-plugin-api/v2';

/** RPC errors cross the frame as plain objects, not Error instances. */
export function pluginErrorMessage(error: unknown): string {
  if (isPluginApiError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}
