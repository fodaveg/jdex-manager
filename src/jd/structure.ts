/**
 * Numbers and names for new structure: areas, categories, the standard zeros, headers and + children.
 * Pure. Names follow johnnydecimal.com ("the standard zeros") in the user's language.
 */

import { areaCode, type JdIndex } from "./index";
import { parseJdNumber } from "./parse";

/** First area number (10, 20 …) not in use. 00-09 is the system area and is never proposed. Null when full. */
export function nextFreeArea(index: JdIndex): number | null {
  const used = new Set(index.areas.map((a) => a.number));
  for (let a = 10; a <= 90; a += 10) if (!used.has(a)) return a;
  return null;
}

/** First header number (AC.10, AC.20 … AC.90) of a category with no note or folder. Null when all nine exist. */
export function nextFreeHeader(index: JdIndex, category: string): string | null {
  const used = new Set(index.ids.filter((e) => e.category === category).map((e) => e.id));
  for (let x = 10; x <= 90; x += 10) {
    const id = `${category}.${x}`;
    if (!used.has(id)) return id;
  }
  return null;
}

/** The management category of an area: `A0 Gestión del área A0-A9`. */
export function managementCategoryName(area: number): { number: string; title: string } {
  const number = String(area).padStart(2, "0");
  return { number, title: `Gestión del área ${areaCode(area)}` };
}

/** `AC.01 Inbox de la categoría AC` and `AC.09 Archivo de la categoría AC`. */
export function standardZeroNames(category: string): { inbox: { id: string; title: string }; archive: { id: string; title: string } } {
  return {
    inbox: { id: `${category}.01`, title: `Inbox de la categoría ${category}` },
    archive: { id: `${category}.09`, title: `Archivo de la categoría ${category}` },
  };
}

/** Validates a category number typed by the user against its area. */
export function validateNewCategory(index: JdIndex, area: number, raw: string): string | null {
  const n = parseJdNumber(raw.trim());
  if (!n || n.kind !== "category") return "Type a two-digit category like 22.";
  const value = Number(n.category);
  if (value < area || value > area + 9) return `The category must be inside ${areaCode(area)}.`;
  if (value === area) return `${n.category} is the management category of the area.`;
  if (index.categories.some((c) => c.number === n.category)) return `${n.category} already exists.`;
  return null;
}

/** Validates an area typed by the user (`20-29` or `20`). Returns the area number or an error. */
export function parseNewArea(index: JdIndex, raw: string): { area: number } | { error: string } {
  const s = raw.trim();
  let area: number | null = null;
  const n = parseJdNumber(s);
  if (n?.kind === "area") area = n.area;
  else if (/^\d0$/.test(s)) area = Number(s);
  if (area === null) return { error: "Type an area like 20-29." };
  if (area === 0) return { error: "00-09 is the system area." };
  if (index.areas.some((a) => a.number === area)) return { error: `${areaCode(area)} already exists.` };
  return { area };
}
