# @ayd/database

The app database's schema: Sequelize models, their TypeScript types, enums, and the sequelize-cli migrations (ADR 0004, ADR 0015). It is the app's own data (users, sealed connections, snapshots, allowlists, history, usage, and audit), never a customer's rows.

**Folders**

| Path                      | Holds                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `migrations/`             | The tables, as sequelize-cli migrations. These are the source of truth for the schema.            |
| `src/tables/<table>/`     | Everything about one table: its model, its row types, its enums, and an `index.ts`                |
| `src/tables/index.ts`     | Re-exports every table folder, and the `models` list Sequelize registers                          |
| `src/create-sequelize.ts` | The shared Sequelize settings (every model, pool, timeout), and an instance for scripts and tests |

Inside a table folder, for example `src/tables/connection/`:

| File                        | Holds                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `connection.model.ts`       | The `sequelize-typescript` class (`@Table`, `@Column`) that queries use                 |
| `connection.types.ts`       | `ConnectionAttributes` (a row) and `ConnectionCreationAttributes` (what creating needs) |
| `connection-status.enum.ts` | A fixed list of values a column holds (`ConnectionStatus.Active`, `.Failing`)           |
| `index.ts`                  | Exports the folder, so importers write `from '@ayd/database'`                           |

**Rules** (they cost time once):

- Every `@Column` names its type. tsx emits no decorator metadata.
- New time columns are `TIMESTAMPTZ(3)` (`DataType.DATE(3)`). Sequelize reads plain `TIMESTAMP` as local time.
- Indexes and constraints live in the migrations, not in the models.

**Commands** (they read `DATABASE_URL` from the root `.env`):

```powershell
npm run migrate -w @ayd/database
npm run migrate:status -w @ayd/database
```
