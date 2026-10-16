import type { Optional } from 'sequelize';
import type { PlanTier } from '../enums/plan-tier.enum';

/** A users row. One per Google account. */
export interface UserAttributes {
  id: string;
  googleSubject: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  planTier: PlanTier;
  createdAt: Date;
  lastLoginAt: Date;
}

/** What creating a row needs. Columns that may be null or have a default can be left out. */
export type UserCreationAttributes = Optional<
  UserAttributes,
  'avatarUrl' | 'planTier' | 'createdAt'
>;
