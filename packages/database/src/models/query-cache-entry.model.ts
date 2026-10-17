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
  QueryCacheEntryAttributes,
  QueryCacheEntryCreationAttributes,
} from '../types/query-cache-entry.types';
import { Connection } from './connection.model';

/** A saved SQL proposal for a question, reused while the schema fingerprint is unchanged (ProposalCache). */
@Table({
  tableName: 'query_cache',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class QueryCacheEntry
  extends Model<QueryCacheEntryAttributes, QueryCacheEntryCreationAttributes>
  implements QueryCacheEntryAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => Connection)
  @Column({ type: DataType.TEXT, allowNull: false })
  connectionId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  fingerprint!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  questionHash!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  sql!: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  assumptions!: string[];

  @Column({ type: DataType.TEXT, allowNull: false })
  explanation!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  model!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  hits!: number;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: false, defaultValue: DataType.NOW })
  lastUsedAt!: Date;

  @BelongsTo(() => Connection)
  connection?: Connection;
}
