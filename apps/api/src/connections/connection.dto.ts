import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * POST /v1/connections. Only the types are checked here. ConnectionService checks the rules
 * (lengths, port range, SSL mode), because the worker relies on them too, and it answers
 * SSL_REQUIRED for a plaintext mode.
 */
export class CreateConnectionDto {
  @ApiProperty({ example: 'Sample shop', maxLength: 80 })
  @IsString()
  label!: string;

  @ApiProperty({ example: '127.0.0.1', maxLength: 253 })
  @IsString()
  host!: string;

  @ApiProperty({ example: 5433, minimum: 1, maximum: 65535 })
  @IsInt()
  port!: number;

  @ApiProperty({ example: 'sample', maxLength: 63 })
  @IsString()
  databaseName!: string;

  @ApiProperty({ example: 'sample_ro', description: 'A read-only login.' })
  @IsString()
  username!: string;

  // The local sample database's published read-only login (README), not a secret.
  @ApiProperty({
    example: 'sample_ro_password',
    description: 'Encrypted at rest, never returned.',
  })
  @IsString()
  password!: string;

  @ApiProperty({
    enum: ['require', 'verify-full'],
    example: 'require',
    description: 'Plaintext modes are refused (SSL_REQUIRED).',
  })
  @IsString()
  sslMode!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Whether result rows may be sent to the model for summaries.',
  })
  @IsOptional()
  @IsBoolean()
  sendSampleRowsToLlm?: boolean;
}

/**
 * PATCH /v1/connections/:id: any of the same fields, each optional. A field sent as null
 * is treated as not sent, because ConnectionService keeps the saved value for null too.
 */
export class UpdateConnectionDto extends PartialType(CreateConnectionDto) {}
