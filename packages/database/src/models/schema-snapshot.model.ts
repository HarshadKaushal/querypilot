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
} from '../types/schema-snapshot.types';
import { Connection } from './connection.model';

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
