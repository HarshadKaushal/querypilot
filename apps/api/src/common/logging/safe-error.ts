const SECRET_URL = /(?:postgres(?:ql)?|redis(?:s)?):\/\/\S+/gi;

export function safeErrorDetail(error: unknown): { name: string; message: string } {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: 'unknown failure' };
  }
  return {
    name: error.name,
    message: error.message.replace(SECRET_URL, '[redacted-url]').slice(0, 300),
  };
}
