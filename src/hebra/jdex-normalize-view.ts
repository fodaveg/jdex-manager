/**
 * Vista previa de «normalizar el frontmatter» (tarea 2 del lote, 28 sep 2026): una fila
 * por nota con hallazgo `frontmatter-mismatch`, su mensaje (ya trae «clave debería ser
 * «X» (es «Y»)» por cada clave, `audit.ts`) y una casilla, todas marcadas por defecto.
 * «Aplicar» solo escribe las marcadas — lista de cambios ANTES de escribir, como pide
 * el contrato del 28 sep, punto 2.
 */
import type { Finding } from './engine';
import { errorBanner, primaryButton } from './jdex-dialog-fields';

export interface JdexNormalizeViewOptions {
  findings: readonly Finding[];
  onApply(chosenPaths: ReadonlySet<string>): Promise<void>;
}

export function mountJdexNormalizeView(el: HTMLElement, options: JdexNormalizeViewOptions): void {
  if (options.findings.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'El frontmatter ya coincide con el índice: nada que normalizar.';
    el.append(empty);
    return;
  }

  const paths = options.findings
    .map((f) => (f.fix?.type === 'frontmatter' ? f.fix.path : null))
    .filter((path): path is string => path !== null);
  const chosen = new Set(paths);
  const list = document.createElement('ul');
  list.className = 'hebra-jdex-normalize-list';
  for (const finding of options.findings) {
    if (finding.fix?.type !== 'frontmatter') continue;
    const path = finding.fix.path;
    const row = document.createElement('li');
    row.className = 'hebra-jdex-normalize-row';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) chosen.add(path);
      else chosen.delete(path);
      refreshApplyLabel();
    });
    const text = document.createElement('span');
    text.textContent = finding.message;
    label.append(checkbox, text);
    row.append(label);
    list.append(row);
  }
  el.append(list);

  const status = errorBanner();
  const apply = primaryButton('', () => void trySubmit());
  el.append(status, apply);

  function refreshApplyLabel(): void {
    apply.textContent = `Aplicar (${chosen.size})`;
  }
  refreshApplyLabel();

  async function trySubmit(): Promise<void> {
    if (chosen.size === 0) {
      status.textContent = 'Marca al menos una nota.';
      return;
    }
    apply.disabled = true;
    try {
      await options.onApply(chosen);
    } finally {
      apply.disabled = false;
    }
  }
}
