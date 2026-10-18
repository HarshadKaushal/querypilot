/**
 * A saved connection's state (connections.status): active after its last test passed,
 * failing after its last test failed.
 */
export const ConnectionStatus = {
  Active: 'active',
  Failing: 'failing',
} as const;

export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];
