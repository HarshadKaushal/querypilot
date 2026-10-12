import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// src/config and dist/config are both four levels below the repository root.
export const ROOT_ENV_FILE = resolve(__dirname, '../../../../.env');

loadDotenv({ path: ROOT_ENV_FILE, quiet: true });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
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
    AUTH_JWT_SECRET: z.string().min(32),
    AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    AUTH_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 90)
      .default(60 * 60 * 24 * 14),
    DEV_LOGIN_ENABLED: z.enum(['true', 'false']).default('false'),
    APP_WEB_ORIGIN: z.url().default('http://localhost:5173'),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default(''),
    CRYPTO_MASTER_KEY_VERSION: z.coerce.number().int().min(1),
    CRYPTO_MASTER_KEYS: z.string().min(1),
    SSRF_ALLOW_PRIVATE: z.enum(['true', 'false']).default('false'),
    EGRESS_IP: z.string().default(''),
    // Most rows one answer may return. The SQL guard adds or lowers LIMIT to this.
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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOGIN_ENABLED'],
        message: 'DEV_LOGIN_ENABLED cannot be true when NODE_ENV is production',
      });
    }
    if (env.NODE_ENV === 'production' && env.SSRF_ALLOW_PRIVATE === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['SSRF_ALLOW_PRIVATE'],
        message: 'SSRF_ALLOW_PRIVATE cannot be true when NODE_ENV is production',
      });
    }
    const hasClient =
      env.GOOGLE_CLIENT_ID.length > 0 || env.GOOGLE_CLIENT_SECRET.length > 0;
    const hasTrio =
      env.GOOGLE_CLIENT_ID.length > 0 &&
      env.GOOGLE_CLIENT_SECRET.length > 0 &&
      env.GOOGLE_REDIRECT_URI.length > 0;
    if (hasClient && !hasTrio) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Google sign-in requires client id, client secret, and redirect URI',
      });
    }
    if (env.GOOGLE_REDIRECT_URI.length > 0) {
      try {
        const url = new URL(env.GOOGLE_REDIRECT_URI);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          throw new Error('bad protocol');
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['GOOGLE_REDIRECT_URI'],
          message: 'GOOGLE_REDIRECT_URI must be an http(s) URL',
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    DEV_LOGIN_ENABLED: env.DEV_LOGIN_ENABLED === 'true',
    SSRF_ALLOW_PRIVATE: env.SSRF_ALLOW_PRIVATE === 'true',
    googleConfigured:
      env.GOOGLE_CLIENT_ID.length > 0 &&
      env.GOOGLE_CLIENT_SECRET.length > 0 &&
      env.GOOGLE_REDIRECT_URI.length > 0,
  }));

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.') || 'environment')
      .join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  return parsed.data;
}
