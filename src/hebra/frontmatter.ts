/**
 * Frontmatter de una nota JDex, como lo vería Obsidian: YAML de verdad, no el proyector
 * de propiedades de Hebra (`api.markdown.frontmatter`, que no garantiza los tipos YAML).
 * El motor espera un objeto ya parseado en el que `jd: 21.20` sin comillas es el NÚMERO
 * 21.2, no el texto «21.20» (contrato del 28 sep 2026): eso solo lo da un parser YAML
 * real, así que aquí se usa el paquete `yaml` (empaquetado en `hebra-main.mjs`) sobre el
 * texto del bloque, cuyos límites da `api.markdown.frontmatterRange`.
 */
import type { PluginMarkdown } from 'hebra-plugin-api';
import { parse as parseYaml } from 'yaml';

/** Lo único que este fichero pide a `api.markdown`. */
export type JdexFrontmatterMarkdown = Pick<PluginMarkdown, 'frontmatterRange'>;

/**
 * El frontmatter de `markdown` como objeto YAML, o `null` sin frontmatter, con un mapa
 * vacío o inválido (no es un objeto plano: una lista, un escalar, YAML roto). Nunca lanza.
 */
export function readJdexFrontmatter(
  markdown: string,
  api: JdexFrontmatterMarkdown
): Record<string, unknown> | null {
  const range = api.frontmatterRange(markdown);
  if (!range) return null;
  // `end` queda tras el delimitador de cierre y su salto de línea: el contenido va de la
  // línea siguiente a la de apertura hasta el principio de la línea de cierre.
  const block = markdown.slice(range.start, range.end);
  const openingEnd = block.indexOf('\n');
  if (openingEnd < 0) return null;
  const withoutFinalBreak = block.replace(/\r?\n$/u, '');
  const closingStart = withoutFinalBreak.lastIndexOf('\n') + 1;
  const raw = block.slice(openingEnd + 1, Math.max(closingStart, openingEnd + 1));
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/** `frontmatter[key]` como texto recortado, como hace el motor con `asString` + `trim()`
 *  (contrato del 28 sep 2026, punto 1): `''` si falta, es `null` o no tiene texto. */
export function jdexFrontmatterString(
  frontmatter: Record<string, unknown> | null,
  key: string
): string {
  if (!frontmatter) return '';
  const value = frontmatter[key];
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
