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
 * Aplica los fixes de las notas de `chosenPaths` (la vista previa marca la ruta de la
 * nota; sin `chosenPaths`, todas). `noteIdByPath` viene de `walk.systemNotes`
 * (adaptador de la biblioteca).
 */
export async function applyJdexFrontmatterFixes(
  library: JdexRewriteLibrary,
  markdown: Pick<PluginMarkdown, 'setProperty'>,
  findings: readonly Finding[],
  noteIdByPath: (path: string) => string | null,
  chosenPaths?: ReadonlySet<string>
): Promise<{ written: string[]; skipped: string[] }> {
  const setById = new Map<string, Record<string, string>>();
  for (const finding of findings) {
    if (finding.kind !== 'frontmatter-mismatch' || finding.fix?.type !== 'frontmatter') continue;
    if (chosenPaths && !chosenPaths.has(finding.fix.path)) continue;
    const id = noteIdByPath(finding.fix.path);
    if (!id) continue;
    setById.set(id, { ...(setById.get(id) ?? {}), ...finding.fix.set });
  }
  return rewriteJdexNotes(
    library,
    [...setById.keys()],
    (current) => {
      const set = setById.get(current.id);
      if (!set) return null;
      let next = current.body;
      for (const [key, value] of Object.entries(set)) next = markdown.setProperty(next, key, value);
      return next === current.body ? null : next;
    },
    'Antes de normalizar el frontmatter JDex'
  );
}
