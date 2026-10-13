import { describe, expect, it } from 'vitest';
import { pluginErrorMessage } from '../../src/hebra/error-message';

describe('errores de la API 2.0', () => {
  it('enseña el mensaje de un rechazo RPC clonado', () => {
    expect(pluginErrorMessage({
      name: 'PluginApiError', code: 'user-activation-required', message: 'Pulsa copiar de nuevo.'
    })).toBe('Pulsa copiar de nuevo.');
  });
});
