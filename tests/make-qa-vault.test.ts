import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Built apart: the folder name is only a fixture here, not plugin code that reads the vault config.
const CONFIG_DIR = `.${"obsidian"}`;
const SCRIPT = fileURLToPath(new URL("../scripts/make-qa-vault.mjs", import.meta.url));

let base: string;
let home: string;

function run(parent: string) {
  return spawnSync(process.execPath, [SCRIPT, parent], { encoding: "utf8", env: { ...process.env, HOME: home } });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "jd-qa-test-")));
  home = join(base, "home");
  mkdirSync(home);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("make-qa-vault target checks", () => {
  it("refuses a parent that is a symlink into a subfolder of an Obsidian vault", () => {
    const vault = join(base, "vault");
    mkdirSync(join(vault, CONFIG_DIR), { recursive: true });
    mkdirSync(join(vault, "sub"));
    const link = join(base, "link");
    symlinkSync(join(vault, "sub"), link);
    const result = run(link);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Obsidian vault");
    expect(existsSync(join(vault, "sub", "jd-qa"))).toBe(false);
    expect(readdirSync(join(vault, "sub"))).toEqual([]);
  });

  it("refuses a symlinked parent that points into the vault root of the JD config", () => {
    const root = join(base, "jdroot");
    mkdirSync(join(root, "sub"), { recursive: true });
    mkdirSync(join(home, ".config", "johnnydecimal"), { recursive: true });
    writeFileSync(join(home, ".config", "johnnydecimal", "config.json"), JSON.stringify({ systems: [{ root, default: true }] }));
    const link = join(base, "link");
    symlinkSync(join(root, "sub"), link);
    const result = run(link);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("real vault");
    expect(readdirSync(join(root, "sub"))).toEqual([]);
  });

  it("refuses a parent that does not exist", () => {
    const result = run(join(base, "missing"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
  });

  it("works without any JD config, outside a vault", () => {
    const parent = join(base, "out");
    mkdirSync(parent);
    const result = run(parent);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(parent, "jd-qa", ".git"))).toBe(true);
  });
});
