/**
 * Modals that write (create, repair, inbox, confirmations) register themselves when they
 * open, so unloading the plugin closes them instead of leaving a dialog that keeps writing
 * after the plugin is gone (audit 12 Oct 2026, finding 13).
 */
import type { Modal } from "obsidian";

const open = new Set<Modal>();

/** Call from `onOpen`. The modal leaves the registry when it closes. */
export function trackModal(modal: Modal): void {
  if (open.has(modal)) return;
  open.add(modal);
  const original = typeof modal.onClose === "function" ? modal.onClose.bind(modal) : () => {};
  modal.onClose = () => {
    open.delete(modal);
    original();
  };
}

/** Closes every registered modal (plugin unload). */
export function closeTrackedModals(): void {
  const modals = [...open];
  open.clear();
  for (const modal of modals) modal.close();
}

/** Open registered modals, for tests and diagnostics. */
export function trackedModalCount(): number {
  return open.size;
}
