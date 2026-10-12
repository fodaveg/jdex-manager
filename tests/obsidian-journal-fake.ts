/* In-memory Obsidian vault for journal and undo tests: paths, bodies, frontmatter, folders. */
import { vi } from "vitest";
import { type App, TFile, TFolder } from "obsidian";

type Node = TFile | TFolder;

export interface FakeVault {
  app: App;
  bodies: Map<string, string>;
  frontmatter: Map<string, Record<string, unknown>>;
  file(path: string, body?: string, fm?: Record<string, unknown>, ctime?: number): TFile;
  folder(path: string): TFolder;
  exists(path: string): boolean;
  /** Called inside `vault.process` and `processFrontMatter` before the transform: simulates a concurrent edit. */
  beforeWrite: ((path: string) => void) | null;
  trashed: string[];
  local: Map<string, unknown>;
}

export function fakeVault(): FakeVault {
  const nodes = new Map<string, Node>();
  const bodies = new Map<string, string>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const trashed: string[] = [];
  const local = new Map<string, unknown>();
  let ctimes = 1000;
  const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const children = (path: string) => [...nodes.values()].filter((node) => parentOf(node.path) === path && node.path !== path);
  const fake: FakeVault = {
    app: null as unknown as App,
    bodies,
    frontmatter,
    trashed,
    local,
    beforeWrite: null,
    file(path, body = "", fm, ctime) {
      const name = nameOf(path);
      const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
      const file = Object.assign(new TFile(), {
        path, name, basename: extension ? name.slice(0, -(extension.length + 1)) : name, extension,
        stat: { ctime: ctime ?? (ctimes += 1), mtime: 1, size: body.length },
      });
      Object.defineProperty(file, "parent", { get: () => nodes.get(parentOf(file.path)) ?? { path: parentOf(file.path) }, configurable: true });
      nodes.set(path, file);
      bodies.set(path, body);
      if (fm) frontmatter.set(path, fm);
      return file;
    },
    folder(path) {
      const folder = Object.assign(new TFolder(), { path, name: nameOf(path) });
      Object.defineProperty(folder, "children", { get: () => children(folder.path), configurable: true });
      nodes.set(path, folder);
      return folder;
    },
    exists: (path) => nodes.has(path),
  };
  const move = (node: Node, to: string) => {
    const from = node.path;
    for (const [path, other] of [...nodes]) {
      if (path !== from && !path.startsWith(`${from}/`)) continue;
      const next = to + path.slice(from.length);
      nodes.delete(path);
      Object.assign(other, { path: next, name: nameOf(next) });
      nodes.set(next, other);
      if (bodies.has(path)) { bodies.set(next, bodies.get(path)!); bodies.delete(path); }
      if (frontmatter.has(path)) { frontmatter.set(next, frontmatter.get(path)!); frontmatter.delete(path); }
    }
  };
  fake.app = {
    vault: {
      getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
      getFiles: () => [...nodes.values()].filter((node): node is TFile => node instanceof TFile),
      getMarkdownFiles: () => [...nodes.values()].filter((node): node is TFile => node instanceof TFile && node.extension === "md"),
      getAllLoadedFiles: () => [...nodes.values()],
      read: async (file: TFile) => bodies.get(file.path) ?? "",
      cachedRead: async (file: TFile) => bodies.get(file.path) ?? "",
      modify: vi.fn(async (file: TFile, body: string) => void bodies.set(file.path, body)),
      process: vi.fn(async (file: TFile, transform: (current: string) => string) => {
        fake.beforeWrite?.(file.path);
        const next = transform(bodies.get(file.path) ?? "");
        bodies.set(file.path, next);
        return next;
      }),
      create: vi.fn(async (path: string, body: string) => fake.file(path, body)),
      createFolder: vi.fn(async (path: string) => fake.folder(path)),
    },
    metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: frontmatter.get(file.path) }) },
    fileManager: {
      // Like Obsidian: a throwing callback aborts the write.
      processFrontMatter: vi.fn(async (file: TFile, apply: (fm: Record<string, unknown>) => void) => {
        fake.beforeWrite?.(file.path);
        const copy = JSON.parse(JSON.stringify(frontmatter.get(file.path) ?? {})) as Record<string, unknown>;
        apply(copy);
        frontmatter.set(file.path, copy);
      }),
      renameFile: vi.fn(async (node: Node, to: string) => {
        if (nodes.has(to)) throw new Error(`${to} exists`);
        move(node, to);
      }),
      trashFile: vi.fn(async (node: Node) => {
        for (const path of [...nodes.keys()]) if (path === node.path || path.startsWith(`${node.path}/`)) { nodes.delete(path); bodies.delete(path); }
        trashed.push(node.path);
      }),
    },
    workspace: { layoutReady: true },
    loadLocalStorage: (key: string) => local.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => void local.set(key, value),
  } as unknown as App;
  return fake;
}
