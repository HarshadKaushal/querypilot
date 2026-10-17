import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type {
  UsageCounterAttributes,
  UsageCounterCreationAttributes,
} from '../types/usage-counter.types';
import { User } from './user.model';

// The primary key is (user_id, day), so the model has no id column.
/** One user's usage on one UTC day (questions, rows, tokens), for the usage page. The quota itself is counted in Redis. */
@Table({ tableName: 'usage_counters', underscored: true, timestamps: false })
export class UsageCounter
  extends Model<UsageCounterAttributes, UsageCounterCreationAttributes>
  implements UsageCounterAttributes
{
  @PrimaryKey
  @ForeignKey(() => User)
  @Column(DataType.TEXT)
  userId!: string;

  @PrimaryKey
  @Column(DataType.DATEONLY)
  day!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  questions!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  rowsReturned!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  inputTokens!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  outputTokens!: number;

  @BelongsTo(() => User)
  user?: User;
}
