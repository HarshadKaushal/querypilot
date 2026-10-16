import type { Request } from 'express';

/** Where a request came from, for audit entries and refresh-token records. */
export interface RequestMeta {
  ip: string | null;
  deviceInfo: string | null;
}

export function requestMeta(request: Request): RequestMeta {
  const agent = request.header('user-agent');
  return {
    ip: request.ip ? request.ip.slice(0, 64) : null,
    deviceInfo: agent ? agent.slice(0, 200) : null,
  };
}
