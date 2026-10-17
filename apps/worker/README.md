# @ayd/worker

The background worker (a NestJS application context with no HTTP server). It takes jobs off the Redis queue and runs them: questions, SQL, connection checks, and schema reads. It is the only process that opens customer databases or calls the model (ADR 0003, ADR 0011).

The worker is deliberately thin. The real work is in `@ayd/core` (`packages/core/src/jobs/` and `src/ask/`); this app only starts it and logs what happens.

**Start reading at**

- `src/main.ts`: loads and checks the environment, starts the app, and pings Redis.
- `src/worker.module.ts`: which core modules the worker uses.
- `src/jobs/job-worker.ts`: starts core's `startJobWorker()` and turns its events into log lines (never SQL or rows).

**Commands** (from the repository root):

```powershell
npm run dev:worker                  # tsx watch; reads the root .env
npm run test:unit -w @ayd/worker
npm run try-llm -w @ayd/worker      # checks that GEMINI_API_KEY works
```

`WORKER_CONCURRENCY` (default 5) is how many jobs one worker runs at once. `LLM_FAKE=true` swaps Gemini for a scripted model; only the browser tests use it, and production refuses it.
