#!/usr/bin/env node
/**
 * Generates the JDex Manager QA vault `jd-qa`: a throwaway Johnny.Decimal vault with planted defects,
 * a git repository and one initial commit, so a QA round can be restored with git.
 *
 * Usage: node scripts/make-qa-vault.mjs <parent-folder>
 *   Creates <parent-folder>/jd-qa. The parent is mandatory: this script never guesses a location.
 *
 * Safe by construction:
 *   - Refuses a target inside the real vault (~/Documents/fodaveg) or inside any Obsidian vault.
 *   - Idempotent: it only creates what is missing (never overwrites a file), runs `git init` and the
 *     initial commit only when the repository has no commits yet.
 *
 * This is tooling, not plugin code: it uses node:fs on purpose and is never bundled.
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SYS = "00-09 Gestión del sistema/00 Gestión del sistema";
const JDEX = `${SYS}/00.00 JDex del sistema`;
const REPORTS = `${SYS}/00.02 Mantenimiento y auditorías`;
const TEMPLATES = `${SYS}/00.03 Plantillas`;
const WORK = "20-29 Trabajo y productos";
const CAT21 = `${WORK}/21 Productos`;

/** Frontmatter exactly as the built-in templates write it (src/jd/template.ts). */
function note({ jd, tipo = "id", descripcion = "", area = "Trabajo y productos", categoria = "Productos", title, heading, extra = "" }) {
  const lines = ["---", `jd: "${jd}"`, `tipo: ${tipo}`, `descripcion: ${descripcion === "" ? '""' : `"${descripcion}"`}`];
  if (area !== null) lines.push(`area: "${area}"`);
  if (categoria !== null) lines.push(`categoria: "${categoria}"`);
  lines.push("---", `# ${heading ?? title}`, "", extra);
  return `${lines.join("\n")}\n`;
}

const CONTENT = "## Contenido\n\n## Dónde vive\n\n## Relacionado\n";

/** The fixture: [relative path, content]. Folders are implied by file paths; empty ones carry `.gitkeep`. */
function fixture() {
  const files = [];
  const add = (path, content) => files.push([path, content]);
  const keep = (folder) => add(`${folder}/.gitkeep`, "");

  // --- 00 management area: 00.00 JDex (all notes live here), inbox, reports, templates
  add(
    `${JDEX}/00.00 JDex del sistema.md`,
    `---\njd: "00.00"\ntipo: id\ndescripcion: "Índice del sistema de prueba"\narea: "Gestión del sistema"\ncategoria: "Gestión del sistema"\n---\n# 00.00 JDex del sistema\n\nTodo lo que hay fuera de los marcadores se conserva.\n\n<!-- jdex:indice -->\n<!-- /jdex:indice -->\n\nPie de la nota que no debe tocarse.\n`,
  );
  add(`${SYS}/00.01 Inbox temporal/apunte.md`, "# Apunte\n\nFichero de inbox para Procesar inbox.\n");
  // 1x1 transparent PNG
  add(`${SYS}/00.01 Inbox temporal/foto.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==", "base64"));
  keep(REPORTS);
  keep(TEMPLATES);
  // Notes for the standard zero IDs, so the audit does not drown the planted defects in noise.
  for (const [id, title, area, categoria] of [
    ["00.01", "Inbox temporal", "Gestión del sistema", "Gestión del sistema"],
    ["00.02", "Mantenimiento y auditorías", "Gestión del sistema", "Gestión del sistema"],
    ["00.03", "Plantillas", "Gestión del sistema", "Gestión del sistema"],
    ["21.01", "Inbox", "Trabajo y productos", "Productos"],
    ["21.09", "Archivo", "Trabajo y productos", "Productos"],
  ]) {
    add(`${JDEX}/${id} ${title}.md`, note({ jd: id, title, heading: `${id} ${title}`, area, categoria, descripcion: title, extra: CONTENT }));
  }

  // --- 21 Productos (default system)
  add(`${CAT21}/21.01 Inbox/nota-a.md`, "# Nota A\n\nPara mover a un ID.\n");
  add(`${CAT21}/21.01 Inbox/nota-b.md`, "# Nota B\n\nPara archivar.\n");
  keep(`${CAT21}/21.09 Archivo`);

  // 21.10 header without children list
  add(`${JDEX}/21.10 ■ Cabecera.md`, note({ jd: "21.10", tipo: "cabecera", title: "Cabecera", heading: "21.10 ■ Cabecera", extra: "Cabecera del JDex: agrupa los IDs de este bloque y no contiene archivos.\n\nTexto propio antes de los marcadores.\n\n<!-- jdex:hijos -->\n<!-- /jdex:hijos -->\n\nTexto propio después de los marcadores.\n" }));

  // 21.11 Alfa: folder with 3 files; note WITHOUT description
  add(`${JDEX}/21.11 Alfa.md`, note({ jd: "21.11", title: "Alfa", heading: "21.11 Alfa", extra: CONTENT }));
  add(`${CAT21}/21.11 Alfa/informe.md`, "# Informe\n\nContenido de prueba.\n");
  add(`${CAT21}/21.11 Alfa/datos.csv`, "a,b\n1,2\n");
  add(`${CAT21}/21.11 Alfa/borrador.md`, "# Borrador\n");

  // 21.12 Beta: note only, wrong `jd` on purpose
  add(`${JDEX}/21.12 Beta.md`, note({ jd: "21.99", title: "Beta", heading: "21.12 Beta", descripcion: "Nota con jd equivocado", extra: CONTENT }));

  // 21.13: folder named Gama, note named Gamma (different names on purpose)
  add(`${JDEX}/21.13 Gamma.md`, note({ jd: "21.13", title: "Gamma", heading: "21.13 Gamma", descripcion: "Nota y carpeta con nombres distintos", extra: CONTENT }));
  add(`${CAT21}/21.13 Gama/fichero.md`, "# Fichero de Gama\n");

  // 21.14 Delta (note + folder) with a `+` child, `#` and `:` in the title for rename tests
  add(`${JDEX}/21.14 Delta #prueba.md`, note({ jd: "21.14", title: "Delta #prueba", heading: "21.14 Delta #prueba", descripcion: "Padre con hijo +", extra: CONTENT }));
  add(`${CAT21}/21.14 Delta #prueba/fichero.md`, "# Fichero de Delta\n");
  add(`${JDEX}/21.14+ Delta hijo.md`, note({ jd: "21.14+", title: "Delta hijo", heading: "21.14+ Delta hijo", descripcion: "Hijo +", extra: CONTENT }));
  add(`${CAT21}/21.14 Delta #prueba/+ Delta hijo/fichero.md`, "# Fichero del hijo\n");

  // 21.15 duplicate ID: two notes with the same ID and DIFFERENT names
  add(`${JDEX}/21.15 Épsilon.md`, note({ jd: "21.15", title: "Épsilon", heading: "21.15 Épsilon", descripcion: "Primera nota del ID duplicado", extra: CONTENT }));
  add(`${JDEX}/21.15 Epsilon copia.md`, note({ jd: "21.15", title: "Epsilon copia", heading: "21.15 Epsilon copia", descripcion: "Segunda nota del ID duplicado", extra: CONTENT }));
  add(`${CAT21}/21.15 Épsilon/fichero.md`, "# Fichero de Épsilon\n");

  // 21.16 Zeta: folder only (no note)
  add(`${CAT21}/21.16 Zeta/fichero.md`, "# Fichero de Zeta\n");

  // --- 22 other category: one note, for "move to another category"
  add(`${JDEX}/22.11 Kappa.md`, note({ jd: "22.11", title: "Kappa", heading: "22.11 Kappa", categoria: "Otra categoría", descripcion: "Para mover de categoría", extra: CONTENT }));
  add(`${WORK}/22 Otra categoría/22.11 Kappa/fichero.md`, "# Fichero de Kappa\n");

  // --- 23 exhausted: max used is .99, so the next ID must be refused
  for (const n of ["11", "99"]) {
    add(`${JDEX}/23.${n} Agotada ${n}.md`, note({ jd: `23.${n}`, title: `Agotada ${n}`, heading: `23.${n} Agotada ${n}`, categoria: "Agotada", descripcion: "Categoría agotada", extra: CONTENT }));
    add(`${WORK}/23 Agotada/23.${n} Agotada ${n}/fichero.md`, "# Fichero\n");
  }

  // --- 24 gaps: used .11 and .14 -> next must be .15 (max + 1), the gaps .12 and .13 are NOT reused
  for (const n of ["11", "14"]) {
    add(`${JDEX}/24.${n} Hueco ${n}.md`, note({ jd: `24.${n}`, title: `Hueco ${n}`, heading: `24.${n} Hueco ${n}`, categoria: "Huecos", descripcion: "Categoría con huecos", extra: CONTENT }));
    add(`${WORK}/24 Huecos/24.${n} Hueco ${n}/fichero.md`, "# Fichero\n");
  }

  // --- 25 header skip: max used .19 -> next must be .21 (the .20 header number is skipped)
  for (const n of ["18", "19"]) {
    add(`${JDEX}/25.${n} Salto ${n}.md`, note({ jd: `25.${n}`, title: `Salto ${n}`, heading: `25.${n} Salto ${n}`, categoria: "Saltos", descripcion: "Salta la cabecera", extra: CONTENT }));
    add(`${WORK}/25 Saltos/25.${n} Salto ${n}/fichero.md`, "# Fichero\n");
  }

  // --- 26 collision: note and folder of 26.11 with different titles, plus a loose folder
  add(`${JDEX}/26.11 Iota.md`, note({ jd: "26.11", title: "Iota", heading: "26.11 Iota", categoria: "Colisiones", descripcion: "Colisión de nombres", extra: CONTENT }));
  add(`${WORK}/26 Colisiones/26.11 Iota otra carpeta/fichero.md`, "# Fichero\n");
  add(`${WORK}/26 Colisiones/Carpeta suelta/fichero.md`, "# Fichero en carpeta sin número\n");

  // --- Two more systems with the SAME ID 21.11 as the default one (identities are separate per system)
  for (const sys of ["D01", "D02"]) {
    const area = `${sys}.20-29 Productos`;
    const category = `${area}/${sys}.21 Software`;
    add(`${JDEX}/${sys}.21.11 Alfa ${sys}.md`, note({ jd: "21.11", title: `Alfa ${sys}`, heading: `${sys}.21.11 Alfa ${sys}`, area: "Productos", categoria: "Software", descripcion: `Mismo ID 21.11 en ${sys}`, extra: CONTENT }));
    add(`${category}/${sys}.21.11 Alfa ${sys}/fichero.md`, `# Fichero de ${sys}\n`);
  }

  return files;
}

function settingsFile() {
  // Only the keys the QA needs; the plugin fills the rest from its defaults.
  return `${JSON.stringify({
    jdexFolder: JDEX,
    systemRoot: "",
    templatesFolder: TEMPLATES,
    reportsFolder: REPORTS,
    automaticMaintenance: false,
    renamePairsWithoutAsking: false,
    liveHeaders: true,
    dateFormat: "YYYY-MM-DD",
    dateOnCreate: false,
    dateOnMove: false,
  }, null, 2)}\n`;
}

const GITIGNORE = `# QA vault: only content and plugin settings are versioned, so "git status" shows what a row wrote.
.DS_Store
.obsidian/*
!.obsidian/plugins/
.obsidian/plugins/*
!.obsidian/plugins/jdex-manager/
.obsidian/plugins/jdex-manager/*
!.obsidian/plugins/jdex-manager/data.json
`;

function refuse(message) {
  console.error(`make-qa-vault: ${message}`);
  process.exit(2);
}

function checkTarget(target) {
  const real = join(homedir(), "Documents", "fodaveg");
  const lower = (p) => p.toLowerCase();
  if (lower(target) === lower(real) || lower(target).startsWith(lower(real) + sep)) refuse(`${target} is inside the real vault.`);
  for (let dir = dirname(target); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".obsidian"))) refuse(`${dir} is an Obsidian vault; choose a folder outside any vault.`);
    if (dirname(dir) === dir) break;
  }
}

function git(target, ...args) {
  return execFileSync("git", ["-C", target, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function hasCommit(target) {
  try { git(target, "rev-parse", "--verify", "HEAD"); return true; } catch { return false; }
}

function main() {
  const parent = process.argv[2];
  if (!parent) refuse("usage: node scripts/make-qa-vault.mjs <parent-folder>   (creates <parent-folder>/jd-qa)");
  const target = resolve(parent, "jd-qa");
  checkTarget(target);

  const files = [
    ...fixture(),
    [".obsidian/plugins/jdex-manager/data.json", settingsFile()],
    [".gitignore", GITIGNORE],
  ];
  let created = 0;
  let kept = 0;
  for (const [relative, content] of files) {
    const path = join(target, ...relative.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) { kept += 1; continue; }
    writeFileSync(path, content, { flag: "wx" });
    created += 1;
  }

  if (!existsSync(join(target, ".git"))) git(target, "init", "-q", "-b", "main");
  let committed = false;
  if (!hasCommit(target)) {
    git(target, "add", "-A");
    git(target, "-c", "user.name=jd-qa", "-c", "user.email=jd-qa@invalid.example", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "jd-qa: initial state");
    committed = true;
  }
  const status = git(target, "status", "--porcelain").trim();
  console.log(`jd-qa at ${target}`);
  console.log(`files: ${created} created, ${kept} already there; initial commit: ${committed ? "created" : "already existed"}`);
  console.log(status === "" ? "working tree: clean" : `working tree: changes since the initial commit:\n${status}`);
  console.log(`restore to the initial state (host closed): git -C "${target}" restore . && git -C "${target}" clean -fd`);
}

// Run only when executed, so the module stays importable.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
