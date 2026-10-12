/**
 * Makes a plain element behave like a link for the keyboard too: it joins the Tab order, is
 * announced as a link and Enter activates it, exactly as a click does. Obsidian's `createEl("a")`
 * gives a bare anchor with no `href`, which browsers neither focus nor activate on Enter.
 */
export function makeKeyboardLink(el: HTMLElement, onActivate: () => void): void {
  el.tabIndex = 0;
  el.setAttribute("role", "link");
  el.addEventListener("click", onActivate);
  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    onActivate();
  });
}
