// The application database: one folder per table under ./tables, each with its Sequelize
// model, its attribute types, and the value lists (enums) its columns hold. The tables
// themselves are created by the migrations in ../migrations, run with
// `npm run migrate --workspace=@ayd/database` (ADR 0004, ADR 0015).
export * from './create-sequelize';
export * from './tables';
