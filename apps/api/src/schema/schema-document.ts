// The structure a refresh reads from a user database. It holds names and types only, never
// rows or comments. Stored as JSON in schema_snapshots.document; bump formatVersion when the
// shape changes.

export type RelationKind =
  'table' | 'partitioned_table' | 'view' | 'materialized_view' | 'foreign_table';

export interface SchemaColumn {
  name: string;
  /** PostgreSQL's format_type output, for example "numeric(12,2)". */
  type: string;
  nullable: boolean;
}

export interface SchemaForeignKey {
  columns: string[];
  references: { schema: string; table: string; columns: string[] };
}

export interface SchemaTable {
  schema: string;
  name: string;
  kind: RelationKind;
  columns: SchemaColumn[];
  primaryKey: string[];
  foreignKeys: SchemaForeignKey[];
}

export interface SchemaDocument {
  formatVersion: 1;
  /** Sorted by schema, then name. Columns keep their table order. */
  tables: SchemaTable[];
}
