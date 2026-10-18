import type { Optional } from 'sequelize';

/** A schema_snapshots row: one read of a connection's tables and columns (ADR 0008). */
export interface SchemaSnapshotAttributes {
  id: string;
  connectionId: string;
  version: number;
  /** A SchemaDocument (packages/core/src/schema/schema-document.ts), stored as JSONB. */
  document: unknown;
  tableCount: number;
  columnCount: number;
  createdAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type SchemaSnapshotCreationAttributes = Optional<
  SchemaSnapshotAttributes,
  'createdAt'
>;
