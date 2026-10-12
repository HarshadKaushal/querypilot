import { errorCode } from '../errors/error-code';

const SECRET_URL = /(?:postgres(?:ql)?|redis(?:s)?):\/\/\S+/gi;

/**
 * What is safe to log about an error: its name, its message with database and Redis URLs
 * removed, and its SQLSTATE or Node code. Never the raw message, which can hold credentials.
 */
export function safeErrorDetail(error: unknown): {
  name: string;
  message: string;
  code?: string;
} {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: 'unknown failure' };
  }
  const code = errorCode(error);
  return {
    name: error.name,
    message: error.message.replace(SECRET_URL, '[redacted-url]').slice(0, 300),
    ...(code ? { code } : {}),
  };
}
