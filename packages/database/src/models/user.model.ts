import {
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { PlanTier } from '../enums/plan-tier.enum';
import type { UserAttributes, UserCreationAttributes } from '../types/user.types';

// The migrations own the tables. These models only describe them for queries, so indexes and
// constraints are not repeated here. Every @Column names its type, because tsx (the worker's
// dev runner) does not emit the metadata sequelize-typescript would otherwise read it from.

/** A person who signed in with Google (or dev login). Deleting one deletes everything they own. */
@Table({ tableName: 'users', underscored: true, timestamps: true, updatedAt: false })
export class User
  extends Model<UserAttributes, UserCreationAttributes>
  implements UserAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  googleSubject!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  email!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  name!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  avatarUrl!: string | null;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: PlanTier.Free })
  planTier!: PlanTier;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @Column({ type: DataType.DATE(3), allowNull: false })
  lastLoginAt!: Date;
}
