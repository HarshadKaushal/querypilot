import type { Optional } from 'sequelize';

/** An allowed_objects row: a table, or one column of it, the model may see. */
export interface AllowedObjectAttributes {
  id: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  /** Null means the whole table. */
  columnName: string | null;
  description: string | null;
  createdAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type AllowedObjectCreationAttributes = Optional<
  AllowedObjectAttributes,
  'columnName' | 'description' | 'createdAt'
>;
