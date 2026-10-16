import { ApiProperty } from '@nestjs/swagger';

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

/**
 * PublicUser for the API docs. `implements` makes the compiler check that this class has
 * every field of the interface, so the docs cannot drift from the real shape.
 */
export class PublicUserDto implements PublicUser {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'dev@localhost' })
  email!: string;

  @ApiProperty({ example: 'Local developer' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ example: 'free' })
  planTier!: string;
}
