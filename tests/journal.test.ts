import { describe, expect, it } from "vitest";
import { describeUndo, type Operation, pushOperation, removeLine } from "../src/jd/journal";

const op = (label: string, effects: Operation["effects"] = [{ kind: "created-folder", path: "x" }]): Operation => ({ kind: "create-id", label, at: "2026-09-16T10:00:00Z", effects });

describe("pushOperation", () => {
  it("appends and trims to the last N", () => {
    let j: Operation[] = [];
    for (let i = 0; i < 5; i++) j = pushOperation(j, op(`op ${i}`), 3);
    expect(j.map((o) => o.label)).toEqual(["op 2", "op 3", "op 4"]);
  });

  it("ignores operations without effects", () => {
    expect(pushOperation([], op("nothing", []))).toEqual([]);
  });
});

describe("describeUndo", () => {
  it("lists the inverse of each effect, last effect first", () => {
    const lines = describeUndo({
      kind: "retire",
      label: "Retire 21.22",
      at: "",
      effects: [
        { kind: "moved", from: "21/21.22 X", to: "21/21.09 Archivo/2026-09-16 21.22 X" },
        { kind: "frontmatter", path: "00.00/21.22 X.md", previous: { tipo: "id", archivado: undefined } },
        { kind: "line", path: "00.00/21.22 X.md", line: "Retirado el 2026-09-16." },
      ],
    });
    expect(lines).toEqual([
      'Remove the line "Retirado el 2026-09-16." from 00.00/21.22 X.md.',
      "Restore tipo, archivado in the frontmatter of 00.00/21.22 X.md.",
      "Move 21/21.09 Archivo/2026-09-16 21.22 X back to 21/21.22 X.",
    ]);
  });
});

describe("removeLine", () => {
  it("removes the line and the blank line the plugin added after it", () => {
    expect(removeLine("# T\n\nRetirado.\n\nBody", "Retirado.")).toBe("# T\n\nBody");
  });

  it("returns null when the line is gone", () => {
    expect(removeLine("# T\nBody", "Retirado.")).toBeNull();
  });
});
