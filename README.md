# JDex Manager

An Obsidian plugin for vaults organised with [Johnny.Decimal](https://johnnydecimal.com), built around one idea from the official documentation: **the index is the system**. Creating the JDex note *is* creating the ID. Folders come second, if at all.

## Principles

- **JDex first.** New IDs are born as notes in your JDex folder, with the next free number computed from the notes that already exist, respecting the standard zeros (`.00` to `.09` are reserved, content starts at `.11`) and header IDs (`AC.X0 ■`).
- **Mobile and desktop parity.** The plugin only uses Obsidian's vault API. No filesystem access, no Electron, no DOM hacks on the file explorer. Everything works the same on iOS, Android and desktop.
- **Your conventions.** The note template, the JDex folder and the system root are settings.

## Status

What works today (0.6.0):

- **Create ID** (command and ribbon icon): pick a category, get the next free number (zeros and headers skipped), type a title, optionally tick "also create the folder". The JDex note is created from the template and opened. Nothing is ever overwritten: a number already used by a note or a folder is rejected with the name that uses it.
- **Settings with auto-detection**: JDex folder, system root, templates folder and reports folder. Empty fields are filled on startup from `00-09*/00*/00.00`, `00.02` and `00.03`; a button and a command run the detection again. A configured value is never replaced.
- **Templates per note type** (`id`, `cabecera`, `categoria`, `area`): a note in the templates folder (names configurable, `JDex - id` by default) wins over the built-in template. Variables: `{{id}}`, `{{title}}`, `{{area}}`, `{{areaTitle}}`, `{{category}}`, `{{categoryTitle}}`, `{{date}}`. A command writes the built-in templates into the templates folder so you can edit them. A note with a category or area suffix (`JDex - id - 21`, `JDex - id - 20-29`) wins over the general one for that scope.

- **Audit and repair** (command, status bar counter on desktop, optional audit on startup): lists errors and informational findings, including missing partners, different names, inconsistent frontmatter, duplicate IDs, misplaced or malformed numbers and old inbox entries. **Reparar JDex** opens a preview grouped by finding type and reaudits before applying each selection. Only derived `jd`, `tipo`, `area` and `categoria` fields start selected; creation, renaming, moving, descriptions and duplicate conflict copies require an explicit selection. Completed steps remain in the undo journal if a later step fails.

  Numbered content subfolders such as `70 Attachments` or `40 Audits` inside a valid ID are local organisation, not misplaced JD categories. Repair is enabled when at least one available repair is selected; findings without a safe repair require manual review.

- **Rename in pairs**: renaming a JDex note offers to rename its ID folder, and the other way round (a setting skips the question). In Obsidian, changing the number is refused with a notice: an ID is never renumbered; moving an ID folder to another category also gets a notice. In Hebra, a folder rename or move that would renumber an ID or change its category shows a warning, and the change is applied only after you confirm it.
- **Frontmatter from the name**: "Normalize JDex frontmatter" fills or corrects `jd`, `tipo`, `area` and `categoria` from the note's number and the system folders, for the active note or the whole JDex, with a checklist before writing.
- **Live header lists**: the children of each `AC.X0 ■` note are regenerated between `<!-- jdex:hijos -->` and `<!-- /jdex:hijos -->` when an ID of that range is created or renamed, and on demand with "Update header lists". "Wrap existing header lists in markers" migrates the notes you already have, after a preview.

- **Create category / Create area**: next free number proposed, JDex note from the `categoria` / `area` template, optional folder, and the standard zeros on request with explicit names (`A0 Gestión del área A0-A9`, `AC.01 Inbox de la categoría AC`, `AC.09 Archivo de la categoría AC`). `.02` to `.08` are never created unasked.
- **Create header**: `AC.X0 ■ emoji Title` note with `tipo: cabecera`, the next free X0 proposed, and an empty children block that the live header list fills.
- **Create child ID (+)**: from the command palette on the active JDex note or from the file menu of an ID note or folder. The child is `AC.ID+ Title` with `jd: "AC.ID+"` and a link to its parent; the folder, if asked, is `+ Title` inside the parent folder.

- **Send to inbox / Archive**: move the active file to the `.01` or `.09` of its category (a picker when the file lives outside the system). Archiving adds the date as prefix: the `fecha` / `creado` / `created` / `date` frontmatter value when a note has one, else the file creation time (not verified for files received through Obsidian Sync).
- **Process inboxes**: walks every `AC.01` and `00.01` file by file with a preview: move to an ID, archive, skip, open or delete. The status bar shows how many files are waiting. In Hebra the dialog also previews each note, sends it to the trash only after a confirmation, and can move it to an ID that has no folder only if you tick "Include IDs without a folder" and confirm creating it. Hebra does not date the name when moving (only Archive adds the date), and Open advances to the next note without closing the dialog.
- **Date file name**: prefixes the date (frontmatter first, else creation time) to a file inside a content ID (`YYYY-MM-DD` or `YYYY-MM`). Optional automatic dating on creation. JDex notes and management folders are never touched.
- **Clickable numbers in the Hebra editor**: ⌘-click (Ctrl-click) on an ID number opens its JDex note, with Alt the folder; a plain click only places the cursor.
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
- **Undo last JDex operation**: the last 20 operations are stored in plugin settings (per library in Hebra). The command previews the inverses and runs them in reverse, preserving remaining steps if one fails. It acts on the operation shown in the preview: if another one was recorded meanwhile, nothing runs. Every inverse checks the live state first and changes nothing when it differs: edited notes, frontmatter keys edited after the operation, a retirement line moved by hand, a path reused by another file and non-empty created folders are kept for review. Trashing follows the host’s recovery mechanism.
  - **What is journaled**: every write of the plugin, effect by effect as it happens (creating IDs, categories, areas, headers, `+` children and structure notes; repair, normalize, retire, move, archive, send to inbox, inbox processing, dating names, renaming the pair partner, header lists, markers, system index, health and system reports, and automatic maintenance). Left out on purpose: the audit report (overwritten by every audit), creating the built-in templates (only creates missing files), the plugin’s own settings, and deleting a non-Markdown file from the inbox (it goes to the trash, which is how it is recovered).
  - **Discard last JDex journal entry**: removes the last entry without touching any file, so an entry that cannot be undone no longer hides the earlier ones.
  - **Devices and versions**: each entry records the device that made it; an operation of another device is not undone (discard it, or undo it there). When `data.json` changes outside Obsidian (for example through Sync), settings and journal are reloaded and joined by identity, and a local save keeps what changed elsewhere. Journals from 0.3.x/0.4.x are migrated in place; their frontmatter steps need explicit confirmation, and steps whose keys were lost by 0.3.1 stay in the journal with a warning. A journal from a newer version is kept untouched and not used.
- **Interface language**: the Obsidian interface, notices and engine messages follow Obsidian's language (English or Spanish); changing the language requires reloading the plugin.
- **Debug log** (optional, off by default): when enabled, errors are appended to a note titled `Registro de depuración JDex`, with stack locations sanitised. The log note itself is never audited or journaled.
- **Optional automatic maintenance**: off by default. When enabled, updates derived frontmatter, header lists and the system index after changes, with an undo journal. Other repairs require the preview. After an undo, maintenance and live header lists leave the restored notes alone until they change again, so undo is not redone and repeated undos reach earlier operations.
- **System report**: run manually to write `Informe JD - YYYY-MM-DD` in the reports folder (`00.02` by auto-detection), with audit, health and differences from the previous report. Inbox age is informational; its default threshold is 30 days and is configurable.
- **Status bar**: audit findings, inbox count and the JD path of the active file (`21 Productos … › 21.22 JDex Manager`; click jumps between the JDex note and the folder). On mobile, where there is no status bar, "Show where the active file lives" and "Toggle between JDex note and folder" do the same.

Categories come from the folders under the system root (`20-29 …/21 …`) and from any `AC Title` notes in the JDex; IDs come from both the JDex notes and the ID folders.

## Settings by host

Both hosts share the engine defaults. Hebra stores its settings per library and device; "n/a" marks settings that have no meaning there.

| Setting | Obsidian | Hebra |
| --- | --- | --- |
| JDex folder, system root, templates folder, reports folder | Yes | Yes |
| System id (`D01`) and "put it in front of new names" | Yes | Yes (an invalid id such as `d1` is rejected) |
| Template name per note type | Yes | Yes |
| Write the built-in templates into the templates folder | Command | Button and command (existing notes are never overwritten) |
| Create the folder too (initial value) | Yes | Yes |
| Subfolder pattern, per-category patterns, create the pattern by default | Yes | Yes |
| Live headers, automatic maintenance, system index note | Yes | Yes |
| Empty description is a finding; JDex note without folder is a finding; areas and categories without note are findings | Yes | Yes |
| Rename the note/folder partner without asking | Yes | Yes |
| Archive date format, inbox age threshold, health report file limit | Yes | Yes |
| Update the system index after creating | Yes | n/a (always refreshed after a JDex write) |
| Audit on startup | Yes | n/a (the audit runs on every index rebuild) |
| What to open after creating | Yes | n/a (the note opens) |
| Date files on create or on move | Yes | n/a |
| Clickable numbers in reading view | Yes | n/a |
| Autocomplete and what it inserts | Yes (inserts a link by default) | Yes (inserts the number by default) |

## Install

**BRAT**: add `fodaveg/jdex-manager` as a beta plugin.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the latest release into `.obsidian/plugins/jdex-manager/` and enable the plugin.

**Hebra**: the same release also carries JDex Manager as an external plugin for [Hebra](https://github.com/fodaveg/hebra) (`hebra.json`, `hebra-main.mjs`, `hebra-styles.css`). Install it from Hebra's plugin list. Version 0.6.0 requires Hebra plugin API 2.1, which runs plugins in isolated frames and preserves ordinary cursor clicks on decorated ID numbers. Hebra hosts that still implement API 1.x should keep JDex Manager 0.5.1; the manifest checks compatibility before loading.

## Develop

Node 22 or later (CI uses 22). A fresh checkout installs exactly what the lockfile says:

```
npm ci               # not `npm install`: it must not rewrite package-lock.json
npm run dev          # esbuild in watch mode (Obsidian)
npm run build:hebra  # hebra-main.mjs, hebra-styles.css and hebra.json (Hebra plugin)
npm run check        # lint, both builds and tests with the coverage floor
```

`hebra-main.mjs`, `hebra-styles.css` and `hebra.json` are generated and git-ignored, so a clean checkout has none of them. `npm run check` builds them before the tests; to run vitest on its own (`npx vitest run --maxWorkers=1`) run `npm run build:hebra` first, or `tests/hebra/bundle.test.ts` fails on purpose instead of skipping. Keep `--maxWorkers=1`: the suite is serial by design (`npm test` already sets it). Vitest 5 has no `--minWorkers` option.

Coverage (`npm run test:coverage`, part of `check`) enforces the floor in `vitest.config.mts`, measured on 12 Oct 2026; raise it as coverage rises.

`npm run audit:bundled` fails if `npm audit` reports an advisory in a package that ships inside `main.js` or `hebra-main.mjs` (today only `yaml`, in the Hebra bundle). It needs the network, so it runs in CI and not in `check`. `npm audit --omit=dev` does not describe what ships, because `yaml` is a dev dependency that gets bundled.

The Hebra plugin lives in `src/hebra/` (entry `main.ts`, written against `hebra-plugin-api/v2`, never against Obsidian or Hebra internals) and shares only the pure engine in `src/jd/` with the Obsidian plugin. `scripts/build-hebra.mjs` bundles it into one ES module, generates `hebra.json` (never by hand) and fails if the bundle imports anything it should not or inlines CodeMirror; `esbuild.config.mjs` fails if `main.js` bundles anything from `src/hebra/`.

## Release

A release is a tag equal to the version in `manifest.json`, `package.json` and `hebra.json`, on a commit that is already in `main`, with the notes written in `release-notes/<tag>.md` in that same commit (the workflow fails without them). The workflow hashes the six assets from the build, attests their provenance, creates a draft, downloads it back and compares it with those hashes and with GitHub's own digests, and only then publishes. It also requires the repository to have immutable releases enabled (Settings, Releases): that setting is not something the workflow can turn on. `minAppVersion`, `versions.json` and the version fields are changed by hand, on purpose; `npm run check:min-app` fails if the code starts to need newer Obsidian API than `minAppVersion`.

Dependencies are reviewed through Dependabot (`.github/dependabot.yml`, npm and GitHub Actions). `obsidian` is held to `~1.14.4`, a minor, so a new minor arrives as a pull request that CI judges with `check:min-app`.

## Credit and licence

Johnny.Decimal is Johnny Noble's system: https://johnnydecimal.com. This plugin is an independent tool and is not affiliated with it.

MIT. See `LICENSE`.
