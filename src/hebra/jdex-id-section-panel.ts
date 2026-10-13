/**
 * The «JDex» column view of the Hebra runtime, the section of the active note's ID (audit
 * 12 Oct 2026, 5.1 cut 4). The tab can be mounted again on the same element while it stays
 * open (the active note changes); a request number drops the answer of an older load that
 * arrives late. It reads the runtime state through `state()` at each render.
 */
import type { PluginActiveNote, PluginMarkdown, PluginVault } from 'hebra-plugin-api/v2';
import type { IdEntry, JdIndex, JdexManagerSettings } from './engine';
import { loadJdexIdSection } from './jdex-id-section';
import { mountJdexIdSectionLoading, mountJdexIdSectionView } from './jdex-id-section-view';
import type { JdexLibraryWalk } from './library-index';

export interface JdexIdSectionPanelDeps {
  state(): {
    readonly walk: JdexLibraryWalk | null;
    readonly index: JdIndex | null;
    readonly settings: JdexManagerSettings;
    readonly note: PluginActiveNote | null;
  };
  readonly vault: PluginVault;
  readonly markdown: PluginMarkdown;
  goto(entry: IdEntry): void;
  openNote(id: string): void;
  createChild(): void;
  isoDates(): boolean;
  report(error: unknown, where: string): void;
}

export interface JdexIdSectionPanel {
  mount(el: HTMLElement): void;
  unmount(): void;
  /** Renders again when mounted (new index, active note or date setting). */
  refresh(): void;
}

export function createJdexIdSectionPanel(deps: JdexIdSectionPanelDeps): JdexIdSectionPanel {
  let sectionEl: HTMLElement | null = null;
  let request = 0;
  let unmountView: (() => void) | undefined;

  function render(el: HTMLElement): void {
    sectionEl = el;
    const current = ++request;
    mountJdexIdSectionLoading(el);
    const { walk, index, settings, note } = deps.state();
    if (!walk || !index) return;
    void loadJdexIdSection(deps.vault, deps.markdown, walk, index, settings, note)
      .then((data) => {
        if (current !== request || sectionEl !== el) return;
        unmountView?.();
        unmountView = mountJdexIdSectionView(el, {
          data,
          onGoto: (entry) => deps.goto(entry),
          onOpenNote: (id) => deps.openNote(id),
          onCreateChild: () => deps.createChild(),
          isoDates: () => deps.isoDates()
        });
      })
      .catch((error: unknown) => deps.report(error, 'seccion-del-id'));
  }

  return {
    mount: render,
    unmount() {
      sectionEl = null;
      request += 1;
      unmountView?.();
      unmountView = undefined;
    },
    refresh() {
      if (sectionEl) render(sectionEl);
    }
  };
}
