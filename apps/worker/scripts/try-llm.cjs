// Checks the Gemini key and models with one small structured request.
// Usage: npm run try-llm --workspace=@ayd/worker
// Needs GEMINI_API_KEY in the root .env and a built @ayd/core (npm run build).
const { z } = require('zod');
const core = require('@ayd/core');

async function main() {
  core.loadRootEnvFile();
  const env = core.loadCoreEnv();
  if (!env.GEMINI_API_KEY) {
    console.error(
      'GEMINI_API_KEY is not set. Add it to the .env file at the repository root.',
    );
    process.exit(2);
  }
  const client = new core.LlmClient(core.geminiProviders(env));
  const answer = z.object({
    greeting: z.string().describe('A one-line greeting'),
    sql: z.string().describe('A PostgreSQL SELECT that counts the rows of public.orders'),
  });
  try {
    const result = await client.generateObject(
      {
        purpose: 'probe',
        system: 'You are a connectivity check. Answer only with the requested JSON.',
        prompt: 'Greet the developer and write the SQL described in the schema.',
        maxOutputTokens: 512,
      },
      answer,
    );
    console.log(`Model: ${result.response.model}`);
    console.log(`Answer: ${JSON.stringify(result.value)}`);
    console.log(
      `Tokens: ${result.response.inputTokens} in, ${result.response.outputTokens} out, ${result.response.latencyMs} ms`,
    );
    for (const attempt of result.attempts) {
      console.log(
        `  tried ${attempt.model}: ${attempt.outcome} (${attempt.latencyMs} ms)`,
      );
    }
  } catch (error) {
    console.error(`Failed (${error.kind ?? 'error'}): ${error.message}`);
    for (const attempt of core.attemptsOf(error)) {
      console.error(
        `  tried ${attempt.model}: ${attempt.outcome} (${attempt.latencyMs} ms)`,
      );
    }
    process.exit(1);
  }
}

main();
