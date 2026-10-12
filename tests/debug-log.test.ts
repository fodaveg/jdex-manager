import { describe, expect, it } from "vitest";
import { appendDebugEntry, DEBUG_LOG_MAX_LINES, DEBUG_LOG_TITLE, formatDebugEntry, sanitizeStack } from "../src/jd/public";
import { mergeSettings } from "../src/settings";

const NOW = new Date("2026-10-12T13:00:00.000Z");

describe("debug log entries", () => {
  it("is off by default and a stored non-boolean does not turn it on", () => {
    expect(mergeSettings(null).debugLog).toBe(false);
    expect(mergeSettings({ debugLog: "yes" as unknown as boolean }).debugLog).toBe(false);
    expect(mergeSettings({ debugLog: true }).debugLog).toBe(true);
  });

  it("keeps the date, place, path, error name and frames, but never the message", () => {
    const error = new TypeError("secret note text: Mi diario del 3 de mayo");
    error.stack = [
      "TypeError: secret note text: Mi diario del 3 de mayo",
      "    at rewrite (app://obsidian.md/plugins/jdex-manager/main.js:10:20)",
      "    at async Plugin.audit (/Users/david/vault/plugins/jdex-manager/main.js:30:5)",
    ].join("\n");
    const line = formatDebugEntry(NOW, "audit", error, "00.00 JDex/21.22 Proyecto.md");
    expect(line).toBe("- 2026-10-12T13:00:00.000Z | audit | 00.00 JDex/21.22 Proyecto.md | TypeError | at rewrite (main.js:10:20) < at async Plugin.audit (main.js:30:5)");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("/Users/david");
    expect(line).not.toContain("app://");
  });

  it("reads a JavaScriptCore stack (Obsidian on iOS) and cuts its URLs", () => {
    const stack = "rewrite@app://obsidian.md/plugins/jdex-manager/main.js:10:20\nglobal code@\nasync@[native code]";
    expect(sanitizeStack(stack)).toBe("rewrite@main.js:10:20 < global code@ < async@[native code]");
  });

  it("handles a thrown value that is not an Error, a missing stack and hostile text", () => {
    expect(formatDebugEntry(NOW, "x", "text with content", undefined)).toBe("- 2026-10-12T13:00:00.000Z | x | - | string | -");
    expect(sanitizeStack(undefined)).toBe("-");
    const odd = Object.assign(new Error("m"), { name: "Bad\nName | with pipes" });
    expect(formatDebugEntry(NOW, "w\nhere|x", odd, "a|b\nc").split("\n")).toHaveLength(1);
    expect(formatDebugEntry(NOW, "w", odd)).toContain("| Error |");
    const longPath = "p".repeat(500);
    expect(formatDebugEntry(NOW, "w", new Error("m"), longPath).split(" | ")[2]).toHaveLength(200);
  });

  it("caps the frames", () => {
    const stack = ["Error: m", ...Array.from({ length: 30 }, (_, i) => `    at f${i} (file.js:${i}:1)`)].join("\n");
    expect(sanitizeStack(stack).split(" < ")).toHaveLength(6);
  });
});

describe("debug log note body", () => {
  it("a new note gets the explanation, the title and the first line", () => {
    const body = appendDebugEntry(null, "- one");
    expect(body.startsWith(`# ${DEBUG_LOG_TITLE}\n`)).toBe(true);
    expect(body).toContain("<!-- jdex:registro -->\n- one\n");
    expect(body).not.toMatch(/[:*?"<>|\\]/u.exec(DEBUG_LOG_TITLE)?.[0] ?? "\u0000");
  });

  it("keeps only the last 200 lines and the explanation once", () => {
    let body: string | null = null;
    for (let i = 1; i <= DEBUG_LOG_MAX_LINES + 25; i += 1) body = appendDebugEntry(body, `- entry ${i}`);
    const lines = body!.split("\n").filter((line) => line.startsWith("- entry"));
    expect(lines).toHaveLength(DEBUG_LOG_MAX_LINES);
    expect(lines[0]).toBe("- entry 26");
    expect(lines.at(-1)).toBe(`- entry ${DEBUG_LOG_MAX_LINES + 25}`);
    expect(body!.match(/jdex:registro/gu)).toHaveLength(1);
    expect(body!.match(/^# /gmu)).toHaveLength(1);
  });

  it("keeps what the user wrote above the marker, and re-adds a deleted marker", () => {
    const edited = appendDebugEntry(null, "- a").replace("Puedes borrar", "Mi comentario. Puedes borrar");
    expect(appendDebugEntry(edited, "- b")).toContain("Mi comentario.");
    const noMarker = appendDebugEntry("# Mi nota\n\nTexto.\n", "- c");
    expect(noMarker).toBe("# Mi nota\n\nTexto.\n\n<!-- jdex:registro -->\n- c\n");
  });
});

describe("sanitizeStack with spaces and other hosts", () => {
  const at = (location: string) => `Error\n    at fn (${location})`;
  it.each([
    [`/Users/Ana Lopez/Mi Vault/.${"obsidian"}/plugins/jdex/main.js:10:5`, "main.js:10:5"],
    ["C:\\Users\\Ana Lopez\\Vault\\main.js:3:4", "main.js:3:4"],
    ["file:///Users/ana/My Notes/x.js:7:8", "x.js:7:8"],
    ["app://obsidian.md/plugins/Mi Vault/main.js:1:2", "main.js:1:2"],
  ])("V8 location %s keeps only the file name", (location, expected) => {
    const out = sanitizeStack(at(location));
    expect(out).toBe(`at fn (${expected})`);
    expect(out).not.toMatch(/Ana|Lopez|Vault|Notes|Users/u);
  });

  it("JavaScriptCore frames (iOS) lose the scheme and directories", () => {
    const out = sanitizeStack("run@capacitor://localhost/Mi Vault/plugins/main.js:10:5\nother@app://obsidian.md/x y/main.js:1:2");
    expect(out).toBe("run@main.js:10:5 < other@main.js:1:2");
  });

  it("keeps a bare file name and an anonymous frame", () => {
    expect(sanitizeStack("Error\n    at main.js:1:2")).toBe("at main.js:1:2");
    expect(sanitizeStack("Error\n    at new Foo (<anonymous>)")).toBe("at new Foo (<anonymous>)");
  });
});
