import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type {
  SchemaSnapshotAttributes,
  SchemaSnapshotCreationAttributes,
} from './schema-snapshot.types';
import { Connection } from '../connection/connection.model';

/** The tables and columns read from a customer database at one refresh, as a versioned JSON document. */
@Table({
  tableName: 'schema_snapshots',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class SchemaSnapshot
  extends Model<SchemaSnapshotAttributes, SchemaSnapshotCreationAttributes>
  implements SchemaSnapshotAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => Connection)
  @Column({ type: DataType.TEXT, allowNull: false })
  connectionId!: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  override version!: number;

  @Column({ type: DataType.JSONB, allowNull: false })
  document!: unknown;

  @Column({ type: DataType.INTEGER, allowNull: false })
  tableCount!: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  columnCount!: number;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @BelongsTo(() => Connection)
  connection?: Connection;
}
