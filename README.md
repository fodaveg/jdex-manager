# JDex Manager

An Obsidian plugin for vaults organised with [Johnny.Decimal](https://johnnydecimal.com), built around one idea from the official documentation: **the index is the system**. Creating the JDex note *is* creating the ID. Folders come second, if at all.

## Principles

- **JDex first.** New IDs are born as notes in your JDex folder, with the next free number computed from the notes that already exist, respecting the standard zeros (`.00` to `.09` are reserved, content starts at `.11`) and header IDs (`AC.X0 ■`).
- **Mobile and desktop parity.** The plugin only uses Obsidian's vault API. No filesystem access, no Electron, no DOM hacks on the file explorer. Everything works the same on iOS, Android and desktop.
- **Your conventions.** The note template, the JDex folder and the system root are settings.

## Status

What works today (0.4.1):

- **Create ID** (command and ribbon icon): pick a category, get the next free number (zeros and headers skipped), type a title, optionally tick "also create the folder". The JDex note is created from the template and opened. Nothing is ever overwritten: a number already used by a note or a folder is rejected with the name that uses it.
- **Settings with auto-detection**: JDex folder, system root, templates folder and reports folder. Empty fields are filled on startup from `00-09*/00*/00.00`, `00.02` and `00.03`; a button and a command run the detection again. A configured value is never replaced.
- **Templates per note type** (`id`, `cabecera`, `categoria`, `area`): a note in the templates folder (names configurable, `JDex - id` by default) wins over the built-in template. Variables: `{{id}}`, `{{title}}`, `{{area}}`, `{{areaTitle}}`, `{{category}}`, `{{categoryTitle}}`, `{{date}}`. A command writes the built-in templates into the templates folder so you can edit them. A note with a category or area suffix (`JDex - id - 21`, `JDex - id - 20-29`) wins over the general one for that scope.

- **Audit and repair** (command, status bar counter on desktop, optional audit on startup): lists errors and informational findings, including missing partners, different names, inconsistent frontmatter, duplicate IDs, misplaced or malformed numbers and old inbox entries. **Reparar JDex** opens a preview grouped by finding type and reaudits before applying each selection. Only derived `jd`, `tipo`, `area` and `categoria` fields start selected; creation, renaming, moving, descriptions and duplicate conflict copies require an explicit selection. Completed steps remain in the undo journal if a later step fails.

  Numbered content subfolders such as `70 Attachments` or `40 Audits` inside a valid ID are local organisation, not misplaced JD categories. Repair is enabled when at least one available repair is selected; findings without a safe repair require manual review.

- **Rename in pairs**: renaming a JDex note offers to rename its ID folder, and the other way round (a setting skips the question). Changing the number is refused with a notice: an ID is never renumbered. Moving an ID folder to another category also gets a notice.
- **Frontmatter from the name**: "Normalize JDex frontmatter" fills or corrects `jd`, `tipo`, `area` and `categoria` from the note's number and the system folders, for the active note or the whole JDex, with a checklist before writing.
- **Live header lists**: the children of each `AC.X0 ■` note are regenerated between `<!-- jdex:hijos -->` and `<!-- /jdex:hijos -->` when an ID of that range is created or renamed, and on demand with "Update header lists". "Wrap existing header lists in markers" migrates the notes you already have, after a preview.

- **Create category / Create area**: next free number proposed, JDex note from the `categoria` / `area` template, optional folder, and the standard zeros on request with explicit names (`A0 Gestión del área A0-A9`, `AC.01 Inbox de la categoría AC`, `AC.09 Archivo de la categoría AC`). `.02` to `.08` are never created unasked.
- **Create header**: `AC.X0 ■ emoji Title` note with `tipo: cabecera`, the next free X0 proposed, and an empty children block that the live header list fills.
- **Create child ID (+)**: from the command palette on the active JDex note or from the file menu of an ID note or folder. The child is `AC.ID+ Title` with `jd: "AC.ID+"` and a link to its parent; the folder, if asked, is `+ Title` inside the parent folder.

- **Send to inbox / Archive**: move the active file to the `.01` or `.09` of its category (a picker when the file lives outside the system). Archiving adds the creation date as prefix.
- **Process inboxes**: walks every `AC.01` and `00.01` file by file with a preview: move to an ID, archive, skip, open or delete. The status bar shows how many files are waiting.
- **Date file name**: prefixes the creation date to a file inside a content ID (`YYYY-MM-DD` or `YYYY-MM`). Optional automatic dating on creation. JDex notes and management folders are never touched.
- **Go to ID**: a picker with note and folder on the same row; Enter opens the note, Cmd/Ctrl+Enter the folder.
- **Move active file to an ID**: the same picker, from the command palette or the file menu, moves the file into the folder of the chosen ID (offering to create the folder when the ID has none). A setting dates the name on the way.
- **Search inside the active ID / category**: opens Obsidian's search with `path:"…/21.22 JDex Manager/"` already typed; when the core search plugin is not reachable the query goes to the clipboard.
- **System health report**: `Salud JD - YYYY-MM-DD.md` in the reports folder with IDs used per category and the next free number, categories over 70 IDs, IDs whose folder is empty and IDs with more than N files (N is a setting, 50 by default). The audit measures errors; this measures how full the system is.

- **Autocomplete in the editor**: typing `21.2` (or `[[21.2`) lists the IDs that start with it; Enter inserts a link to the JDex note, Shift+Enter the bare number.
- **Clickable numbers in reading view**: a bare `21.22` (or `D01.21.22`) in the text of any note links to its JDex note, with the usual hover preview. Only numbers that exist are linked, links, code and properties are left alone, and the file is never modified. Reading view only; a setting turns it off.
- **ID panel** (side view): the ID the active file belongs to, its description, links to note and folder, the files in the folder with their date, its `+` children and the siblings under the same header.
- **Copy ID / Copy JD path** of the active file; the file menu offers "Open JDex note" from any file inside an ID and "Open folder" from the note.
- **Retire an ID**: the folder moves to the category archive with a date prefix; the note stays in the JDex marked `tipo: archivado` with when and where. Numbers are never reused.
- **Subfolder pattern**: a default pattern and overrides per category (`21: 40 Audits y revisiones, 70 Adjuntos`), created with the ID folder; the audit lists IDs that lack it and can create the missing folders.
- **Missing category and area notes**: one command creates them from the folders with the `categoria` and `area` templates; the audit can then require them.
- **System index note**: the whole system as a nested list (areas, categories, headers, IDs with their `descripcion`, `+` children) between `<!-- jdex:indice -->` markers, regenerated on demand or when an ID is created.
- **Empty descriptions**: the audit lists JDex notes without `descripcion` and proposes the first sentence of the body as a mechanical fix.
- **Several systems**: `D01`, `D02` and names without a prefix have separate identities. Numbering, audit and repair preserve each system’s prefix and do not pair items across systems.
- **Undo last JDex operation**: the last 20 operations are stored in plugin settings (per library in Hebra). The command previews the inverses and runs them in reverse, preserving remaining steps if one fails. Edited notes and non-empty created folders are kept for review. Trashing follows the host’s recovery mechanism.
- **Optional automatic maintenance**: off by default. When enabled, updates derived frontmatter, header lists and the system index after changes, with an undo journal. Other repairs require the preview.
- **System report**: run manually to write `Informe JD - YYYY-MM-DD` in the reports folder (`00.02` by auto-detection), with audit, health and differences from the previous report. Inbox age is informational; its default threshold is 30 days and is configurable.
- **Status bar**: audit findings, inbox count and the JD path of the active file (`21 Productos … › 21.22 JDex Manager`; click jumps between the JDex note and the folder). On mobile, where there is no status bar, "Show where the active file lives" and "Toggle between JDex note and folder" do the same.

Categories come from the folders under the system root (`20-29 …/21 …`) and from any `AC Title` notes in the JDex; IDs come from both the JDex notes and the ID folders.

## Install

**BRAT**: add `fodaveg/jdex-manager` as a beta plugin.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the latest release into `.obsidian/plugins/jdex-manager/` and enable the plugin.

**Hebra**: the same release also carries JDex Manager as an external plugin for [Hebra](https://github.com/fodaveg/hebra) (`hebra.json`, `hebra-main.mjs`, `hebra-styles.css`). Install it from Hebra's plugin list or by URL (`fodaveg/jdex-manager`). Version 0.4.1 requires a Hebra host with plugin API 1.2 or later; the manifest checks compatibility before loading.

## Develop

```
npm install
npm run dev          # esbuild in watch mode (Obsidian)
npm run build:hebra  # hebra-main.mjs, hebra-styles.css and hebra.json (Hebra plugin)
npm run check        # lint, both builds and tests
```

The Hebra plugin lives in `src/hebra/` (entry `main.ts`, written against `hebra-plugin-api`, never against Obsidian or Hebra internals) and shares only the pure engine in `src/jd/` with the Obsidian plugin. `scripts/build-hebra.mjs` bundles it into one ES module, generates `hebra.json` (never by hand) and fails if the bundle imports anything it should not or inlines CodeMirror; `esbuild.config.mjs` fails if `main.js` bundles anything from `src/hebra/`.

## Credit and licence

Johnny.Decimal is Johnny Noble's system: https://johnnydecimal.com. This plugin is an independent tool and is not affiliated with it.

MIT. See `LICENSE`.
