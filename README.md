# JDex Manager

An Obsidian plugin for vaults organised with [Johnny.Decimal](https://johnnydecimal.com), built around one idea from the official documentation: **the index is the system**. Creating the JDex note *is* creating the ID. Folders come second, if at all.

## Principles

- **JDex first.** New IDs are born as notes in your JDex folder, with the next free number computed from the notes that already exist, respecting the standard zeros (`.00` to `.09` are reserved, content starts at `.11`) and header IDs (`AC.X0 ■`).
- **Mobile and desktop parity.** The plugin only uses Obsidian's vault API. No filesystem access, no Electron, no DOM hacks on the file explorer. Everything works the same on iOS, Android and desktop.
- **Your conventions.** The note template, the JDex folder and the system root are settings.

## Status

Early but usable. What works today:

- **Create ID** (command and ribbon icon): pick a category, get the next free number (zeros and headers skipped), type a title, optionally tick "also create the folder". The JDex note is created from the template and opened. Nothing is ever overwritten: a number already used by a note or a folder is rejected with the name that uses it.
- **Settings with auto-detection**: JDex folder, system root, templates folder and reports folder. Empty fields are filled on startup from `00-09*/00*/00.00`, `00.02` and `00.03`; a button and a command run the detection again. A configured value is never replaced.
- **Templates per note type** (`id`, `cabecera`, `categoria`, `area`): a note in the templates folder (names configurable, `JDex - id` by default) wins over the built-in template. Variables: `{{id}}`, `{{title}}`, `{{area}}`, `{{areaTitle}}`, `{{category}}`, `{{categoryTitle}}`, `{{date}}`. A command writes the built-in templates into the templates folder so you can edit them.

- **Audit** (command, status bar counter on desktop, optional run on startup): writes `Auditoría JD - YYYY-MM-DD.md` in the reports folder with eight sections: folders without a JDex note, note and folder with different names, frontmatter that does not match the name or position, duplicate IDs, management numbers (`.00`, `.02` to `.08`) holding content, headers with files inside, numbers outside their parent, and (for information) notes without a folder. Sub-folders inside an ID are never a finding. "Apply mechanical fixes from last audit" fixes frontmatter and renames folders after their note, with a checklist first.

- **Rename in pairs**: renaming a JDex note offers to rename its ID folder, and the other way round (a setting skips the question). Changing the number is refused with a notice: an ID is never renumbered. Moving an ID folder to another category also gets a notice.
- **Frontmatter from the name**: "Normalize JDex frontmatter" fills or corrects `jd`, `tipo`, `area` and `categoria` from the note's number and the system folders, for the active note or the whole JDex, with a checklist before writing.
- **Live header lists**: the children of each `AC.X0 ■` note are regenerated between `<!-- jdex:hijos -->` and `<!-- /jdex:hijos -->` when an ID of that range is created or renamed, and on demand with "Update header lists". "Wrap existing header lists in markers" migrates the notes you already have, after a preview.

- **Create category / Create area**: next free number proposed, JDex note from the `categoria` / `area` template, optional folder, and the standard zeros on request with explicit names (`A0 Gestión del área A0-A9`, `AC.01 Inbox de la categoría AC`, `AC.09 Archivo de la categoría AC`). `.02` to `.08` are never created unasked.
- **Create header**: `AC.X0 ■ emoji Title` note with `tipo: cabecera`, the next free X0 proposed, and an empty children block that the live header list fills.
- **Create child ID (+)**: from the command palette on the active JDex note or from the file menu of an ID note or folder. The child is `AC.ID+ Title` with `jd: "AC.ID+"` and a link to its parent; the folder, if asked, is `+ Title` inside the parent folder.

Categories come from the folders under the system root (`20-29 …/21 …`) and from any `AC Title` notes in the JDex; IDs come from both the JDex notes and the ID folders.

## Roadmap

- **Inbox and archive**: send to `.01`, archive to `.09` with a date prefix, process the inboxes.
- **Go to ID**: a picker that shows the note and the folder of every ID on one row.

## Install

**BRAT**: add `fodaveg/jdex-manager` as a beta plugin.

**Manual**: download `main.js`, `manifest.json` and `styles.css` from the latest release into `.obsidian/plugins/jdex-manager/` and enable the plugin.

## Develop

```
npm install
npm run dev     # esbuild in watch mode
npm run check   # lint, build and tests
```

## Credit and licence

Johnny.Decimal is Johnny Noble's system: https://johnnydecimal.com. This plugin is an independent tool and is not affiliated with it.

MIT. See `LICENSE`.
