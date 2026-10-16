import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// What POST .../sql/check sends back, for the API docs only. SqlCheckResult is a union of
// two shapes, so this is one class whose fields say which case they appear in.

const IF_ALLOWED = 'Only when allowed is true.';
const IF_REFUSED = 'Only when allowed is false.';

export class SqlCheckResultDto {
  @ApiProperty()
  allowed!: boolean;

  @ApiProperty({ description: 'The schema version the SQL was checked against.' })
  schemaVersion!: number;

  @ApiPropertyOptional({
    description: `The SQL that would run: names qualified, * expanded, LIMIT capped. ${IF_ALLOWED}`,
  })
  sql?: string;

  @ApiPropertyOptional({
    description: `True when a LIMIT was added or lowered. ${IF_ALLOWED}`,
  })
  limitApplied?: boolean;

  @ApiPropertyOptional({
    description: `The most rows the query may return. ${IF_ALLOWED}`,
  })
  rowCap?: number;

  @ApiPropertyOptional({
    example: 'table_not_allowed',
    description: `Why the guard refused, as a stable code. ${IF_REFUSED}`,
  })
  code?: string;

  @ApiPropertyOptional({ description: `The same, in words. ${IF_REFUSED}` })
  reason?: string;
}
