# ADR 0004: Database package

The Prisma schema, migrations, and generated client live in `packages/database`. The API and the worker both read and write application rows. Keeping the schema inside `apps/api` would make the worker import from another app. Nest modules that open the client can stay in the app that uses them until more than one process needs the same module.
