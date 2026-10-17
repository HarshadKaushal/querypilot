# Documentation

## Start here (new to the repository)

Read these in order. Together they take about an hour.

1. [../README.md](../README.md): what the project is, how to run it, and where the folders are.
2. [request-flow.md](request-flow.md): one question followed through every file, from the button to the database and back.
3. [conventions.md](conventions.md): how files are named, how errors and validation work, and the comment style.
4. The README inside the app or package you are about to change (`apps/*/README.md`, `packages/*/README.md`).
5. The ADRs ([adr/](adr/)) for the part you are changing. They say why it is built the way it is.

## Everything else

| Document                                             | Read it for                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CONTEXT.md](CONTEXT.md)                             | The shared notes for AI coding sessions: where things stand, decisions, pitfalls, and work in progress. Read it first in every session. People may find the "Decisions" and "Pitfalls" useful too. |
| [blueprint.md](blueprint.md)                         | The product and the phase plan. This is the source of scope.                                                                                                                                       |
| [design-philosophy.md](design-philosophy.md)         | Why the system is a pass-through and why phases are gated.                                                                                                                                         |
| [features.md](features.md)                           | What is done, partial, or still pending.                                                                                                                                                           |
| [extra.md](extra.md)                                 | What the project does beyond the assignment brief, and where it is stricter.                                                                                                                       |
| [implementation.md](implementation.md)               | How the code was built, phase by phase, the trade-offs taken, and how to extend it.                                                                                                                |
| [business-domain.md](business-domain.md)             | Business rules. **Enforced** means the code does it. **Assumed** means it is not built yet.                                                                                                        |
| [testing.md](testing.md)                             | Where tests go, how they are named, and which command runs them.                                                                                                                                   |
| [sequelize.md](sequelize.md)                         | A learning guide to the move from Prisma to Sequelize (2026-10-16).                                                                                                                                |
| [dependency-advisories.md](dependency-advisories.md) | npm audit findings accepted on purpose, why, and when to revisit them.                                                                                                                             |
| [adr/](adr/)                                         | Short records of decisions that are expensive to reverse.                                                                                                                                          |
| [ai-reviews/](ai-reviews/)                           | One review per commit: AI usage, accepted and rejected suggestions, and decisions.                                                                                                                 |
