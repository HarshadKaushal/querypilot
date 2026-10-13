import { checkCoreEnv, coreEnvFields, loadRootEnvFile, parseEnv } from '@ayd/core';
import { z } from 'zod';

export { ROOT_ENV_FILE } from '@ayd/core';

loadRootEnvFile();

// The worker reads the same core settings as the API: its jobs use the application
// database, Redis, the credential keys, and the executor limits.
const EnvSchema = z
  .object({
    ...coreEnvFields,
    // Jobs one worker process runs at the same time.
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  })
  .superRefine(checkCoreEnv);

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnv(EnvSchema, source);
}
