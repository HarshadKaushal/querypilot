// The id that ties one request's log lines, error body, and response header together.

export const REQUEST_ID_HEADER = 'x-request-id';

// A caller's id is reused only if it is plain and of a sane length, so it cannot inject
// text into log lines.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Keeps the caller's x-request-id when it is safe, otherwise makes a new UUID. */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  if (value && SAFE_REQUEST_ID.test(value)) {
    return value;
  }
  return crypto.randomUUID();
}
