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
  AuditLogAttributes,
  AuditLogCreationAttributes,
} from '../types/audit-log.types';
import { User } from './user.model';

@Table({ tableName: 'audit_log', underscored: true, timestamps: true, updatedAt: false })
export class AuditLog
  extends Model<AuditLogAttributes, AuditLogCreationAttributes>
  implements AuditLogAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.TEXT, allowNull: true })
  userId!: string | null;

  @Column({ type: DataType.TEXT, allowNull: false })
  eventType!: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  metadata!: Record<string, string>;

  @Column({ type: DataType.TEXT, allowNull: true })
  ip!: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @BelongsTo(() => User)
  user?: User;
}
