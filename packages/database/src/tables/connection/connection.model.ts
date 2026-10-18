import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import type { ConnectionStatus } from './connection-status.enum';
import type { SslMode } from './ssl-mode.enum';
import type {
  ConnectionAttributes,
  ConnectionCreationAttributes,
} from './connection.types';
import { User } from '../user/user.model';

/** A customer database connection. The login is stored only as ciphertext (see @ayd/crypto). */
@Table({ tableName: 'connections', underscored: true, timestamps: true })
export class Connection
  extends Model<ConnectionAttributes, ConnectionCreationAttributes>
  implements ConnectionAttributes
{
  @PrimaryKey
  @Column(DataType.TEXT)
  override id!: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.TEXT, allowNull: false })
  userId!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  label!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  host!: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  port!: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  databaseName!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  sslMode!: SslMode;

  @Column({ type: DataType.TEXT, allowNull: false })
  usernameCiphertext!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  usernameIv!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  usernameTag!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  passwordCiphertext!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  passwordIv!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  passwordTag!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  encryptedDataKey!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  dataKeyIv!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  dataKeyTag!: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  keyVersion!: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  status!: ConnectionStatus;

  @Column({ type: DataType.DATE(3), allowNull: true })
  lastTestedAt!: Date | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  sendSampleRowsToLlm!: boolean;

  @CreatedAt
  @Column(DataType.DATE(3))
  override createdAt!: Date;

  // Sequelize sets this on every save, as Prisma's @updatedAt did.
  @UpdatedAt
  @Column(DataType.DATE(3))
  override updatedAt!: Date;

  @BelongsTo(() => User)
  user?: User;
}
