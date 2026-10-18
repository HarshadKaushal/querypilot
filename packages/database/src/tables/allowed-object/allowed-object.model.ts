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
  AllowedObjectAttributes,
  AllowedObjectCreationAttributes,
} from './allowed-object.types';
import { Connection } from '../connection/connection.model';

/** One row of the allowlist: a table or column of a snapshot, and whether the AI may see it. */
@Table({
  tableName: 'allowed_objects',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class AllowedObject
  extends Model<AllowedObjectAttributes, AllowedObjectCreationAttributes>
  implements AllowedObjectAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => Connection)
  @Column({ type: DataType.TEXT, allowNull: false })
  connectionId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  schemaName!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  tableName!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  columnName!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  description!: string | null;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  @BelongsTo(() => Connection)
  connection?: Connection;
}
