# @ayd/database

The app database's schema: Sequelize models, their TypeScript types, enums, and the sequelize-cli migrations (ADR 0004, ADR 0015). It is the app's own data (users, sealed connections, snapshots, allowlists, history, usage, and audit), never a customer's rows.

**Folders**

| Path                      | Holds                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `migrations/`             | The tables, as sequelize-cli migrations. These are the source of truth for the schema.            |
| `src/models/`             | One `sequelize-typescript` model per table, for queries                                           |
| `src/types/`              | Each table's attributes, and which of them are needed to create a row                             |
| `src/enums/`              | Fixed lists of values (plan tier, connection status, and others)                                  |
| `src/create-sequelize.ts` | The shared Sequelize settings (every model, pool, timeout), and an instance for scripts and tests |

**Rules** (they cost time once):

- Every `@Column` names its type. tsx emits no decorator metadata.
- New time columns are `TIMESTAMPTZ(3)` (`DataType.DATE(3)`). Sequelize reads plain `TIMESTAMP` as local time.
- Indexes and constraints live in the migrations, not in the models.

**Commands** (they read `DATABASE_URL` from the root `.env`):

```powershell
npm run migrate -w @ayd/database
npm run migrate:status -w @ayd/database
```
