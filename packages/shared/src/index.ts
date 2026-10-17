// @ayd/shared: the small set of types and helpers both the server and its clients need
// (error codes and envelope, the health report, request ids). It has no dependencies.
export { ERROR_CODES, errorEnvelope } from './errors';
export type { ErrorCode, ErrorEnvelope } from './errors';
export type { DependencyCheck, HealthReport } from './health';
export { REQUEST_ID_HEADER, resolveRequestId } from './request-id';
