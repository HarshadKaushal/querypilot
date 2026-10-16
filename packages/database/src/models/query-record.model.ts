import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { QueryKind } from '../enums/query-kind.enum';
import type { QueryStatus } from '../enums/query-status.enum';
import type {
  QueryRecordAttributes,
  QueryRecordCreationAttributes,
} from '../types/query-record.types';
import { Connection } from './connection.model';
import { User } from './user.model';

// timestamps is off: created_at is when the job was submitted, which the caller passes in,
// and Sequelize's automatic createdAt would overwrite it with the insert time.
@Table({ tableName: 'queries', underscored: true, timestamps: false })
export class QueryRecord
  extends Model<QueryRecordAttributes, QueryRecordCreationAttributes>
  implements QueryRecordAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.TEXT, allowNull: false })
  userId!: string;

  @ForeignKey(() => Connection)
  @Column({ type: DataType.TEXT, allowNull: false })
  connectionId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  kind!: QueryKind;

  @Column({ type: DataType.TEXT, allowNull: true })
  question!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  sql!: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  status!: QueryStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  errorCode!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  rowCount!: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  truncated!: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  schemaVersion!: number | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  cached!: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  summary!: string | null;

  @Column({ type: DataType.JSONB, allowNull: false })
  models!: string[];

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  inputTokens!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  outputTokens!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  llmMs!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  queryMs!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  totalMs!: number;

  @Column({ type: DataType.DATE(3), allowNull: false })
  override createdAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: false, defaultValue: DataType.NOW })
  finishedAt!: Date;

  @BelongsTo(() => User)
  user?: User;

  @BelongsTo(() => Connection)
  connection?: Connection;
}
