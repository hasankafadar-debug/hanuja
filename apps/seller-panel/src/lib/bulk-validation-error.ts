export type BulkValidationError = {
  rowNumber: number
  field: string
  code: string
  message: string
}

/** Keeps bulk validate and commit error rows stable for the import UI. */
export function createBulkValidationError(
  rowNumber: number,
  field: string,
  code: string,
  message: string,
): BulkValidationError {
  return { rowNumber, field, code, message }
}
