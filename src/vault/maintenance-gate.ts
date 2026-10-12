/** Tells the plugin's own writes from foreign vault events during an automatic maintenance pass. */
import type { Effect } from "../jd/journal";

/** Paths a pass wrote, renamed or created, taken from its effects. */
function ownPaths(effects: readonly Effect[]): Set<string> {
  const out = new Set<string>();
  for (const effect of effects) {
    if (effect.kind === "moved") {
      out.add(effect.from);
      out.add(effect.to);
    } else out.add(effect.path);
  }
  return out;
}

/** Content the pass left in a path, when the effect records it. */
function writtenContent(effects: readonly Effect[], path: string): string | undefined {
  let written: string | undefined;
  for (const effect of effects) {
    if (effect.kind === "note-rewrite" && effect.path === path) written = effect.after;
    else if (effect.kind === "created-note" && effect.path === path) written = effect.content;
  }
  return written;
}

export class MaintenanceGate {
  private observed = new Set<string>();

  /** Starts a pass: events seen from now on are judged when it ends. */
  begin(): void {
    this.observed = new Set();
  }

  /** Records the paths of a vault event that arrived while the pass was running. */
  observe(...paths: (string | undefined)[]): void {
    for (const path of paths) if (path !== undefined) this.observed.add(path);
  }

  /**
   * Ends the pass. True when something other than the pass itself changed the vault meanwhile: a path
   * the effects do not mention, or a written note whose current content is no longer what the pass wrote.
   * `read` returns the current content of a path, or null when it is not a readable file.
   */
  async finish(effects: readonly Effect[], read: (path: string) => Promise<string | null>): Promise<boolean> {
    const own = ownPaths(effects);
    const seen = [...this.observed];
    this.observed = new Set();
    for (const path of seen) {
      if (!own.has(path)) return true;
      const written = writtenContent(effects, path);
      if (written === undefined) continue;
      try {
        if ((await read(path)) !== written) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
}

/** Shows each distinct message once; later repeats are dropped. */
export function onceNotifier(show: (message: string) => void): (message: string) => void {
  const shown = new Set<string>();
  return (message) => {
    if (shown.has(message)) return;
    shown.add(message);
    show(message);
  };
}
