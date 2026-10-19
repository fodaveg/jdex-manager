/**
 * Validación pura de «crear ID / cabecera / hijo (+)». Vive en el motor
 * (`src/jd/create-validate.ts`, para que cualquier host la comparta); aquí se reexporta
 * para que el plugin de Hebra no cambie. Lo que escribe (plantilla, nota, carpeta) vive
 * en `./jdex-create-write.ts`.
 */
export {
  jdexCreationIndex,
  validateNewId,
  validateNewHeader,
  isJdexChildEntry,
  JDEX_CHILD_OF_CHILD_MESSAGE,
  validateNewChildTitle,
  requireTitle
} from './engine';
