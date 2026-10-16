import type { HistoryEntry, HistoryPage } from '@ayd/core';
import { ApiProperty } from '@nestjs/swagger';

// What the history routes send back, for the API docs only. `implements` keeps each class
// in step with core's type.

/** One past question or SQL run. Never result rows: re-run to see rows again. */
export class HistoryEntryDto implements HistoryEntry {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  connectionId!: string;

  @ApiProperty({ enum: ['question', 'sql'] })
  kind!: 'question' | 'sql';

  @ApiProperty({ type: String, nullable: true, example: 'How many orders are open?' })
  question!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The SQL that ran, as the guard rewrote it. Null when nothing ran.',
  })
  sql!: string | null;

  @ApiProperty({ enum: ['answered', 'ambiguous', 'unanswerable', 'failed', 'cancelled'] })
  status!: 'answered' | 'ambiguous' | 'unanswerable' | 'failed' | 'cancelled';

  @ApiProperty({ type: String, nullable: true })
  errorCode!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  rowCount!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why the result was cut short: "rows" or "size".',
  })
  truncated!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  schemaVersion!: number | null;

  @ApiProperty({ description: 'True when the SQL came from the saved-query cache.' })
  cached!: boolean;

  @ApiProperty({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: [String] })
  models!: string[];

  @ApiProperty()
  inputTokens!: number;

  @ApiProperty()
  outputTokens!: number;

  @ApiProperty()
  llmMs!: number;

  @ApiProperty()
  queryMs!: number;

  @ApiProperty()
  totalMs!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  finishedAt!: string;
}

export class HistoryPageDto implements HistoryPage {
  @ApiProperty({ type: [HistoryEntryDto] })
  entries!: HistoryEntryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass back as `cursor` for the next, older page. Null on the last page.',
  })
  nextCursor!: string | null;
}
