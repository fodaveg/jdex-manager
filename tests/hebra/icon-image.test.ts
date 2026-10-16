import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build script
import * as build from '../../scripts/build-hebra.mjs';

const { validateIconImage, ICON_IMAGE_PREFIX } = build as {
  validateIconImage(bytes: Buffer): string | null;
  ICON_IMAGE_PREFIX: string;
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** A PNG skeleton: signature, IHDR with the given size, padding and IEND. The validator
 *  reads bytes (as Hebra does), so no real pixel data is needed. */
function png(width: number, height: number, padding = 0): Buffer {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from(SIGNATURE), ihdr, Buffer.alloc(padding), Buffer.from(IEND)]);
}

describe('iconImage de hebra.json', () => {
  it('acepta un PNG cuadrado de 32 a 128 px', () => {
    for (const side of [32, 100, 128]) expect(validateIconImage(png(side, side))).toBeNull();
  });

  it('rechaza lo que no es un PNG, lo truncado y lo que no es cuadrado', () => {
    expect(validateIconImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.repeat(2)))).toMatch(/no es un PNG/);
    const good = png(64, 64);
    expect(validateIconImage(good.subarray(0, good.length - 4))).toMatch(/truncado/);
    const noIhdr = Buffer.from(good);
    noIhdr.write('XXXX', 12, 'ascii');
    expect(validateIconImage(noIhdr)).toMatch(/IHDR/);
    expect(validateIconImage(png(64, 48))).toMatch(/cuadrado/);
  });

  it('rechaza lados fuera de 32 a 128 px', () => {
    expect(validateIconImage(png(31, 31))).toMatch(/32 a 128/);
    expect(validateIconImage(png(129, 129))).toMatch(/32 a 128/);
  });

  it('rechaza más de 32 KiB', () => {
    expect(validateIconImage(png(64, 64, 32 * 1024 - 45))).toBeNull();
    expect(validateIconImage(png(64, 64, 32 * 1024 - 44))).toMatch(/32 KiB/);
  });

  it('assets/hebra-icon.png cumple los límites', () => {
    const bytes = readFileSync(new URL('../../assets/hebra-icon.png', import.meta.url));
    expect(validateIconImage(bytes)).toBeNull();
    expect(bytes.readUInt32BE(16)).toBe(128);
  });

  it('el hebra.json generado lleva iconImage con el PNG del repo y un icon de respaldo que Hebra dibuja', async () => {
    const manifest = (await (build as { buildHebra(): Promise<Record<string, unknown>> }).buildHebra()) as {
      icon: string;
      iconImage: string;
    };
    const bytes = readFileSync(new URL('../../assets/hebra-icon.png', import.meta.url));
    expect(manifest.iconImage).toBe(`${ICON_IMAGE_PREFIX}${bytes.toString('base64')}`);
    expect(manifest.iconImage.startsWith('data:image/png;base64,')).toBe(true);
    expect(manifest.icon).toBe('list');
  });
});
