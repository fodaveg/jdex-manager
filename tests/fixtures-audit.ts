/* A small system with exactly one case of each audit finding plus clean entries. */
import type { NoteMeta } from "../src/jd/audit";

export const JDEX = "00-09 Sistema/00 Sistema/00.00 JDex";

export const FOLDERS = [
  "00-09 Sistema",
  "00-09 Sistema/00 Sistema",
  JDEX,
  "00-09 Sistema/00 Sistema/00.01 Inbox",
  "00-09 Sistema/00 Sistema/00.02 Mantenimiento",
  "00-09 Sistema/00 Sistema/00.03 Plantillas",
  "00-09 Sistema/00 Sistema/00.09 Archivo",
  "10-19 Vida",
  "10-19 Vida/11 Salud",
  "10-19 Vida/11 Salud/11.10 ■ Cabecera",
  "10-19 Vida/11 Salud/11.11 Limpio",
  "10-19 Vida/11 Salud/11.11 Limpio/Subcarpeta",
  "10-19 Vida/11 Salud/11.11 Limpio/Subcarpeta/Nivel dos",
  "10-19 Vida/11 Salud/11.12 Sin nota",
  "10-19 Vida/11 Salud/11.13 Carpeta con otro nombre",
  "10-19 Vida/11 Salud/11.15 Duplicada A",
  "10-19 Vida/11 Salud/11.15 Duplicada B",
  "10-19 Vida/11 Salud/12.31 Fuera de sitio",
  "10-19 Vida/35 Categoría fuera de área",
];

export const FILES = [
  `${JDEX}/00.00 JDex.md`,
  `${JDEX}/00.01 Inbox.md`,
  `${JDEX}/00.02 Mantenimiento.md`,
  `${JDEX}/00.03 Plantillas.md`,
  `${JDEX}/00.09 Archivo.md`,
  `${JDEX}/11.10 ■ Cabecera.md`,
  `${JDEX}/11.11 Limpio.md`,
  `${JDEX}/11.13 Nota con un nombre.md`,
  `${JDEX}/11.14 Solo nota.md`,
  `${JDEX}/11.16 Frontmatter mal.md`,
  `${JDEX}/11.17 Repetida.md`,
  `${JDEX}/11.17 Repetida otra vez.md`,
  "00-09 Sistema/00 Sistema/00.03 Plantillas/JDex - id.md",
  "00-09 Sistema/00 Sistema/00.03 Plantillas/factura-colada.pdf",
  "00-09 Sistema/00 Sistema/00.03 Plantillas/70 Adjuntos/imagen.jpg",
  "00-09 Sistema/00 Sistema/00.01 Inbox/cosa.pdf",
  "00-09 Sistema/00 Sistema/00.09 Archivo/viejo.pdf",
  "10-19 Vida/11 Salud/11.10 ■ Cabecera/colado.md",
  "10-19 Vida/11 Salud/11.11 Limpio/2026-01-01 nota.md",
  "10-19 Vida/11 Salud/11.11 Limpio/Subcarpeta/Nivel dos/profundo.pdf",
];

const fm = (jd: string, tipo: string, extra: Record<string, string> = {}): Record<string, unknown> => ({
  jd,
  tipo,
  descripcion: "algo",
  area: "10-19 Vida",
  categoria: "11 Salud",
  ...extra,
});

export const NOTES: NoteMeta[] = [
  { path: `${JDEX}/00.00 JDex.md`, frontmatter: { jd: "00.00", tipo: "id", descripcion: "x", area: "00-09 Sistema", categoria: "00 Sistema" } },
  { path: `${JDEX}/00.01 Inbox.md`, frontmatter: { jd: "00.01", tipo: "id", descripcion: "x", area: "00-09 Sistema", categoria: "00 Sistema" } },
  { path: `${JDEX}/00.02 Mantenimiento.md`, frontmatter: { jd: "00.02", tipo: "id", descripcion: "x", area: "00-09 Sistema", categoria: "00 Sistema" } },
  { path: `${JDEX}/00.03 Plantillas.md`, frontmatter: { jd: "00.03", tipo: "id", descripcion: "x", area: "00-09 Sistema", categoria: "00 Sistema" } },
  { path: `${JDEX}/00.09 Archivo.md`, frontmatter: { jd: "00.09", tipo: "id", descripcion: "x", area: "00-09 Sistema", categoria: "00 Sistema" } },
  { path: `${JDEX}/11.10 ■ Cabecera.md`, frontmatter: fm("11.10", "cabecera") },
  { path: `${JDEX}/11.11 Limpio.md`, frontmatter: fm("11.11", "id") },
  { path: `${JDEX}/11.13 Nota con un nombre.md`, frontmatter: fm("11.13", "id") },
  { path: `${JDEX}/11.14 Solo nota.md`, frontmatter: fm("11.14", "id") },
  { path: `${JDEX}/11.16 Frontmatter mal.md`, frontmatter: { jd: "11.61", tipo: "cabecera", area: "10-19 Vida" } },
  { path: `${JDEX}/11.17 Repetida.md`, frontmatter: fm("11.17", "id") },
  { path: `${JDEX}/11.17 Repetida otra vez.md`, frontmatter: fm("11.17", "id") },
];
