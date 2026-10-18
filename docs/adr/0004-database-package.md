# ADR 0004: Database package

The Prisma schema, migrations, and generated client live in `packages/database`. The API and the worker both read and write application rows. Keeping the schema inside `apps/api` would make the worker import from another app. Nest modules that open the client can stay in the app that uses them until more than one process needs the same module.

**Updated 2026-10-16.** The project moved from Prisma to Sequelize (ADR 0015). The package still holds everything that describes the application database, now as Sequelize models, their attribute types, and the value lists some columns hold (one folder per table under `src/tables/` since 2026-10-18), and the sequelize-cli migrations (`migrations/`). The Nest module that opens the connection, `DatabaseModule`, lives in `@ayd/core` because both the API and the worker use it (ADR 0006).
