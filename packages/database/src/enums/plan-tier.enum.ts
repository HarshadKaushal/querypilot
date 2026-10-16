/** A user's plan (users.plan_tier). Every account is on the free plan for now. */
export const PlanTier = {
  Free: 'free',
} as const;

export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];
