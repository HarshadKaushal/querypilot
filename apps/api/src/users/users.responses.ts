import { ApiProperty } from '@nestjs/swagger';
import { PublicUserDto } from '../auth';

/** GET /v1/users/me, for the API docs. The controller declares it as its return type. */
export class CurrentUserDto {
  @ApiProperty({ type: PublicUserDto })
  user!: PublicUserDto;
}
