import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';

// Shape only. SchemaService checks the rest against the latest snapshot: that every table
// and column exists, that none is listed twice, and the description rules.

export class AllowlistColumnDto {
  @ApiProperty({ example: 'created_at' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Shown to the model.',
  })
  @IsOptional()
  @IsString()
  description?: string | null;
}

export class AllowlistTableDto {
  @ApiProperty({ example: 'public' })
  @IsString()
  schema!: string;

  @ApiProperty({ example: 'orders' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'One row per order',
    description: 'Shown to the model.',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    type: [AllowlistColumnDto],
    description: 'The columns the AI may see. Columns not listed are hidden.',
  })
  // Bottom up: is it an array, then is each item a valid column (see jobs.dto.ts).
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AllowlistColumnDto)
  @IsArray()
  columns?: AllowlistColumnDto[];
}

/**
 * PUT /v1/connections/:id/allowlist: every table the AI may see; a table not listed is
 * hidden. `version` is the schema version from GET allowlist; a newer snapshot gives 409.
 */
export class UpdateAllowlistDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  version!: number;

  @ApiProperty({ type: [AllowlistTableDto] })
  @ValidateNested({ each: true })
  @Type(() => AllowlistTableDto)
  @IsArray()
  tables!: AllowlistTableDto[];
}
