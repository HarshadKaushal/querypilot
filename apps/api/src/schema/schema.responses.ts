import type {
  AllowedColumn,
  AllowedTable,
  AllowlistTableView,
  AllowlistView,
  RefreshSummary,
  RelationKind,
  SchemaForeignKey,
  SchemaView,
} from '@ayd/core';
import { ApiProperty } from '@nestjs/swagger';

// What the schema and allowlist routes send back, for the API docs only. Request bodies
// are in allowlist.dto.ts. `implements` keeps each class in step with core's type.

const RELATION_KINDS: RelationKind[] = [
  'table',
  'partitioned_table',
  'view',
  'materialized_view',
  'foreign_table',
];

/** The result of a schema.refresh job. */
export class RefreshSummaryDto implements RefreshSummary {
  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty()
  tableCount!: number;

  @ApiProperty()
  columnCount!: number;

  @ApiProperty({
    description: 'True on the first read, when the default allowlist was applied.',
  })
  defaultsApplied!: boolean;

  @ApiProperty({
    description: 'Objects new since the last read; they start hidden.',
    example: { tables: ['public.refunds'], columns: ['public.orders.discount'] },
  })
  newObjects!: { tables: string[]; columns: string[] };
}

export class ForeignKeyDto implements SchemaForeignKey {
  @ApiProperty({ type: [String] })
  columns!: string[];

  @ApiProperty({ example: { schema: 'public', table: 'customers', columns: ['id'] } })
  references!: { schema: string; table: string; columns: string[] };
}

export class AllowedColumnDto implements AllowedColumn {
  @ApiProperty({ example: 'created_at' })
  name!: string;

  @ApiProperty({ example: 'timestamp with time zone' })
  type!: string;

  @ApiProperty()
  nullable!: boolean;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
}

export class AllowedTableDto implements AllowedTable {
  @ApiProperty({ example: 'public' })
  schema!: string;

  @ApiProperty({ example: 'orders' })
  name!: string;

  @ApiProperty({ enum: RELATION_KINDS })
  kind!: RelationKind;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: [AllowedColumnDto] })
  columns!: AllowedColumnDto[];

  @ApiProperty({ type: [String] })
  primaryKey!: string[];

  @ApiProperty({ type: [ForeignKeyDto] })
  foreignKeys!: ForeignKeyDto[];
}

/** What the AI may see: only the allowed tables and columns of the latest snapshot. */
export class SchemaViewDto implements SchemaView {
  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ description: 'Changes when the allowed schema changes.' })
  fingerprint!: string;

  @ApiProperty({ type: [AllowedTableDto] })
  tables!: AllowedTableDto[];
}

export class AllowlistColumnViewDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  nullable!: boolean;

  @ApiProperty()
  allowed!: boolean;

  @ApiProperty({
    description: 'A name-based hint (personal data, credentials). Hidden by default.',
  })
  sensitive!: boolean;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
}

export class AllowlistTableViewDto implements AllowlistTableView {
  @ApiProperty()
  schema!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: RELATION_KINDS })
  kind!: RelationKind;

  @ApiProperty()
  allowed!: boolean;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: [AllowlistColumnViewDto] })
  columns!: AllowlistColumnViewDto[];
}

/** Every table and column of the latest snapshot, with whether the AI may see it. */
export class AllowlistViewDto implements AllowlistView {
  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty({ description: 'Send this back as `version` when saving the allowlist.' })
  version!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [AllowlistTableViewDto] })
  tables!: AllowlistTableViewDto[];
}
