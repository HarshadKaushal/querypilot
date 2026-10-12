import type { SealedCredentials } from '@ayd/crypto';

export interface PublicConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: string | null;
  sendSampleRowsToLlm: boolean;
  keyVersion: number;
}

export interface StoredConnection extends PublicConnection, SealedCredentials {
  userId: string;
}

export interface NewConnection extends SealedCredentials {
  id: string;
  userId: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: Date;
  sendSampleRowsToLlm: boolean;
}

export interface ConnectionRepository {
  insert(input: NewConnection): Promise<PublicConnection>;
  list(userId: string): Promise<PublicConnection[]>;
  findOwned(userId: string, id: string): Promise<StoredConnection | null>;
  update(
    userId: string,
    id: string,
    patch: Partial<NewConnection> & { status?: string; lastTestedAt?: Date | null },
  ): Promise<PublicConnection | null>;
  delete(userId: string, id: string): Promise<boolean>;
  writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void>;
}

export const CONNECTION_REPOSITORY = Symbol('CONNECTION_REPOSITORY');
