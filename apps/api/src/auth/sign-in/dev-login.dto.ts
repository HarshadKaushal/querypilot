import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * POST /v1/auth/dev/login. Both fields are optional; AuthService fills in the defaults and
 * checks the email's form and the lengths.
 */
export class DevLoginDto {
  @ApiPropertyOptional({
    example: 'swagger@localhost',
    description: 'Default: dev@localhost',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    example: 'Swagger tester',
    description: 'Default: Local developer',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
