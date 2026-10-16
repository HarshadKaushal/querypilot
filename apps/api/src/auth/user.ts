/** The signed-in user as the API shows it: what a controller gets from @CurrentUser(). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  planTier: string;
}

/** Picks the fields a client may see from a stored user. */
export function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    planTier: user.planTier,
  };
}
