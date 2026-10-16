import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * POST /v1/connections/:id/sql/check. Only the type is checked here: empty or overlong SQL
 * is a normal answer from the guard (allowed: false with a reason), not a 400.
 */
export class CheckSqlDto {
  @ApiProperty({ example: 'SELECT * FROM orders' })
  @IsString()
  sql!: string;
}
