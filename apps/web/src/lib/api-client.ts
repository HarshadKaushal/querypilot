import type { ErrorCode, ErrorEnvelope } from '@ayd/shared';

/** A failed request, carrying the API's error code and message (or a network failure). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly requestId: string | null = null,
    /** From the Retry-After header on 429 responses. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Where the client gets the access token, and how it asks for a new one. */
export interface TokenSource {
  current(): string | null;
  /** A fresh access token, or null when the session is over. */
  refresh(): Promise<string | null>;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClient {
  /** The status and body, for routes whose status matters (202 job vs 200). */
  send<T>(path: string, options?: RequestOptions): Promise<ApiResponse<T>>;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  /** A raw authorised fetch, for streams (Server-Sent Events) that are read as they arrive. */
  stream(path: string, signal: AbortSignal): Promise<Response>;
}

const NETWORK_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * Every request to the API goes through here. It adds the access token, turns the API's
 * error envelope into an ApiError, and when a token has expired (401) asks for a new one
 * once and repeats the request. Auth routes are never repeated, so a failed refresh cannot
 * loop.
 */
export function createApiClient(
  tokens: TokenSource,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ApiClient {
  async function authorisedFetch(path: string, init: RequestInit): Promise<Response> {
    const attempt = (token: string | null) => {
      const headers = new Headers(init.headers);
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetchImpl(path, { ...init, headers, credentials: 'same-origin' }).catch(
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
          }
          throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
        },
      );
    };
    const response = await attempt(tokens.current());
    if (response.status !== 401 || path.startsWith('/v1/auth/')) {
      return response;
    }
    const fresh = await tokens.refresh();
    return fresh ? attempt(fresh) : response;
  }

  async function send<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const init: RequestInit = { method: options.method ?? 'GET', signal: options.signal };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const response = await authorisedFetch(path, init);
    if (!response.ok) {
      throw await toApiError(response);
    }
    const data = response.status === 204 ? undefined : await response.json();
    return { status: response.status, data: data as T };
  }

  return {
    send,
    get: async <T>(path: string, signal?: AbortSignal) =>
      (await send<T>(path, { signal })).data,
    post: async <T>(path: string, body?: unknown) =>
      (await send<T>(path, { method: 'POST', body })).data,
    put: async <T>(path: string, body: unknown) =>
      (await send<T>(path, { method: 'PUT', body })).data,
    delete: async (path: string) => {
      await send<void>(path, { method: 'DELETE' });
    },
    stream: async (path: string, signal: AbortSignal) => {
      const response = await authorisedFetch(path, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      if (!response.ok) {
        throw await toApiError(response);
      }
      return response;
    },
  };
}

/** Reads the error envelope; a body that is not one (a proxy error page) still gives a code. */
export async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get('Retry-After'));
  let envelope: Partial<ErrorEnvelope> = {};
  try {
    envelope = (await response.json()) as Partial<ErrorEnvelope>;
  } catch {
    // Not JSON: fall through to the generic message below.
  }
  const error = envelope.error;
  return new ApiError(
    response.status,
    error?.code ?? 'INTERNAL_ERROR',
    error?.message ?? 'Something went wrong. Try again.',
    error?.requestId ?? response.headers.get('x-request-id'),
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  );
}
