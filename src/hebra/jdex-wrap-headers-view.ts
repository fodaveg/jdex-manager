/**
 * Vista previa de «envolver las listas de cabeceras en marcadores» (tarea 3, comando de
 * migración): una fila por cabecera candidata (`findJdexWrapCandidates`) con su
 * cuerpo antes/después alrededor de `<!-- jdex:hijos -->`, casilla marcada por
 * defecto, y «Aplicar» que solo escribe las marcadas.
 */
import type { JdexWrapCandidate } from './jdex-wrap-headers';
import { errorBanner, primaryButton } from './jdex-dialog-fields';

export interface JdexWrapHeadersViewOptions {
  candidates: readonly JdexWrapCandidate[];
  onApply(chosenIds: ReadonlySet<string>): Promise<void>;
}

function diffPreview(candidate: JdexWrapCandidate): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'hebra-jdex-wrap-preview';
  const addedLines = candidate.after
    .split('\n')
    .filter((line) => !candidate.before.includes(line) || line.trim() === '')
    .slice(0, 6); // slice-seguro: corta un array de líneas, no texto.
  pre.textContent = addedLines.join('\n');
  return pre;
}

export function mountJdexWrapHeadersView(
  el: HTMLElement,
  options: JdexWrapHeadersViewOptions
): void {
  if (options.candidates.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Ninguna cabecera necesita marcadores nuevos.';
    el.append(empty);
    return;
  }

  const chosen = new Set(options.candidates.map((c) => c.noteId));
  const list = document.createElement('ul');
  list.className = 'hebra-jdex-normalize-list';
  for (const candidate of options.candidates) {
    const row = document.createElement('li');
    row.className = 'hebra-jdex-normalize-row';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) chosen.add(candidate.noteId);
      else chosen.delete(candidate.noteId);
      refreshApplyLabel();
    });
    const text = document.createElement('span');
    text.textContent = candidate.label;
    label.append(checkbox, text);
    row.append(label, diffPreview(candidate));
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
      status.textContent = 'Marca al menos una cabecera.';
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
