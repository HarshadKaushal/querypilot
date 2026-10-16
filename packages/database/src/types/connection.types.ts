import type { Optional } from 'sequelize';
import type { ConnectionStatus } from '../enums/connection-status.enum';
import type { SslMode } from '../enums/ssl-mode.enum';

/**
 * A connections row: where a customer database is, and its login sealed with envelope
 * encryption (the *_ciphertext, *_iv, and *_tag columns, see ADR 0007).
 */
export interface ConnectionAttributes {
  id: string;
  userId: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: SslMode;
  usernameCiphertext: string;
  usernameIv: string;
  usernameTag: string;
  passwordCiphertext: string;
  passwordIv: string;
  passwordTag: string;
  encryptedDataKey: string;
  dataKeyIv: string;
  dataKeyTag: string;
  keyVersion: number;
  status: ConnectionStatus;
  lastTestedAt: Date | null;
  sendSampleRowsToLlm: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type ConnectionCreationAttributes = Optional<
  ConnectionAttributes,
  'lastTestedAt' | 'sendSampleRowsToLlm' | 'createdAt' | 'updatedAt'
>;
