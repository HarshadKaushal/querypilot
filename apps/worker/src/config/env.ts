import { coreEnvFields, loadRootEnvFile, parseEnv } from '@ayd/core';
import { z } from 'zod';

export { ROOT_ENV_FILE } from '@ayd/core';

loadRootEnvFile();

// The worker reads the same core settings as the API: the jobs it runs use the application
// database, Redis, and the executor limits.
const EnvSchema = z.object({ ...coreEnvFields });

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnv(EnvSchema, source);
}
