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
  RefreshTokenAttributes,
  RefreshTokenCreationAttributes,
} from '../types/refresh-token.types';
import { User } from './user.model';

@Table({
  tableName: 'refresh_tokens',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class RefreshToken
  extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes>
  implements RefreshTokenAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.TEXT, allowNull: false })
  userId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  familyId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  tokenHash!: string;

  @Column({ type: DataType.DATE(3), allowNull: false })
  expiresAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: true })
  revokedAt!: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  replacedById!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  deviceInfo!: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @BelongsTo(() => User)
  user?: User;
}
