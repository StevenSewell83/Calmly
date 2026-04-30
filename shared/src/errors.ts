// Canonical IPC error codes shared between main-process handlers and the
// renderer. Keep names here and import rather than spelling them inline so
// all callers stay in sync.

export const IPC_ERRORS = {
  // Authentication
  NOT_SIGNED_IN: "NotSignedIn",

  // Payload shape / validation failures (the request itself is malformed)
  INVALID_ARGS: "InvalidArgs",

  // Row existence failures (payload is well-formed but the referenced item
  // doesn't exist or doesn't belong to the authenticated user)
  NOT_FOUND: "NotFound",

  // Business-rule violations (row exists but state makes the operation
  // illegal — e.g. already resolved, duplicate, etc.)
  ALREADY_RESOLVED: "AlreadyResolved",

  // Unexpected server-side failures (should be rare; details are logged
  // main-side and not surfaced to the renderer)
  INTERNAL_ERROR: "InternalError",
} as const;

export type IpcErrorCode = (typeof IPC_ERRORS)[keyof typeof IPC_ERRORS];
