import type { Optional } from 'sequelize';

/** A refresh_tokens row. Only the token's hash is stored, never the token. */
export interface RefreshTokenAttributes {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  deviceInfo: string | null;
  createdAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type RefreshTokenCreationAttributes = Optional<
  RefreshTokenAttributes,
  'revokedAt' | 'replacedById' | 'deviceInfo' | 'createdAt'
>;
