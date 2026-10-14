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

/** GET /v1/meta/egress: what the customer allows in their firewall and database. */
export interface EgressInfo {
  /** Empty when the server has none configured. */
  egressIp: string;
  setupSql: string;
  firewall: string;
}

export type JobKind =
  | 'query.run'
  | 'question.ask'
  | 'connection.create'
  | 'connection.update'
  | 'connection.test'
  | 'schema.refresh';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type JobStage =
  | 'loading_schema'
  | 'generating_sql'
  | 'checking_sql'
  | 'connecting'
  | 'running_query'
  | 'summarizing'
  | 'checking_access'
  | 'reading_schema';

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
  detail?: Record<string, string>;
}

/** A job as GET /v1/jobs/:id and the event stream show it. */
export interface JobView<Result = unknown> {
  id: string;
  kind: JobKind;
  state: JobState;
  stage?: JobStage;
  cancelRequested?: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Only when state is succeeded. */
  result?: Result;
  /** Only when state is failed or cancelled. */
  error?: JobError;
}

/** The fields a connection is created with. The password is sent once and never shown. */
export interface ConnectionInput {
  label: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: 'require' | 'verify-full';
  sendSampleRowsToLlm: boolean;
}

/** The result of a schema.refresh job. */
export interface RefreshSummary {
  connectionId: string;
  version: number;
  createdAt: string;
  tableCount: number;
  columnCount: number;
  /** True on the first read, when every table and non-sensitive column starts allowed. */
  defaultsApplied: boolean;
  /** Objects new since the last read; they start hidden. */
  newObjects: { tables: string[]; columns: string[] };
}

export type RelationKind =
  'table' | 'partitioned_table' | 'view' | 'materialized_view' | 'foreign_table';

/** GET /v1/connections/:id/allowlist: every object in the latest schema, allowed or not. */
export interface AllowlistView {
  connectionId: string;
  version: number;
  createdAt: string;
  tables: Array<{
    schema: string;
    name: string;
    kind: RelationKind;
    allowed: boolean;
    description: string | null;
    columns: Array<{
      name: string;
      type: string;
      nullable: boolean;
      allowed: boolean;
      /** A name-based hint: personal data or credentials. Hidden by default. */
      sensitive: boolean;
      description: string | null;
    }>;
  }>;
}

/** PUT /v1/connections/:id/allowlist: the full list of what the AI may see. */
export interface AllowlistInput {
  /** The schema version the user edited; a newer one gives 409 SCHEMA_CHANGED. */
  version: number;
  tables: Array<{
    schema: string;
    name: string;
    description?: string | null;
    columns?: Array<{ name: string; description?: string | null }>;
  }>;
}
