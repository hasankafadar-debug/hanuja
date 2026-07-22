/**
 * A full 500-row file can create products, variants, images and attributes.
 * Keep the serializable transaction bounded, while allowing enough time for
 * the complete all-or-nothing import to finish.
 */
export const BULK_IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000
export const BULK_IMPORT_TRANSACTION_TIMEOUT_MS = 120_000
