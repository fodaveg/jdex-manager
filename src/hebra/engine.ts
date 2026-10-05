/**
 * Único punto por el que el plugin de Hebra importa el motor puro de JDex Manager
 * (`../jd/public`, el punto de entrada estable del motor con su propio guardarraíl de
 * pureza, `tests/jd-purity.test.ts`). Reexporta solo lo que el adaptador usa: ninguno de
 * estos módulos importa `obsidian`, así que entran en `hebra-main.mjs` sin arrastrarlo
 * (`scripts/build-hebra.mjs` lo comprueba).
 *
 * Si `public.ts` cambia de forma, este es el ÚNICO fichero de `src/hebra/` que hay que
 * tocar: nada más importa directamente de `../jd`.
 */
export {
  // index.ts — el índice del sistema a partir de rutas de carpetas y notas.
  buildIndex,
  selectSystem,
  selectCreationSystem,
  sameSystem,
  systemKey,
  titleForCompare,
  areaCode,
  areaOfCategory,
  knownIds,
  findId,
  childrenPlus,
  categoryUsage,
  // detect.ts — autodetección de las carpetas de gestión (00.00, 00.02, 00.03).
  detectFolders,
  fillEmpty,
  relativeTo,
  // files.ts — ubicar un fichero o carpeta en el sistema; inbox.
  categoryOfPath,
  idFolderOfPath,
  inboxFolders,
  zeroOf,
  locate,
  // audit.ts — la auditoría del «bibliotecario».
  auditSystem,
  countProblems,
  FINDING_KINDS,
  expectedFrontmatter,
  // audit-report.ts — títulos legibles de cada tipo de hallazgo.
  KIND_TITLES,
  reportFileName,
  // settings.ts — ajustes del motor y sus valores por defecto.
  DEFAULT_SETTINGS,
  mergeSettings,
  namePrefix,
  // parse.ts — números JD puros: parseo, próximo ID libre, nombre de nota (lote 2,
  // tarea 1: «crear ID» y sus hermanos).
  parseJdNumber,
  extractJdPrefix,
  isReserved,
  isHeader,
  nextFreeId,
  jdexNoteName,
  // structure.ts — números y nombres de estructura nueva (área, categoría, cabecera).
  nextFreeArea,
  nextFreeCategory,
  nextFreeHeader,
  managementCategoryName,
  standardZeroNames,
  validateNewCategory,
  parseNewArea,
  // template.ts — plantillas de nota JDex: variables y las cuatro por defecto.
  renderTemplate,
  templateNameCandidates,
  todayIso,
  BUILTIN_TEMPLATES,
  TEMPLATE_TYPES,
  // headers.ts — cabeceras vivas (lote 2, tarea 3).
  childrenOf,
  renderChildren,
  replaceChildrenBlock,
  wrapFirstLinkList,
  headerEntries,
  CHILDREN_START,
  CHILDREN_END,
  // system-index.ts — el índice del sistema completo (lote 2, tarea 3).
  renderSystemIndex,
  replaceSystemIndex,
  appendIndexMarkers,
  INDEX_START,
  INDEX_END,
  // pair.ts — qué le pasa a la pareja nota/carpeta de un ID al renombrar o mover
  // (lote 3, tarea 1: «avisar antes de renumerar o cambiar de categoría»).
  pairAction,
  // retire.ts — «retirar un ID» (lote 3, tarea 2): mover a la .09 de su categoría con
  // fecha y `tipo: archivado`, sin reutilizar el número (johnnydecimal.com).
  retirePlan,
  insertAfterH1,
  // reading-links.ts — números JD sueltos en un texto (lote 4, tarea 2: «los números
  // JD son clicables… y autocompletado»). El motor solo ENCUENTRA; el host pinta el
  // enlace y ofrece las sugerencias (`jdex-editor-extension.ts`).
  findJdNumbers
} from '../jd/public';

export type {
  AreaEntry,
  CategoryEntry,
  IdEntry,
  MisplacedEntry,
  RawIdEntry,
  JdIndex,
  IndexInput,
  DetectedFolders,
  Location,
  Finding,
  FindingKind,
  Fix,
  NoteMeta,
  AuditInput,
  JdexManagerSettings,
  JdexNoteType,
  JdArea,
  JdCategory,
  JdId,
  JdNumber,
  ParsedPrefix,
  TemplateVars,
  TemplateScope,
  RenameEvent,
  PairAction,
  RetirePlan,
  NumberMatch
} from '../jd/public';
