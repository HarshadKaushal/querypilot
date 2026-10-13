import { checkCoreEnv, coreEnvFields, loadRootEnvFile, parseEnv } from '@ayd/core';
import { z } from 'zod';

export { ROOT_ENV_FILE } from '@ayd/core';

loadRootEnvFile();

const EnvSchema = z
  .object({
    ...coreEnvFields,
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
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
    EGRESS_IP: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    checkCoreEnv(env, ctx);
    if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_LOGIN_ENABLED'],
        message: 'DEV_LOGIN_ENABLED cannot be true when NODE_ENV is production',
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
    googleConfigured:
      env.GOOGLE_CLIENT_ID.length > 0 &&
      env.GOOGLE_CLIENT_SECRET.length > 0 &&
      env.GOOGLE_REDIRECT_URI.length > 0,
  }));

export type AppEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return parseEnv(EnvSchema, source);
}
