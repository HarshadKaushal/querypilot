/** The `code` property of a pg or Node error: a SQLSTATE such as 42703, or ECONNREFUSED. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
