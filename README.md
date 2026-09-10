# JDex Manager

An Obsidian plugin for vaults organised with [Johnny.Decimal](https://johnnydecimal.com), built around one idea from the official documentation: **the index is the system**. Creating the JDex note *is* creating the ID. Folders come second, if at all.

## Principles

- **JDex first.** New IDs are born as notes in your JDex folder, with the next free number computed from the notes that already exist, respecting the standard zeros (`.00` to `.09` are reserved, content starts at `.11`) and header IDs (`AC.X0 ■`).
- **Mobile and desktop parity.** The plugin only uses Obsidian's vault API. No filesystem access, no Electron, no DOM hacks on the file explorer. Everything works the same on iOS, Android and desktop.
- **Your conventions.** The note template, the JDex folder and the system root are settings.

## Status

Early. The build, settings tab and the pure JD parser (with tests) exist. There are no user-facing commands yet.

## Roadmap

- **Create ID**: pick a category, get the next free number, create the JDex note from your template and, optionally, the folder.
- **Audit**: a report note listing folders without a JDex note, notes without a folder, mismatched frontmatter, duplicate IDs and reserved numbers used for content.
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
