/*
 * The single in-memory Obsidian host for tests of the vault layer and of the plugin's event flows.
 *
 * Faithful where it can be checked against the typings and the plugin's own contracts:
 *  - a real folder tree: TFolder.children / TFile.parent stay coherent on create, rename and trash;
 *    the root folder has path "/" and is part of `getAllLoadedFiles()`, as in the app;
 *  - the text of each file is the only source of truth; its frontmatter is always derived from it
 *    with the plugin's own YAML reader (the `yaml` package, as Obsidian's `parseYaml`);
 *  - `vault.process` is atomic over the current text; `create` / `createFolder` / `renameFile`
 *    refuse an existing destination or a missing parent;
 *  - write APIs emit `create` / `modify` / `delete` / `rename`, and `fake.settle()` awaits handlers.
 *
 * ASSUMPTIONS about real Obsidian internals that cannot be measured here (mark any new one the same way):
 *  - [A1] The metadata cache lags behind writes. With `cacheDelay: true` a write does not reach
 *    `metadataCache.getFileCache` until `flushCache()`; how long the real delay is, and whether it
 *    is per file or batched, is NOT known. Fixtures created by `file()` are cached at once (they
 *    model files already indexed at startup).
 *  - [A2] Renaming or trashing a folder emits one event for the folder and then one per descendant.
 *  - [A3] `cachedRead` returns the current text (the real one may return a cached copy).
 *  - [A4] `renameFile` does not rewrite links in other notes (the real one does, depending on settings).
 *  - [A5] `processFrontMatter` re-serialises the whole block with `yaml` as 1.14.4 does (read from its asar, not
 *    run here): comments are dropped and `jd: 21.20` becomes `21.2`, so a test that must keep the
 *    text byte for byte cannot use it.
 *
 * Any member of `app`, `app.vault`, `app.fileManager`, `app.metadataCache` or `app.workspace` that
 * is not modelled THROWS (`fake-obsidian-vault: app.vault.foo is not implemented`) instead of
 * returning `undefined`, so a test never passes by touching an API nobody modelled.
 */
import { vi } from "vitest";
import { parse, stringify } from "yaml";
import { type App, TFile, TFolder, type TAbstractFile } from "obsidian";
import { readFrontmatter, setFrontmatterProperty } from "../../src/vault/frontmatter-lines";

type Node = TFile | TFolder;
type Handler = (...args: unknown[]) => unknown;
export type VaultEventName = "create" | "modify" | "delete" | "rename";

export interface FakeObsidianVaultOptions {
  /** The metadata cache only catches up with writes on `flushCache()` (assumption A1). */
  cacheDelay?: boolean;
  /** `fileManager.processFrontMatter` throws, for suites that must prove the plugin never uses it. */
  forbidProcessFrontMatter?: boolean;
}

export interface CachedFrontmatter {
  frontmatter?: Record<string, unknown>;
}

/** Wraps a host object so reading a member that was not modelled throws instead of returning `undefined`. */
export function strict<T extends object>(name: string, target: T): T {
  // Names the test runner, the matchers or the module system probe on any value.
  const probed = new Set(["then", "toJSON", "asymmetricMatch", "nodeType", "tagName", "$$typeof", "constructor", "inspect", "_isMockFunction", "__esModule"]);
  return new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === "symbol" || key in object || probed.has(key)) return Reflect.get(object, key, receiver) as unknown;
      throw new Error(`fake-obsidian-vault: ${name}.${key} is not implemented; model it in tests/support/fake-obsidian-vault.ts before a test touches it`);
    },
  });
}

const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const ROOT = "/";

export class FakeObsidianVault {
  readonly app: App;
  /** Text of every file by path. Writing it directly simulates an edit behind the plugin's back (no event, no cache refresh). */
  readonly bodies = new Map<string, string>();
  /** Frontmatter as Obsidian parses it from the text right now (never the lagging cache). */
  readonly frontmatter = { get: (path: string): Record<string, unknown> | undefined => readFrontmatter(this.bodies.get(path) ?? "") ?? undefined };
  /** Paths sent to the trash, in order. */
  readonly trashed: string[] = [];
  /** `loadLocalStorage` / `saveLocalStorage` contents. */
  readonly local = new Map<string, unknown>();
  /** Files the workspace was asked to open (`getLeaf().openFile`). */
  readonly opened: TFile[] = [];
  /** The spy behind `workspace.getLeaf().openFile`. */
  readonly openFile = vi.fn(async (file: TFile) => void this.opened.push(file));
  /** Queries sent to the global search plugin. */
  readonly searches: string[] = [];
  /** Called inside `vault.process` and `processFrontMatter` before the transform: simulates a concurrent edit. */
  beforeWrite: ((path: string) => void) | null = null;
  readonly root: TFolder;

  private readonly nodes = new Map<string, Node>();
  private readonly cache = new Map<string, CachedFrontmatter>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly workspaceHandlers = new Map<string, Set<Handler>>();
  private readonly pending: unknown[] = [];
  private readonly cacheDelay: boolean;
  private clock = 1000;
  private active: TFile | null = null;
  private layoutReady = true;
  private readyCallbacks: Array<() => void> = [];

  constructor(private readonly options: FakeObsidianVaultOptions = {}) {
    this.cacheDelay = options.cacheDelay ?? false;
    this.root = Object.assign(new TFolder(), { path: ROOT, name: "", parent: null, children: [] as Node[], isRoot: () => true });
    this.nodes.set(ROOT, this.root);
    this.app = this.buildApp();
  }

  // ---- fixtures (silent: no events, as if the file was there when Obsidian started) ----

  /** Adds a file (and its missing parent folders). `fm` is written as a YAML block before `body`. */
  file(path: string, body = "", fm?: Record<string, unknown>, ctime?: number): TFile {
    const text = (fm ? `---\n${Object.entries(fm).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n` : "") + body;
    const file = this.addFile(path, text, ctime);
    this.cache.set(path, { frontmatter: readFrontmatter(text) ?? undefined });
    return file;
  }

  /** Adds a folder (and its missing parents). */
  folder(path: string): TFolder {
    return this.addFolder(path);
  }

  exists(path: string): boolean {
    return this.nodes.has(path);
  }

  /** Edits one frontmatter key by hand, line by line (a user typing in the properties). Refreshes the cache. */
  setFm(path: string, key: string, value: string): void {
    const next = setFrontmatterProperty(this.bodies.get(path) ?? "", key, value);
    if (next === null) throw new Error(`cannot set ${key}`);
    this.bodies.set(path, next);
    this.refreshCache(path);
  }

  setActiveFile(file: TFile | null): void {
    this.active = file;
  }

  /** Whether the workspace layout is ready; `false` queues `onLayoutReady` callbacks until `layoutIsReady()`. */
  setLayoutReady(ready: boolean): void {
    this.layoutReady = ready;
  }

  layoutIsReady(): void {
    this.layoutReady = true;
    const callbacks = this.readyCallbacks;
    this.readyCallbacks = [];
    for (const callback of callbacks) callback();
  }

  // ---- events ----

  /** Fires the handlers registered with `vault.on(name, ...)`, like the app does after a change. */
  emit(name: VaultEventName, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) this.pending.push(handler(...args));
  }

  emitWorkspace(name: string, ...args: unknown[]): void {
    for (const handler of [...(this.workspaceHandlers.get(name) ?? [])]) this.pending.push(handler(...args));
  }

  /** Handlers currently registered with `vault.on(name)`. */
  listeners(name: VaultEventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  /** Awaits every handler that returned a promise, including those started by handlers while waiting. */
  async settle(): Promise<void> {
    while (this.pending.length > 0) await Promise.all(this.pending.splice(0));
  }

  // ---- metadata cache (assumption A1) ----

  /** The cache catches up with the text of every file. */
  flushCache(): void {
    for (const [path, node] of this.nodes) if (node instanceof TFile) this.refreshCache(path);
    for (const [path, node] of this.nodes) if (node instanceof TFile) this.emitMeta("changed", node, this.bodies.get(path) ?? "", this.cache.get(path));
  }

  private refreshCache(path: string): void {
    this.cache.set(path, { frontmatter: readFrontmatter(this.bodies.get(path) ?? "") ?? undefined });
  }

  private afterWrite(path: string): void {
    if (!this.cacheDelay) this.refreshCache(path);
  }

  private metaHandlers = new Map<string, Set<Handler>>();
  private emitMeta(name: string, ...args: unknown[]): void {
    for (const handler of [...(this.metaHandlers.get(name) ?? [])]) this.pending.push(handler(...args));
  }

  // ---- tree ----

  private addFolder(path: string): TFolder {
    const existing = this.nodes.get(path);
    if (existing) {
      if (existing instanceof TFolder) return existing;
      throw new Error(`${path} is a file`);
    }
    const parent = parentPath(path) === "" ? this.root : this.addFolder(parentPath(path));
    const folder = Object.assign(new TFolder(), { path, name: baseName(path), parent, children: [] as Node[], isRoot: () => false });
    parent.children.push(folder);
    this.nodes.set(path, folder);
    return folder;
  }

  private addFile(path: string, text: string, ctime?: number): TFile {
    if (this.nodes.has(path)) throw new Error(`${path} already exists`);
    const parent = parentPath(path) === "" ? this.root : this.addFolder(parentPath(path));
    const name = baseName(path);
    const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
    this.clock += 1;
    const file = Object.assign(new TFile(), {
      path, name, extension, basename: extension ? name.slice(0, -(extension.length + 1)) : name, parent,
      stat: { ctime: ctime ?? this.clock, mtime: this.clock, size: text.length },
    });
    parent.children.push(file);
    this.nodes.set(path, file);
    this.bodies.set(path, text);
    return file;
  }

  private touch(file: TFile): void {
    this.clock += 1;
    file.stat.mtime = this.clock;
    file.stat.size = (this.bodies.get(file.path) ?? "").length;
  }

  private detach(node: Node): void {
    const parent = node.parent;
    if (parent) parent.children.splice(parent.children.indexOf(node), 1);
  }

  /** The node and everything under it, node first. */
  private subtree(node: Node): Node[] {
    return [...this.nodes.values()].filter((other) => other.path === node.path || other.path.startsWith(`${node.path}/`)).sort((a, b) => a.path.length - b.path.length);
  }

  private move(node: Node, to: string): void {
    const from = node.path;
    const destinationParent = parentPath(to) === "" ? this.root : this.nodes.get(parentPath(to));
    if (!(destinationParent instanceof TFolder)) throw new Error(`Folder ${parentPath(to)} does not exist`);
    const moved = this.subtree(node);
    this.detach(node);
    for (const item of moved) {
      const next = to + item.path.slice(from.length);
      this.nodes.delete(item.path);
      const text = this.bodies.get(item.path);
      if (text !== undefined) { this.bodies.set(next, text); this.bodies.delete(item.path); }
      const cached = this.cache.get(item.path);
      if (cached) { this.cache.set(next, cached); this.cache.delete(item.path); }
      Object.assign(item, { path: next, name: baseName(next) });
      if (item instanceof TFile) item.basename = item.extension ? item.name.slice(0, -(item.extension.length + 1)) : item.name;
      this.nodes.set(next, item);
    }
    Object.assign(node, { parent: destinationParent });
    destinationParent.children.push(node);
    for (const item of moved) this.emit("rename", item, from + item.path.slice(to.length));
  }

  private remove(node: Node): void {
    const removed = this.subtree(node);
    this.detach(node);
    for (const item of removed) {
      this.nodes.delete(item.path);
      this.bodies.delete(item.path);
      this.cache.delete(item.path);
    }
    this.trashed.push(node.path);
    for (const item of removed) this.emit("delete", item);
  }

  // ---- the app ----

  private on(registry: Map<string, Set<Handler>>, name: string, handler: Handler) {
    const set = registry.get(name) ?? new Set<Handler>();
    registry.set(name, set);
    set.add(handler);
    return { name, handler, registry };
  }

  private buildApp(): App {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the workspace getter needs the fake, not itself.
    const self = this;
    const read = async (file: TFile) => {
      if (!(file instanceof TFile) || !this.bodies.has(file.path)) throw new Error(`ENOENT: ${file.path}`);
      return this.bodies.get(file.path)!;
    };
    const vault = strict("app.vault", {
      getAbstractFileByPath: (path: string): TAbstractFile | null => this.nodes.get(path) ?? null,
      getRoot: () => this.root,
      getFiles: () => [...this.nodes.values()].filter((node): node is TFile => node instanceof TFile),
      getMarkdownFiles: () => [...this.nodes.values()].filter((node): node is TFile => node instanceof TFile && node.extension === "md"),
      getAllLoadedFiles: () => [...this.nodes.values()],
      read: vi.fn(read),
      cachedRead: vi.fn(read), // assumption A3
      modify: vi.fn(async (file: TFile, body: string) => {
        if (!this.bodies.has(file.path)) throw new Error(`ENOENT: ${file.path}`);
        this.bodies.set(file.path, body);
        this.touch(file);
        this.afterWrite(file.path);
        this.emit("modify", file);
      }),
      process: vi.fn(async (file: TFile, transform: (current: string) => string) => {
        if (!this.bodies.has(file.path)) throw new Error(`ENOENT: ${file.path}`);
        this.beforeWrite?.(file.path);
        // Atomic: read, transform and write with no await between them. A throw aborts the write.
        const next = transform(this.bodies.get(file.path)!);
        if (next !== this.bodies.get(file.path)) {
          this.bodies.set(file.path, next);
          this.touch(file);
          this.afterWrite(file.path);
          this.emit("modify", file);
        }
        return next;
      }),
      create: vi.fn(async (path: string, body: string) => {
        if (this.nodes.has(path)) throw new Error("File already exists.");
        if (parentPath(path) !== "" && !(this.nodes.get(parentPath(path)) instanceof TFolder)) throw new Error(`Folder ${parentPath(path)} does not exist`);
        const file = this.addFile(path, body);
        this.afterWrite(path);
        this.emit("create", file);
        return file;
      }),
      createFolder: vi.fn(async (path: string) => {
        if (this.nodes.has(path)) throw new Error("Folder already exists.");
        if (parentPath(path) !== "" && !(this.nodes.get(parentPath(path)) instanceof TFolder)) throw new Error(`Folder ${parentPath(path)} does not exist`);
        const folder = this.addFolder(path);
        this.emit("create", folder);
        return folder;
      }),
      on: (name: string, handler: Handler) => this.on(this.handlers, name, handler),
      offref: (ref: { name: string; handler: Handler; registry: Map<string, Set<Handler>> }) => void ref.registry.get(ref.name)?.delete(ref.handler),
    });
    const fileManager = strict("app.fileManager", {
      renameFile: vi.fn(async (node: Node, to: string) => {
        if (this.nodes.has(to)) throw new Error("Destination file already exists!");
        this.move(node, to); // assumptions A2, A4
      }),
      trashFile: vi.fn(async (node: Node) => {
        if (!this.nodes.has(node.path)) throw new Error(`ENOENT: ${node.path}`);
        this.remove(node);
      }),
      processFrontMatter: vi.fn(async (file: TFile, change: (fm: Record<string, unknown>) => void) => {
        if (this.options.forbidProcessFrontMatter) throw new Error("processFrontMatter must not be used");
        this.beforeWrite?.(file.path);
        const current = this.bodies.get(file.path) ?? "";
        // As read from obsidian-1.14.4.asar: parse the block to an object, run the callback (a throw
        // aborts the write), stringify the object and splice it back. Assumption A5.
        const match = /^---\n([\s\S]*?\n)---(?:\n|$)/u.exec(current);
        const fm = (match ? (parse(match[1]) as Record<string, unknown> | null) : null) ?? {};
        change(fm);
        const out = stringify(fm);
        this.bodies.set(file.path, match ? current.slice(0, 4) + out + current.slice(4 + match[1].length) : `---\n${out}---\n${current}`);
        this.touch(file);
        this.afterWrite(file.path);
        this.emit("modify", file);
      }),
    });
    const metadataCache = strict("app.metadataCache", {
      getFileCache: (file: TFile): CachedFrontmatter | null => {
        if (this.cacheDelay) return this.cache.get(file.path) ?? null;
        return this.bodies.has(file.path) ? { frontmatter: readFrontmatter(this.bodies.get(file.path)!) ?? undefined } : null;
      },
      on: (name: string, handler: Handler) => this.on(this.metaHandlers, name, handler),
    });
    const workspace = strict("app.workspace", {
      get layoutReady() { return self.layoutReady; },
      getActiveFile: () => this.active,
      on: (name: string, handler: Handler) => this.on(this.workspaceHandlers, name, handler),
      onLayoutReady: (callback: () => void) => { if (this.layoutReady) callback(); else this.readyCallbacks.push(callback); },
      getLeaf: vi.fn((_newLeaf?: unknown) => ({ openFile: this.openFile })),
    });
    return strict("app", {
      vault,
      fileManager,
      metadataCache,
      workspace,
      internalPlugins: { getPluginById: (id: string) => id === "global-search" ? { instance: { openGlobalSearch: (query: string) => void this.searches.push(query) } } : null },
      loadLocalStorage: (key: string) => this.local.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => void this.local.set(key, value),
    }) as unknown as App;
  }
}

export type FakeVault = FakeObsidianVault;

/** The default double for suites that prove the plugin never reformats frontmatter through `processFrontMatter`. */
export function fakeVault(options: FakeObsidianVaultOptions = {}): FakeObsidianVault {
  return new FakeObsidianVault({ forbidProcessFrontMatter: true, ...options });
}
