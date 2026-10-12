import { describe, expect, it } from "vitest";
import { renumberMessage, type RenumberAction } from "../src/jd/pair";
import { jdexRenameNoticeMessage, jdexRenameWarningMessage } from "../src/hebra/jdex-rename-guard";

const unnumbered: RenumberAction = { type: "unnumbered", oldId: "21.11" };
const renumbered: RenumberAction = { type: "renumbered", oldId: "21.11", newId: "21.12" };
const moved: RenumberAction = { type: "moved", id: "21.11", from: "21 A", to: "22 B" };

describe("renumberMessage: the one wording of the never-renumber warning", () => {
  it("keeps Hebra's exact Spanish texts, before and after the change", () => {
    expect(jdexRenameWarningMessage(unnumbered)).toBe("«21.11» perdería su número: un ID nunca se renumera (johnnydecimal.com). ¿Seguro que quieres continuar?");
    expect(jdexRenameWarningMessage(renumbered)).toBe("«21.11» pasaría a «21.12»: un ID nunca se renumera (johnnydecimal.com). ¿Seguro que quieres continuar?");
    expect(jdexRenameWarningMessage(moved)).toBe("«21.11» cambiaría de categoría o área, de «21 A» a «22 B». ¿Seguro que quieres continuar?");
    expect(jdexRenameNoticeMessage(unnumbered)).toBe("«21.11» ha perdido su número: un ID nunca se renumera (johnnydecimal.com). Deshacer.");
    expect(jdexRenameNoticeMessage(renumbered)).toBe("«21.11» ha pasado a «21.12»: un ID nunca se renumera (johnnydecimal.com). Deshacer.");
    expect(jdexRenameNoticeMessage(moved)).toBe("«21.11» ha cambiado de categoría o área, de «21 A» a «22 B». Deshacer.");
  });

  it("Hebra's texts are the shared wording plus Hebra's own ending", () => {
    for (const action of [unnumbered, renumbered, moved]) {
      expect(jdexRenameWarningMessage(action)).toBe(`${renumberMessage(action, "would")} ¿Seguro que quieres continuar?`);
      expect(jdexRenameNoticeMessage(action)).toBe(`${renumberMessage(action, "did")} Deshacer.`);
    }
  });

  it("has an English wording for an English interface", () => {
    expect(renumberMessage(unnumbered, "did", "en")).toBe("21.11 lost its number: an ID is never renumbered (johnnydecimal.com).");
    expect(renumberMessage(renumbered, "did", "en")).toBe("21.11 became 21.12: an ID is never renumbered (johnnydecimal.com).");
    expect(renumberMessage(moved, "would", "en")).toBe("21.11 would move to another category or area, from 21 A to 22 B.");
  });
});
