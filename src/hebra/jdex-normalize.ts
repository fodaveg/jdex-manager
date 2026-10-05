/**
 * «Normalizar el frontmatter jd, tipo, area y categoria» (tarea 2 del lote, 28 sep
 * 2026): mismo cálculo que ya usa la auditoría (`auditSystem`, hallazgo
 * `frontmatter-mismatch`, `Fix{type:'frontmatter'}` — `expectedFrontmatter` por nota) —
 * no uno nuevo, para que los hallazgos del diálogo de auditoría del lote 1 puedan tener
 * «Aplicar» sin duplicar lógica. La auditoría agrupa TODAS las claves que fallan de una
 * nota en un único hallazgo (`audit.ts`), así que una fila de la vista previa = una
 * nota, con casilla propia.
 *
 * `set` fusiona SOLO esas claves con `api.markdown.setProperty` (el mismo escritor de
 * propiedades que usa el editor de Hebra), conservando el resto de la nota byte a
 * byte: no es un `processFrontMatter` que reparsea y reserializa el YAML entero.
 */
import type { PluginMarkdown } from 'hebra-plugin-api';
import type { Finding } from './engine';
import { rewriteJdexNotes, type JdexRewriteLibrary } from './jdex-write';
import { readJdexFrontmatter } from './frontmatter';

/** Los hallazgos de `frontmatter-mismatch` de `findings`, limitados a `path` cuando se
 *  da (comando «de esta nota»); todos, sin filtrar, para «de toda la JDex». Uno por
 *  nota (así los construye `audit.ts`), cada uno con su `fix.set` completo. */
export function frontmatterFindingsFor(findings: readonly Finding[], path?: string): Finding[] {
  return findings.filter(
    (finding) =>
      finding.kind === 'frontmatter-mismatch' &&
      finding.fix?.type === 'frontmatter' &&
      (path === undefined || finding.fix.path === path)
  );
}

/**
 * Aplica los fixes de frontmatter y descripción de las notas de `chosenPaths`
 * (sin `chosenPaths`, todas). `noteIdByPath` viene de `walk.systemNotes`.
 * Compara cada campo con el valor auditado, también al reintentar una revisión
 * obsoleta. Devuelve avisos con el motivo de cada nota o campo omitido.
 */
export async function applyJdexFrontmatterFixes(
  library: JdexRewriteLibrary,
  markdown: Pick<PluginMarkdown, 'setProperty' | 'frontmatterRange'>,
  findings: readonly Finding[],
  noteIdByPath: (path: string) => string | null,
  chosenPaths?: ReadonlySet<string>
): Promise<{ written: string[]; skipped: string[]; warnings: string[] }> {
  const setById = new Map<string, Record<string, string>>();
  const expectedById = new Map<string, Record<string, unknown>>();
  const pathById = new Map<string, string>();
  const warnings = new Set<string>();
  const unavailable = new Set<string>();
  for (const finding of findings) {
    if (!['frontmatter-mismatch', 'missing-description'].includes(finding.kind) || finding.fix?.type !== 'frontmatter') continue;
    if (chosenPaths && !chosenPaths.has(finding.fix.path)) continue;
    const id = noteIdByPath(finding.fix.path);
    if (!id) {
      warnings.add(`${finding.fix.path}: no se pudo escribir porque la nota ya no está en el sistema.`);
      continue;
    }
    pathById.set(id, finding.fix.path);
    setById.set(id, { ...(setById.get(id) ?? {}), ...finding.fix.set });
    if (finding.fix.expected) expectedById.set(id, { ...(expectedById.get(id) ?? {}), ...finding.fix.expected });
  }
  const result = await rewriteJdexNotes(
    {
      noteRead: async (id) => {
        const note = await library.noteRead(id);
        if (!note || note.body === null) {
          unavailable.add(id);
          warnings.add(`${pathById.get(id)}: no se pudo escribir porque ${note ? 'la nota está bloqueada' : 'la nota ya no existe'}.`);
        }
        return note;
      },
      notesRewriteBatch: (entries, options) => library.notesRewriteBatch(entries, options)
    },
    [...setById.keys()],
    (current) => {
      const set = setById.get(current.id);
      if (!set) return null;
      const expected = expectedById.get(current.id);
      const frontmatter = readJdexFrontmatter(current.body, markdown) ?? {};
      let next = current.body;
      for (const [key, value] of Object.entries(set)) {
        if (expected && Object.prototype.hasOwnProperty.call(expected, key) && JSON.stringify(frontmatter[key]) !== JSON.stringify(expected[key])) {
          unavailable.add(current.id);
          warnings.add(`${pathById.get(current.id)}: se omitió ${key} porque cambió desde la auditoría.`);
          continue;
        }
        next = markdown.setProperty(next, key, value);
      }
      return next === current.body ? null : next;
    },
    'Antes de normalizar el frontmatter JDex'
  );
  for (const id of result.skipped) warnings.add(`${pathById.get(id)}: no se pudo escribir porque la nota cambió durante los dos intentos.`);
  return { ...result, skipped: [...new Set([...result.skipped, ...unavailable])], warnings: [...warnings] };
}
