/**
 * How a connection reaches the customer's database (connections.ssl_mode). Only modes that
 * always encrypt are accepted; the connection service rejects disable, allow, and prefer.
 */
export const SslMode = {
  Require: 'require',
  VerifyFull: 'verify-full',
} as const;

export type SslMode = (typeof SslMode)[keyof typeof SslMode];
