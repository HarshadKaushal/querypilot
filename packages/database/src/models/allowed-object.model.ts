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
} from '../types/allowed-object.types';
import { Connection } from './connection.model';

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
