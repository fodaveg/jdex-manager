/**
 * El diálogo de auditoría (tarea 3 del lote 1): los hallazgos de `auditSystem`,
 * agrupados por tipo con el mismo título que usa el informe del motor (`KIND_TITLES`),
 * cada uno con un enlace que abre la nota o la carpeta. Sin informe `.md` ni arreglos
 * automáticos generales: eso sigue siendo de otro lote — la EXCEPCIÓN es
 * `frontmatter-mismatch` (lote 2, tarea 2, «normalizar el frontmatter»): esos hallazgos
 * ya traían un `Fix{type:'frontmatter'}` desde el lote 1 y ahora tienen «Aplicar», para
 * no duplicar el cálculo de `expectedFrontmatter` en un diálogo aparte.
 */
import { FINDING_KINDS, KIND_TITLES, describeFix, describeFixSide, type Finding } from './engine';

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
  /** Apply the selected preview after the runtime has reaudited live state. */
  repair?(findings: readonly Finding[]): void | Promise<void>;
}

function pathLink(doc: Document, path: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'hebra-jdex-audit-link';
  button.textContent = path;
  button.addEventListener('click', onClick);
  return button;
}

function findingRow(
  doc: Document,
  finding: Finding,
  openPath: (path: string) => void,
  applyFix: ((finding: Finding) => void) | null,
  onSelect?: (selected: boolean) => void
): HTMLLIElement {
  const row = doc.createElement('li');
  row.className = 'hebra-jdex-audit-finding';
  if (finding.fix && onSelect) {
    const label = doc.createElement('label');
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'hebra-jdex-repair-select';
    checkbox.setAttribute('aria-label', `Reparar: ${finding.message}`);
    checkbox.checked = finding.kind === 'frontmatter-mismatch' && finding.fix.type === 'frontmatter' &&
      Object.keys(finding.fix.set).every((key) => ['jd', 'tipo', 'area', 'categoria'].includes(key));
    checkbox.addEventListener('change', () => onSelect(checkbox.checked));
    label.append(checkbox, ' Reparar');
    row.append(label);
  }
  const message = doc.createElement('p');
  message.textContent = finding.message;
  row.append(message);
  if (finding.fix) {
    const effect = doc.createElement('p');
    effect.className = 'hebra-jdex-audit-effect';
    effect.textContent = finding.fix.type === 'frontmatter' ? finding.fix.path : describeFix(finding.fix);
    row.append(effect);
    const side = describeFixSide(finding.fix);
    if (side) {
      const note = doc.createElement('p');
      note.className = 'hebra-jdex-audit-effect-side';
      note.textContent = side;
      row.append(note);
    }
  }
  if (finding.paths.length > 0) {
    const links = doc.createElement('div');
    links.className = 'hebra-jdex-audit-links';
    for (const path of finding.paths) links.append(pathLink(doc, path, () => openPath(path)));
    row.append(links);
  }
  if (applyFix && finding.fix?.type === 'frontmatter') {
    const apply = doc.createElement('button');
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
  const doc = el.ownerDocument;
  const findings = options.findings();
  const problems = findings.filter((f) => !f.informative).length;
  el.classList.add('hebra-jdex-audit');

  const summary = doc.createElement('p');
  summary.className = 'hebra-jdex-audit-summary';
  summary.textContent =
    problems === 0
      ? 'Sin problemas. El sistema y el JDex coinciden.'
      : `${problems} problema(s) que corregir.`;
  el.append(summary);
  const selected = new Set(findings.filter((finding) => finding.kind === 'frontmatter-mismatch' && finding.fix?.type === 'frontmatter' &&
    Object.keys(finding.fix.set).every((key) => ['jd', 'tipo', 'area', 'categoria'].includes(key))));
  let updateSelection: (() => void) | undefined;
  if (options.repair && findings.some((finding) => finding.fix)) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'hebra-jdex-repair-apply';
    const selectionSummary = doc.createElement('p');
    updateSelection = () => {
      button.textContent = `Reparar (${selected.size})`;
      button.disabled = selected.size === 0;
      selectionSummary.textContent = selected.size === 0
        ? 'Selecciona los arreglos que quieres aplicar. Los hallazgos sin arreglo disponible requieren revisión manual.'
        : `${selected.size} arreglo(s) seleccionado(s). Los hallazgos sin arreglo disponible requieren revisión manual.`;
    };
    updateSelection();
    button.addEventListener('click', () => {
      if (selected.size === 0) return;
      void options.repair?.(findings.filter((finding) => selected.has(finding)));
    });
    el.append(button, selectionSummary);
  }

  const applyFix = options.applyFrontmatterFix
    ? (finding: Finding) => void options.applyFrontmatterFix?.(finding)
    : null;

  /** Conserva los grupos del motor dentro de problemas y avisos por separado. */
  function appendSections(parent: HTMLElement, groupedFindings: readonly Finding[]): void {
    for (const kind of FINDING_KINDS) {
      const rows = groupedFindings.filter((f) => f.kind === kind);
      if (rows.length === 0) continue;
      const section = doc.createElement('section');
      section.className = 'hebra-jdex-audit-section';
      const heading = doc.createElement('h3');
      heading.textContent = `${KIND_TITLES[kind]} (${rows.length})`;
      const list = doc.createElement('ul');
      list.className = 'hebra-jdex-audit-list';
      for (const finding of rows) list.append(findingRow(doc, finding, (path) => options.openPath(path), applyFix,
        options.repair ? (chosen) => {
          if (chosen) selected.add(finding); else selected.delete(finding);
          updateSelection?.();
        } : undefined));
      section.append(heading, list);
      parent.append(section);
    }
  }

  appendSections(el, findings.filter((f) => !f.informative));
  const warnings = findings.filter((f) => f.informative);
  if (warnings.length > 0) {
    const details = doc.createElement('details');
    const heading = doc.createElement('summary');
    heading.textContent = `Avisos (${warnings.length})`;
    details.append(heading);
    appendSections(details, warnings);
    el.append(details);
  }

  return () => {
    el.replaceChildren();
    el.classList.remove('hebra-jdex-audit');
  };
}
