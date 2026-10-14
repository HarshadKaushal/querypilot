import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// src/config and dist/config are both four levels below the repository root.
export const ROOT_ENV_FILE = resolve(__dirname, '../../../../.env');

/** Loads the repository's root .env into process.env. Values already set win. */
export function loadRootEnvFile(): void {
  loadDotenv({ path: ROOT_ENV_FILE, quiet: true });
}

/**
 * The Nest token for the parsed environment. Each app provides it with its own schema, which
 * must include coreEnvFields, so the modules in this package can read what they need.
 */
export const APP_ENV = Symbol('APP_ENV');

/** Settings the shared modules read. Apps spread these into their own schema. */
export const coreEnvFields = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      { error: 'DATABASE_URL must be a postgres URL' },
    ),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      error: 'REDIS_URL must be a redis URL',
    }),
  // Envelope encryption keys for connection credentials (ADR 0007).
  CRYPTO_MASTER_KEY_VERSION: z.coerce.number().int().min(1),
  CRYPTO_MASTER_KEYS: z.string().min(1),
  // Lets a laptop reach databases on private addresses. Refused in production.
  SSRF_ALLOW_PRIVATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // The BullMQ queue the API adds jobs to and the worker takes them from.
  JOB_QUEUE_NAME: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .default('ayd-jobs'),
  // How long a finished job and its result stay readable, in seconds.
  JOB_RESULT_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  // Unfinished jobs (queued or running) one user may have at once.
  JOB_MAX_ACTIVE_PER_USER: z.coerce.number().int().min(1).max(50).default(3),
  // Runs of a job that crashed (not one that failed with a code) before it is given up.
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  // How long a job that was given up stays in the failed set for inspection, in seconds.
  JOB_FAILED_RETENTION_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(30 * 86400)
    .default(7 * 86400),
  // The model layer (ADR 0012). Empty key: the worker still starts, and model calls fail
  // with a clear "not configured" outcome. Free AI Studio keys let Google use the content.
  GEMINI_API_KEY: z.string().default(''),
  LLM_PRIMARY_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  // Tried when the primary is rate-limited, down, or answers in the wrong shape. Empty: none.
  LLM_FALLBACK_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // Summaries: a lighter, faster model first, then the primary. Empty: the main chain.
  LLM_SUMMARY_MODEL: z.string().default('gemini-3.5-flash-lite'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  // Most rows one answer may return. The SQL guard adds or lowers LIMIT to this plus one.
  SQL_ROW_CAP: z.coerce.number().int().min(1).max(10000).default(1000),
  // Executor limits for queries on user databases (ADR 0010).
  EXECUTOR_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300000)
    .default(15000),
  EXECUTOR_MAX_RESULT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100_000_000)
    .default(5_000_000),
  EXECUTOR_MAX_CONCURRENT_QUERIES: z.coerce.number().int().min(1).max(50).default(2),
  EXECUTOR_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(120000).default(10000),
  EXECUTOR_BREAKER_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  EXECUTOR_BREAKER_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .default(60000),
};

/** Cross-field rules for the core settings. Apps call this from their own superRefine. */
export function checkCoreEnv(
  env: { NODE_ENV: string; SSRF_ALLOW_PRIVATE: boolean },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV === 'production' && env.SSRF_ALLOW_PRIVATE) {
    ctx.addIssue({
      code: 'custom',
      path: ['SSRF_ALLOW_PRIVATE'],
      message: 'SSRF_ALLOW_PRIVATE cannot be true when NODE_ENV is production',
    });
  }
}

const CoreEnvSchema = z.object(coreEnvFields).superRefine(checkCoreEnv);

export type CoreEnv = z.infer<typeof CoreEnvSchema>;

/**
 * Parses an environment with the given schema. A failure names the bad fields and never
 * their values, so a URL with a password is not printed.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: NodeJS.ProcessEnv,
): z.infer<Schema> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.') || 'environment')
      .join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  return parsed.data;
}

/** The core settings alone, for code and tests that need nothing else. */
export function loadCoreEnv(source: NodeJS.ProcessEnv = process.env): CoreEnv {
  return parseEnv(CoreEnvSchema, source);
}
