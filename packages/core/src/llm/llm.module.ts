import { Module } from '@nestjs/common';
import { APP_ENV, type CoreEnv } from '../config/env';
import { GeminiProvider } from './gemini.provider';
import { LLM_PROVIDERS, LLM_SUMMARY_PROVIDERS, LlmClient } from './llm-client';
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

/**
 * The summary model, then the primary as its fallback. A summary is short and its numbers
 * are checked anyway, so a lighter model answers faster, with its own rate-limit quota.
 * An empty LLM_SUMMARY_MODEL sends summaries through the main chain.
 */
export function geminiSummaryProviders(env: CoreEnv): LlmProvider[] {
  if (!env.LLM_SUMMARY_MODEL) {
    return geminiProviders(env);
  }
  const models = [env.LLM_SUMMARY_MODEL];
  if (env.LLM_PRIMARY_MODEL !== env.LLM_SUMMARY_MODEL) {
    models.push(env.LLM_PRIMARY_MODEL);
  }
  return models.map(
    (model) => new GeminiProvider(model, env.GEMINI_API_KEY, env.LLM_TIMEOUT_MS),
  );
}

/** The model layer. Only the worker calls models; the API never imports this. */
@Module({
  providers: [
    { provide: LLM_PROVIDERS, inject: [APP_ENV], useFactory: geminiProviders },
    {
      provide: LLM_SUMMARY_PROVIDERS,
      inject: [APP_ENV],
      useFactory: geminiSummaryProviders,
    },
    LlmClient,
  ],
  exports: [LlmClient],
})
export class LlmModule {}
