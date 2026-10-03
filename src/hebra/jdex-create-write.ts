/**
 * Escritura de «crear ID / categoría / área / cabecera / hijo (+)» (tarea 1 del lote,
 * 28 sep 2026): mismo comportamiento que `src/vault/create.ts` y
 * `src/ui/create-id.ts`/`create-structure.ts` del plugin de Obsidian, reimplementado
 * sobre el `vault` de la API de Hebra: `noteCreate` (que deriva el título del cuerpo)
 * para la nota y `folderCreate` para la carpeta, si se pide. Cada escritura es una
 * operación normal de la biblioteca: se sincroniza como cualquier otra.
 *
 * Nada se sobrescribe NUNCA: cada función rechaza si el número o el nombre ya están en
 * uso (nota o carpeta), antes de escribir nada.
 */
import type { PluginFolder, PluginMarkdown, PluginNote, PluginVault } from 'hebra-plugin-api';
import {
  areaCode,
  findId,
  jdexNoteName,
  managementCategoryName,
  namePrefix,
  parseJdNumber,
  renderTemplate,
  standardZeroNames,
  templateNameCandidates,
  todayIso,
  BUILTIN_TEMPLATES,
  type AreaEntry,
  type CategoryEntry,
  type IdEntry,
  type JdIndex,
  type JdexManagerSettings,
  type JdexNoteType,
  type TemplateScope
} from './engine';
import { validateNewChildTitle, validateNewHeader, validateNewId } from './jdex-create';
import { jdexResolveFolderId, type JdexLibraryWalk } from './library-index';

/** Lo que usa este fichero del `vault` de la API. */
export type JdexCreateLibrary = Pick<
  PluginVault,
  'noteCreate' | 'noteRead' | 'folderCreate' | 'foldersList'
>;

/** Lo que usa este fichero de `api.markdown`: fijar el título en el frontmatter. */
export type JdexCreateMarkdown = Pick<PluginMarkdown, 'withTitle'>;

/** Lo que persiste Hebra de los ajustes (lote 1, `settings.ts`): el resto del motor se
 *  queda en su valor por defecto, `systemId`/`prefixNamesWithSystem` incluidos, así que
 *  `namePrefix` siempre da `''` hasta que un lote posterior lo active. */
type CreateSettings = Pick<
  JdexManagerSettings,
  | 'jdexFolder'
  | 'systemRoot'
  | 'templatesFolder'
  | 'templateNames'
  | 'systemId'
  | 'prefixNamesWithSystem'
>;

/**
 * El texto de la plantilla de `type`: la nota del usuario en `templatesFolder` (con
 * ámbito de categoría o área, `templateNameCandidates`) si existe entre las notas ya
 * recorridas (`walk.systemNotes`, bajo la raíz del sistema), si no la plantilla por
 * defecto (`vendor/jdex-manager/src/vault/templates.ts:resolveTemplate`, adaptado: sin
 * `app.vault`, busca en `walk`).
 */
export async function resolveJdexTemplate(
  library: Pick<JdexCreateLibrary, 'noteRead'>,
  walk: JdexLibraryWalk,
  settings: Pick<CreateSettings, 'templatesFolder' | 'templateNames'>,
  type: JdexNoteType,
  scope: TemplateScope = {}
): Promise<string> {
  if (settings.templatesFolder !== '') {
    const templatesFolderId = jdexResolveFolderId(walk, settings.templatesFolder);
    if (templatesFolderId !== null) {
      for (const name of templateNameCandidates(settings.templateNames[type], scope)) {
        const ref = walk.systemNotes.find(
          (note) => note.folderId === templatesFolderId && note.title === name
        );
        if (ref) {
          const row = await library.noteRead(ref.id);
          if (row && row.body !== null) return row.body;
        }
      }
    }
  }
  return BUILTIN_TEMPLATES[type];
}

function findChildFolder(
  folders: readonly PluginFolder[],
  parentId: string,
  name: string
): { id: string } | undefined {
  const wanted = name.trim().toLowerCase();
  return folders.find(
    (folder) => folder.parentId === parentId && folder.name.trim().toLowerCase() === wanted
  );
}

/** Crea (si falta) la carpeta `name` dentro de `parentId`; reutiliza la que ya exista
 *  con ese nombre (mismo criterio de comparación que `folder-path.ts`: sin distinguir
 *  mayúsculas). Nunca la sobrescribe: solo asegura que existe. */
export async function ensureJdexFolder(
  library: Pick<JdexCreateLibrary, 'folderCreate' | 'foldersList'>,
  parentId: string,
  name: string
): Promise<string> {
  const existing = findChildFolder(await library.foldersList(), parentId, name);
  if (existing) return existing.id;
  const created = await library.folderCreate(parentId, name);
  return created.id;
}

/** Escribe la nota nueva en `folderId` (siempre `jdexFolder`) y le fija el título con
 *  `api.markdown.withTitle` (propiedad `title`, que Hebra prefiere al H1): así el título
 *  que ve la biblioteca es SIEMPRE `displayName` (`jdexNoteName`), igual aunque el título
 *  tecleado llevara algún carácter que `jdexNoteName` recorta — el mismo criterio que
 *  separa nombre de fichero y encabezado en el plugin de Obsidian. `withTitle` devuelve el
 *  cuerpo tal cual si no puede fijarlo sin riesgo, y `noteCreate` deriva el título del
 *  cuerpo resultante. */
async function writeJdexNote(
  library: Pick<JdexCreateLibrary, 'noteCreate'>,
  markdown: JdexCreateMarkdown,
  jdexFolderId: string,
  content: string,
  displayName: string
): Promise<PluginNote> {
  const body = markdown.withTitle(content, displayName);
  return library.noteCreate({ folderId: jdexFolderId, body });
}

function requireJdexFolder(walk: JdexLibraryWalk, settings: CreateSettings): string {
  if (settings.jdexFolder === '') {
    throw new Error('La carpeta JDex no está configurada (Ajustes › Módulos › JDex Manager).');
  }
  const id = jdexResolveFolderId(walk, settings.jdexFolder);
  if (id === null) throw new Error(`La carpeta JDex («${settings.jdexFolder}») ya no existe.`);
  return id;
}

function rejectIfNoteNameTaken(walk: JdexLibraryWalk, jdexFolderId: string, name: string): void {
  const existing = walk.systemNotes.find(
    (note) => note.folderId === jdexFolderId && note.title === name
  );
  if (existing) throw new Error(`Ya existe una nota llamada «${name}».`);
}

export interface JdexCreateOutcome {
  readonly note: PluginNote;
  readonly folderPath: string | null;
  /** Aviso a mostrar cuando se pidió la carpeta pero no se pudo crear (sin carpeta
   *  padre en el sistema de ficheros de la biblioteca). `null` sin nada que avisar. */
  readonly folderNotice: string | null;
}

// ---- Crear ID -------------------------------------------------------------------

export interface CreateIdRequest {
  readonly category: CategoryEntry;
  readonly id: string;
  readonly title: string;
  readonly createFolder: boolean;
}

export async function createJdexId(
  library: JdexCreateLibrary,
  markdown: JdexCreateMarkdown,
  walk: JdexLibraryWalk,
  settings: CreateSettings,
  index: JdIndex,
  request: CreateIdRequest
): Promise<JdexCreateOutcome> {
  const error = validateNewId(index, request.category.number, request.id);
  if (error) throw new Error(error);
  const parsed = parseJdNumber(request.id);
  if (!parsed || parsed.kind !== 'id') throw new Error('Ese ID no se pudo interpretar.');
  const jdexFolderId = requireJdexFolder(walk, settings);
  const name = jdexNoteName(parsed.id, request.title, namePrefix(settings));
  rejectIfNoteNameTaken(walk, jdexFolderId, name);

  const area = index.areas.find((a) => a.number === request.category.areaNumber);
  const template = await resolveJdexTemplate(library, walk, settings, 'id', {
    category: request.category.number,
    area: areaCode(request.category.areaNumber)
  });
  const content = renderTemplate(template, {
    id: parsed.id,
    title: request.title.trim(),
    area: areaCode(request.category.areaNumber),
    areaTitle: area?.label ?? areaCode(request.category.areaNumber),
    category: request.category.number,
    categoryTitle: request.category.label,
    date: todayIso()
  });
  const note = await writeJdexNote(library, markdown, jdexFolderId, content, name);

  let folderPath: string | null = null;
  let folderNotice: string | null = null;
  if (request.createFolder) {
    if (!request.category.path) {
      folderNotice = `Nota creada. La categoría ${request.category.number} no tiene carpeta en la raíz del sistema: la carpeta del ID no se creó.`;
    } else {
      const categoryFolderId = jdexResolveFolderId(walk, request.category.path);
      if (categoryFolderId === null) {
        folderNotice = `Nota creada. No se encontró la carpeta de ${request.category.number}: la carpeta del ID no se creó.`;
      } else {
        await ensureJdexFolder(library, categoryFolderId, name);
        folderPath = `${request.category.path}/${name}`;
      }
    }
  }
  return { note, folderPath, folderNotice };
}

// ---- Crear categoría --------------------------------------------------------------

export interface CreateCategoryRequest {
  readonly area: AreaEntry;
  readonly category: string;
  readonly title: string;
  readonly createFolder: boolean;
  readonly createInbox: boolean;
  readonly createArchive: boolean;
}

export async function createJdexCategory(
  library: JdexCreateLibrary,
  markdown: JdexCreateMarkdown,
  walk: JdexLibraryWalk,
  settings: CreateSettings,
  index: JdIndex,
  request: CreateCategoryRequest
): Promise<JdexCreateOutcome> {
  const jdexFolderId = requireJdexFolder(walk, settings);
  const category = request.category;
  const name = jdexNoteName(category, request.title, namePrefix(settings));
  rejectIfNoteNameTaken(walk, jdexFolderId, name);

  const template = await resolveJdexTemplate(library, walk, settings, 'categoria', {
    area: areaCode(request.area.number)
  });
  const content = renderTemplate(template, {
    id: category,
    title: request.title.trim(),
    area: areaCode(request.area.number),
    areaTitle: request.area.label,
    category,
    categoryTitle: name,
    date: todayIso()
  });
  const note = await writeJdexNote(library, markdown, jdexFolderId, content, name);

  let folderPath: string | null = null;
  let folderNotice: string | null = null;
  if (request.createFolder) {
    if (!request.area.path) {
      folderNotice = `Nota creada. El área ${request.area.code} no tiene carpeta en la raíz del sistema: la carpeta de la categoría no se creó.`;
    } else {
      const areaFolderId = jdexResolveFolderId(walk, request.area.path);
      if (areaFolderId === null) {
        folderNotice = `Nota creada. No se encontró la carpeta de ${request.area.code}: la carpeta de la categoría no se creó.`;
      } else {
        const categoryFolderId = await ensureJdexFolder(library, areaFolderId, name);
        folderPath = `${request.area.path}/${name}`;
        for (const [wanted, zero] of [
          [request.createInbox, standardZeroNames(category).inbox],
          [request.createArchive, standardZeroNames(category).archive]
        ] as const) {
          if (!wanted) continue;
          if (findId(index, zero.id)) continue; // ya existe: nunca se sobrescribe.
          const zeroName = jdexNoteName(zero.id, zero.title, namePrefix(settings));
          if (walk.systemNotes.some((n) => n.folderId === jdexFolderId && n.title === zeroName))
            continue;
          const zeroContent = renderTemplate(
            await resolveJdexTemplate(library, walk, settings, 'id'),
            {
              id: zero.id,
              title: zero.title,
              area: areaCode(request.area.number),
              areaTitle: request.area.label,
              category,
              categoryTitle: name,
              date: todayIso()
            }
          );
          await writeJdexNote(library, markdown, jdexFolderId, zeroContent, zeroName);
          await ensureJdexFolder(library, categoryFolderId, zeroName);
        }
      }
    }
  }
  return { note, folderPath, folderNotice };
}

// ---- Crear área --------------------------------------------------------------------

export interface CreateAreaRequest {
  readonly area: number;
  readonly title: string;
  readonly createFolder: boolean;
  readonly createManagementCategory: boolean;
}

export async function createJdexArea(
  library: JdexCreateLibrary,
  markdown: JdexCreateMarkdown,
  walk: JdexLibraryWalk,
  settings: CreateSettings,
  request: CreateAreaRequest
): Promise<JdexCreateOutcome> {
  const jdexFolderId = requireJdexFolder(walk, settings);
  const code = areaCode(request.area);
  const name = jdexNoteName(code, request.title, namePrefix(settings));
  rejectIfNoteNameTaken(walk, jdexFolderId, name);

  const template = await resolveJdexTemplate(library, walk, settings, 'area');
  const content = renderTemplate(template, {
    id: code,
    title: request.title.trim(),
    area: code,
    areaTitle: name,
    category: '',
    categoryTitle: '',
    date: todayIso()
  });
  const note = await writeJdexNote(library, markdown, jdexFolderId, content, name);

  let folderPath: string | null = null;
  let folderNotice: string | null = null;
  if (request.createFolder) {
    const parentId = jdexResolveFolderId(walk, settings.systemRoot);
    if (parentId === null) {
      folderNotice = `Nota creada. No se encontró la raíz del sistema: la carpeta del área no se creó.`;
    } else {
      const areaFolderId = await ensureJdexFolder(library, parentId, name);
      folderPath = settings.systemRoot === '' ? name : `${settings.systemRoot}/${name}`;
      if (request.createManagementCategory) {
        const management = managementCategoryName(request.area);
        const managementName = jdexNoteName(
          management.number,
          management.title,
          namePrefix(settings)
        );
        if (
          !walk.systemNotes.some((n) => n.folderId === jdexFolderId && n.title === managementName)
        ) {
          const managementContent = renderTemplate(
            await resolveJdexTemplate(library, walk, settings, 'categoria', { area: code }),
            {
              id: management.number,
              title: management.title,
              area: code,
              areaTitle: name,
              category: management.number,
              categoryTitle: managementName,
              date: todayIso()
            }
          );
          await writeJdexNote(library, markdown, jdexFolderId, managementContent, managementName);
          await ensureJdexFolder(library, areaFolderId, managementName);
        }
      }
    }
  }
  return { note, folderPath, folderNotice };
}

// ---- Crear cabecera -----------------------------------------------------------------

export interface CreateHeaderRequest {
  readonly category: CategoryEntry;
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
}

export async function createJdexHeader(
  library: JdexCreateLibrary,
  markdown: JdexCreateMarkdown,
  walk: JdexLibraryWalk,
  settings: CreateSettings,
  index: JdIndex,
  request: CreateHeaderRequest
): Promise<JdexCreateOutcome> {
  const error = validateNewHeader(index, request.category.number, request.id);
  if (error) throw new Error(error);
  const parsed = parseJdNumber(request.id);
  if (!parsed || parsed.kind !== 'id')
    throw new Error('Ese número de cabecera no se pudo interpretar.');
  const jdexFolderId = requireJdexFolder(walk, settings);
  const title = `${request.emoji ? `${request.emoji.trim()} ` : ''}${request.title.trim()}`;
  const name = jdexNoteName(parsed.id, `■ ${title}`, namePrefix(settings));
  rejectIfNoteNameTaken(walk, jdexFolderId, name);

  const area = index.areas.find((a) => a.number === request.category.areaNumber);
  const template = await resolveJdexTemplate(library, walk, settings, 'cabecera', {
    category: request.category.number,
    area: areaCode(request.category.areaNumber)
  });
  const content = renderTemplate(template, {
    id: parsed.id,
    title,
    area: areaCode(request.category.areaNumber),
    areaTitle: area?.label ?? areaCode(request.category.areaNumber),
    category: request.category.number,
    categoryTitle: request.category.label,
    date: todayIso()
  });
  const note = await writeJdexNote(library, markdown, jdexFolderId, content, name);
  return { note, folderPath: null, folderNotice: null };
}

// ---- Crear hijo (+) ------------------------------------------------------------------

export interface CreateChildRequest {
  readonly parent: IdEntry;
  readonly title: string;
  readonly createFolder: boolean;
}

export async function createJdexChild(
  library: JdexCreateLibrary,
  markdown: JdexCreateMarkdown,
  walk: JdexLibraryWalk,
  settings: CreateSettings,
  index: JdIndex,
  request: CreateChildRequest
): Promise<JdexCreateOutcome> {
  const error = validateNewChildTitle(index, request.parent, request.title);
  if (error) throw new Error(error);
  const jdexFolderId = requireJdexFolder(walk, settings);
  const number = `${request.parent.id}+`;
  const title = request.title.trim();
  const name = jdexNoteName(number, title, namePrefix(settings));
  rejectIfNoteNameTaken(walk, jdexFolderId, name);

  const category = index.categories.find((c) => c.number === request.parent.category);
  const area = category ? index.areas.find((a) => a.number === category.areaNumber) : undefined;
  const parentNoteName = request.parent.notePath
    ? request.parent.notePath.slice(request.parent.notePath.lastIndexOf('/') + 1, -3)
    : request.parent.label;
  const template = await resolveJdexTemplate(library, walk, settings, 'id', {
    category: request.parent.category,
    area: category ? areaCode(category.areaNumber) : undefined
  });
  const content =
    renderTemplate(template, {
      id: number,
      title,
      area: category ? areaCode(category.areaNumber) : '',
      areaTitle: area?.label ?? '',
      category: request.parent.category,
      categoryTitle: category?.label ?? '',
      date: todayIso()
    }) + `\n## Padre\n\n- [[${parentNoteName}]]\n`;
  const note = await writeJdexNote(library, markdown, jdexFolderId, content, name);

  let folderPath: string | null = null;
  let folderNotice: string | null = null;
  if (request.createFolder) {
    if (!request.parent.folderPath) {
      folderNotice = `Nota creada. ${request.parent.label} no tiene carpeta: la carpeta del hijo no se creó.`;
    } else {
      const parentFolderId = jdexResolveFolderId(walk, request.parent.folderPath);
      if (parentFolderId === null) {
        folderNotice = `Nota creada. No se encontró la carpeta de ${request.parent.label}: la carpeta del hijo no se creó.`;
      } else {
        const childFolderName = jdexNoteName('+', title);
        await ensureJdexFolder(library, parentFolderId, childFolderName);
        folderPath = `${request.parent.folderPath}/${childFolderName}`;
      }
    }
  }
  return { note, folderPath, folderNotice };
}
