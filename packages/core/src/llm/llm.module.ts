import { Module } from '@nestjs/common';
import { APP_ENV, type CoreEnv } from '../config/env';
import { GeminiProvider } from './gemini.provider';
import { LLM_PROVIDERS, LlmClient } from './llm-client';
import type { LlmProvider } from './llm.types';

/** The primary model, then the fallback when one is set and differs. */
export function geminiProviders(env: CoreEnv): LlmProvider[] {
  const models = [env.LLM_PRIMARY_MODEL];
  if (env.LLM_FALLBACK_MODEL && env.LLM_FALLBACK_MODEL !== env.LLM_PRIMARY_MODEL) {
    models.push(env.LLM_FALLBACK_MODEL);
  }
  return models.map(
    (model) => new GeminiProvider(model, env.GEMINI_API_KEY, env.LLM_TIMEOUT_MS),
  );
}

/** The model layer. Only the worker calls models; the API never imports this. */
@Module({
  providers: [
    { provide: LLM_PROVIDERS, inject: [APP_ENV], useFactory: geminiProviders },
    LlmClient,
  ],
  exports: [LlmClient],
})
export class LlmModule {}
