# ADR 0006: Shared Nest modules wait until the worker needs them

`config`, logging, and Redis are duplicated in small form between the API and the worker. Framework-agnostic libraries (`sql-guard`, `ssrf-guard`) will be their own packages when those phases start. Nest modules both processes need (config, logger, Redis, and later crypto, the executor, and the model layer) move to `packages/core` before Phase 6, when the worker starts running jobs. Moving them earlier creates a package with one caller.
