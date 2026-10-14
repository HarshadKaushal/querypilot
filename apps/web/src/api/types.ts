// The API's response shapes, copied from the server code (docs/adr/0014-web-app.md says
// why they are copied rather than shared). Keep them in step when a route changes.

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  planTier: string;
}

/** POST /v1/auth/dev/login and /v1/auth/refresh. The refresh token stays in its cookie. */
export interface Session {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: PublicUser;
}

/** A connection as the API shows it: never the username or password. */
export interface PublicConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: 'active' | 'failing' | string;
  lastTestedAt: string | null;
  sendSampleRowsToLlm: boolean;
  keyVersion: number;
}
