/**
 * Code review of 12 Oct 2026, finding 2: `App.loadLocalStorage`/`saveLocalStorage` are @since 1.8.7
 * and minAppVersion is 1.7.2. Without them the device identity must still persist (one per vault),
 * not change every session; and it must survive an Obsidian update that brings the API.
 */
import { describe, expect, it } from "vitest";
import { DEVICE_KEY, deviceIdentity } from "../src/vault/journal-store";

function memoryStorage() {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

const vaultNamed = (name: string) => ({ getName: () => name });

describe("Device identity on Obsidian before 1.8.7 (finding 2)", () => {
  it("persists in the window's local storage, one key per vault, when the app has no local storage API", () => {
    const storage = memoryStorage();
    const first = deviceIdentity({ vault: vaultNamed("Vault A") }, () => "dev-1", storage);
    expect(first).toBe("dev-1");
    // Next session, same vault: the same identity, not a new `session-…` one.
    expect(deviceIdentity({ vault: vaultNamed("Vault A") }, () => "dev-2", storage)).toBe("dev-1");
    // Another vault on the same device has its own.
    expect(deviceIdentity({ vault: vaultNamed("Vault B") }, () => "dev-3", storage)).toBe("dev-3");
    expect(storage.items.get(`${DEVICE_KEY}:Vault A`)).toBe("dev-1");
  });

  it("keeps the identity of the fallback after Obsidian gains the API", () => {
    const storage = memoryStorage();
    expect(deviceIdentity({ vault: vaultNamed("V") }, () => "dev-old", storage)).toBe("dev-old");
    const local = new Map<string, unknown>();
    const updated = { vault: vaultNamed("V"), loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => void local.set(key, value) };
    expect(deviceIdentity(updated, () => "dev-new", storage)).toBe("dev-old");
    expect(local.get(DEVICE_KEY)).toBe("dev-old");
  });

  it("control: with the API it uses Obsidian's local storage; with no storage at all, a session identity", () => {
    const local = new Map<string, unknown>();
    const host = { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => void local.set(key, value) };
    expect(deviceIdentity(host, () => "dev-1", null)).toBe("dev-1");
    expect(deviceIdentity(host, () => "dev-2", null)).toBe("dev-1");
    expect(deviceIdentity({}, () => "dev-3", null)).toBe("session-dev-3");
  });

  it("falls back when the window's local storage throws", () => {
    const throwing = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(deviceIdentity({ vault: vaultNamed("V") }, () => "dev-1", throwing)).toBe("session-dev-1");
  });
});
