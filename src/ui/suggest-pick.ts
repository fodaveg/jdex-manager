/**
 * A suggest modal as a promise of the user's choice.
 *
 * Obsidian's `SuggestModal.selectSuggestion` closes the modal, which runs `onClose`, BEFORE it
 * calls `onChooseSuggestion`. Resolving `null` in `onClose` therefore lost every choice (code
 * review of 12 Oct 2026, finding 9). Here the `null` of a close is deferred one microtask and only
 * applies when nothing was chosen by then, so a choice made right after the close still wins.
 */
import type { Modal } from "obsidian";

/** `make` builds the modal around `choose` (its pick callback); it is opened here. */
export function pickFromModal<T>(make: (choose: (value: T) => void) => Modal): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = make((value) => settle(value));
    modal.onClose = () => {
      void Promise.resolve().then(() => settle(null));
    };
    modal.open();
  });
}
