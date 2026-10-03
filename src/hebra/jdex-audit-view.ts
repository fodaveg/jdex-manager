/**
 * El diálogo de auditoría (tarea 3 del lote 1): los hallazgos de `auditSystem`,
 * agrupados por tipo con el mismo título que usa el informe del motor (`KIND_TITLES`),
 * cada uno con un enlace que abre la nota o la carpeta. Sin informe `.md` ni arreglos
 * automáticos generales: eso sigue siendo de otro lote — la EXCEPCIÓN es
 * `frontmatter-mismatch` (lote 2, tarea 2, «normalizar el frontmatter»): esos hallazgos
 * ya traían un `Fix{type:'frontmatter'}` desde el lote 1 y ahora tienen «Aplicar», para
 * no duplicar el cálculo de `expectedFrontmatter` en un diálogo aparte.
 */
import { FINDING_KINDS, KIND_TITLES, type Finding } from './engine';

export interface JdexAuditViewOptions {
  /** Se llama en cada apertura de pestaña/diálogo: los hallazgos pueden haber cambiado
   *  desde que se montó la vista (un `library-changed` de fondo). */
  findings(): readonly Finding[];
  /** Nota (`.md`) o carpeta: abre la una o selecciona la otra en la barra lateral. */
  openPath(path: string): void;
  /** «Aplicar» de un hallazgo de frontmatter (tarea 2 del lote 2): fusiona sus claves y
   *  vuelve a montar la vista con los hallazgos ya recalculados. Sin ella, esos
   *  hallazgos no llevan botón (compatibilidad con quien monte esta vista sin la
   *  tarea 2 aún, como el propio test del lote 1). */
  applyFrontmatterFix?(finding: Finding): void | Promise<void>;
}

function pathLink(path: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hebra-jdex-audit-link';
  button.textContent = path;
  button.addEventListener('click', onClick);
  return button;
}

function findingRow(
  finding: Finding,
  openPath: (path: string) => void,
  applyFix: ((finding: Finding) => void) | null
): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'hebra-jdex-audit-finding';
  const message = document.createElement('p');
  message.textContent = finding.message;
  row.append(message);
  if (finding.paths.length > 0) {
    const links = document.createElement('div');
    links.className = 'hebra-jdex-audit-links';
    for (const path of finding.paths) links.append(pathLink(path, () => openPath(path)));
    row.append(links);
  }
  if (applyFix && finding.fix?.type === 'frontmatter') {
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'hebra-jdex-audit-apply';
    apply.textContent = 'Aplicar';
    apply.addEventListener('click', () => applyFix(finding));
    row.append(apply);
  }
  return row;
}

/** Monta el contenido y devuelve la limpieza (`unmount`, `host-ui.ts`). Se puede volver
 *  a montar: `options.findings()` se relee cada vez, no se congela al construir. */
export function mountJdexAuditView(el: HTMLElement, options: JdexAuditViewOptions): () => void {
  const findings = options.findings();
  const problems = findings.filter((f) => !f.informative).length;

  const summary = document.createElement('p');
  summary.className = 'hebra-jdex-audit-summary';
  summary.textContent =
    problems === 0
      ? 'Sin problemas. El sistema y el JDex coinciden.'
      : `${problems} problema(s) que corregir.`;
  el.append(summary);

  const applyFix = options.applyFrontmatterFix
    ? (finding: Finding) => void options.applyFrontmatterFix?.(finding)
    : null;

  for (const kind of FINDING_KINDS) {
    const rows = findings.filter((f) => f.kind === kind);
    if (rows.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'hebra-jdex-audit-section';
    const heading = document.createElement('h3');
    heading.textContent = `${KIND_TITLES[kind]} (${rows.length})`;
    const list = document.createElement('ul');
    list.className = 'hebra-jdex-audit-list';
    for (const finding of rows) list.append(findingRow(finding, (path) => options.openPath(path), applyFix));
    section.append(heading, list);
    el.append(section);
  }

  return () => el.replaceChildren();
}
