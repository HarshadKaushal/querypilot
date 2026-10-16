import { MAX_SQL_LENGTH } from '@ayd/sql-guard';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** A question is a sentence or two; this leaves room without inviting pasted documents. */
export const MAX_QUESTION_LENGTH = 2000;

const SQL_REQUIRED = 'Send the SQL to run as a non-empty "sql" string.';
const QUESTION_REQUIRED = 'Send the question as a non-empty "question" string.';

// Decorators run from the bottom up, and the pipe stops at a field's first failure, so the
// most basic check (is it a string?) sits closest to the property. Otherwise a number would
// be reported as "too long".

/** POST /v1/connections/:id/queries */
export class RunSqlDto {
  @ApiProperty({ maxLength: MAX_SQL_LENGTH, example: 'SELECT count(*) FROM orders' })
  @MaxLength(MAX_SQL_LENGTH, {
    message: `The SQL is longer than ${MAX_SQL_LENGTH} characters.`,
  })
  // At least one character that is not whitespace. The SQL is sent on as written.
  @Matches(/\S/, { message: SQL_REQUIRED })
  @IsString({ message: SQL_REQUIRED })
  sql!: string;
}

/** POST /v1/connections/:id/questions */
export class AskQuestionDto {
  @ApiProperty({
    maxLength: MAX_QUESTION_LENGTH,
    example: 'How many orders were placed each month?',
    description: 'Surrounding spaces are removed before it is checked and queued.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(MAX_QUESTION_LENGTH, {
    message: `The question is longer than ${MAX_QUESTION_LENGTH} characters.`,
  })
  @IsNotEmpty({ message: QUESTION_REQUIRED })
  @IsString({ message: QUESTION_REQUIRED })
  question!: string;
}
