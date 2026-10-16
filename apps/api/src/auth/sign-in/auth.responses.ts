import { ApiProperty } from '@nestjs/swagger';
import { PublicUserDto } from '../user';

// What the auth routes send back, for the API docs only: nothing checks responses at run
// time. Request bodies are in *.dto.ts files.

/** Dev login and refresh. The refresh token is set as a cookie, never sent in the body. */
export class SessionDto {
  @ApiProperty({ description: 'Send as "Authorization: Bearer <accessToken>".' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Seconds until the access token expires.' })
  expiresIn!: number;

  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;
}
