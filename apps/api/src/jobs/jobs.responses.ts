import {
  JOB_KINDS,
  type AskUsage,
  type ChartSpec,
  type JobError,
  type JobKind,
  type JobStage,
  type JobState,
  type JobView,
  type LlmAttempt,
  type NumericFact,
  type QueryJobResult,
  type ResultFacts,
} from '@ayd/core';
import { ERROR_CODES, type ErrorCode } from '@ayd/shared';
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { ConnectionDto } from '../connections/connection.responses';
import { RefreshSummaryDto } from '../schema/schema.responses';

// What the job routes send back, for the API docs only. Request bodies are in jobs.dto.ts.
// Classes that `implements` a core type are checked against it by the compiler. AskResultDto
// cannot be: AskResult is a union of three shapes, so it is one class whose fields say
// which status they appear with.

const JOB_STATES: JobState[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const JOB_STAGES: JobStage[] = [
  'loading_schema',
  'generating_sql',
  'summarizing',
  'checking_sql',
  'connecting',
  'running_query',
  'checking_access',
  'reading_schema',
];

/** One array per row, in column order; values keep their JSON types. */
const ROWS = { type: 'array', items: { type: 'array', items: {} } } as const;

export class JobErrorDto implements JobError {
  @ApiProperty({ enum: [...ERROR_CODES], example: 'CONNECTION_FAILED' })
  code!: ErrorCode;

  @ApiProperty({ description: 'Safe to show to the user.' })
  message!: string;

  @ApiProperty({
    description: 'True when trying again, perhaps with corrected input, could succeed.',
  })
  retryable!: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  detail?: Record<string, string>;
}

export class ResultColumnDto {
  @ApiProperty({ example: 'month' })
  name!: string;

  @ApiProperty({
    description: "PostgreSQL's type id for the column (for example 1700 is numeric).",
  })
  dataTypeId!: number;
}

/** The result of a query.run job. */
export class QueryJobResultDto implements QueryJobResult {
  @ApiProperty({ description: 'The SQL that ran, as the guard rewrote it.' })
  sql!: string;

  @ApiProperty()
  schemaVersion!: number;

  @ApiProperty({ type: [ResultColumnDto] })
  columns!: ResultColumnDto[];

  @ApiProperty(ROWS)
  rows!: unknown[][];

  @ApiProperty()
  rowCount!: number;

  @ApiProperty({
    oneOf: [
      { type: 'boolean', enum: [false] },
      { type: 'string', enum: ['rows', 'size'] },
    ],
    description: 'false, or why the result was cut short: the row cap or the size cap.',
  })
  truncated!: false | 'rows' | 'size';

  @ApiProperty()
  durationMs!: number;
}

export class ChartSpecDto implements ChartSpec {
  @ApiProperty({ enum: ['stat', 'line', 'bar', 'pie', 'table'] })
  type!: 'stat' | 'line' | 'bar' | 'pie' | 'table';

  @ApiPropertyOptional({
    description: 'The column on the x axis, or the label of a stat card.',
  })
  x?: string;

  @ApiPropertyOptional({ type: [String], description: 'The value columns.' })
  y?: string[];

  @ApiPropertyOptional({ ...ROWS, description: 'The rows to plot, in column order.' })
  points?: unknown[][];

  @ApiPropertyOptional({
    description: 'True when points is a thinned subset of the rows.',
  })
  downsampled?: boolean;
}

export class NumericFactDto implements NumericFact {
  @ApiProperty()
  column!: string;

  @ApiProperty()
  min!: number;

  @ApiProperty()
  max!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  average!: number;
}

/** Numbers the server computed from the rows; every number in a summary must match them. */
export class ResultFactsDto implements ResultFacts {
  @ApiProperty()
  rowCount!: number;

  @ApiProperty({
    oneOf: [
      { type: 'boolean', enum: [false] },
      { type: 'string', enum: ['rows', 'size'] },
    ],
  })
  truncated!: false | 'rows' | 'size';

  @ApiProperty({ type: [String] })
  columns!: string[];

  @ApiProperty({ type: [NumericFactDto] })
  numeric!: NumericFactDto[];

  @ApiProperty({
    description:
      'The largest rows for one label and one number, at most 5. Empty unless the connection allows rows to reach the model.',
    example: [{ label: 'North', value: 1200 }],
  })
  top!: Array<{ label: string; value: number }>;
}

export class LlmAttemptDto implements LlmAttempt {
  @ApiProperty({ example: 'gemini' })
  provider!: string;

  @ApiProperty({ example: 'gemini-3.8-flash' })
  model!: string;

  @ApiProperty({
    enum: [
      'ok',
      'rate_limited',
      'unavailable',
      'bad_output',
      'misconfigured',
      'cancelled',
    ],
    description: '"ok", or why the attempt failed.',
  })
  outcome!: LlmAttempt['outcome'];

  @ApiProperty()
  latencyMs!: number;

  @ApiProperty()
  inputTokens!: number;

  @ApiProperty()
  outputTokens!: number;
}

export class AskUsageDto implements AskUsage {
  @ApiProperty()
  llmCalls!: number;

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

  @ApiProperty({ type: [String] })
  models!: string[];

  @ApiProperty({
    description: 'True when some call failed and another model or attempt was needed.',
  })
  fallbackUsed!: boolean;
}

export class AskSummaryDto {
  @ApiProperty()
  text!: string;

  @ApiProperty({
    enum: ['model', 'template'],
    description: 'template: the model summary failed the number check and was replaced.',
  })
  source!: 'model' | 'template';
}

const ANSWERED = 'Only when status is answered.';

/**
 * The result of a question.ask job. `status` says which fields are present: SQL, rows, and
 * a chart only when answered; a clarifying question when ambiguous; only an explanation
 * when unanswerable.
 */
export class AskResultDto {
  @ApiProperty({ enum: ['answered', 'ambiguous', 'unanswerable'] })
  status!: 'answered' | 'ambiguous' | 'unanswerable';

  @ApiProperty()
  question!: string;

  @ApiProperty()
  explanation!: string;

  @ApiProperty()
  schemaVersion!: number;

  @ApiProperty({ example: 'gemini-3.8-flash' })
  model!: string;

  @ApiProperty({ type: [LlmAttemptDto] })
  llmAttempts!: LlmAttemptDto[];

  @ApiProperty({
    description: 'True when the SQL came from the saved-query cache, not the model.',
  })
  cached!: boolean;

  @ApiProperty({ description: 'True when the schema was read again to answer.' })
  schemaRefreshed!: boolean;

  @ApiPropertyOptional({ type: AskUsageDto, description: 'Added once the job finishes.' })
  usage?: AskUsageDto;

  @ApiPropertyOptional({ type: [String], description: 'When answered or ambiguous.' })
  assumptions?: string[];

  @ApiPropertyOptional({ description: 'Only when status is ambiguous.' })
  clarifyingQuestion?: string;

  @ApiPropertyOptional({
    description: `The SQL that ran, as the guard rewrote it. ${ANSWERED}`,
  })
  sql?: string;

  @ApiPropertyOptional({ type: [ResultColumnDto], description: ANSWERED })
  columns?: ResultColumnDto[];

  @ApiPropertyOptional({ ...ROWS, description: ANSWERED })
  rows?: unknown[][];

  @ApiPropertyOptional({ description: ANSWERED })
  rowCount?: number;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'boolean', enum: [false] },
      { type: 'string', enum: ['rows', 'size'] },
    ],
    description: ANSWERED,
  })
  truncated?: false | 'rows' | 'size';

  @ApiPropertyOptional({ description: ANSWERED })
  durationMs?: number;

  @ApiPropertyOptional({ type: ChartSpecDto, description: ANSWERED })
  chart?: ChartSpecDto;

  @ApiPropertyOptional({ type: ResultFactsDto, description: ANSWERED })
  facts?: ResultFactsDto;

  @ApiPropertyOptional({ type: AskSummaryDto, description: ANSWERED })
  summary?: AskSummaryDto;
}

/** The result types a job can carry, for `@ApiExtraModels` on the controller. */
export const JOB_RESULT_MODELS = [
  QueryJobResultDto,
  AskResultDto,
  ConnectionDto,
  RefreshSummaryDto,
];

/** A job as its owner sees it. Routes that queue work answer 202 with one of these. */
export class JobViewDto implements JobView {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: [...JOB_KINDS] })
  kind!: JobKind;

  @ApiProperty({ enum: JOB_STATES })
  state!: JobState;

  @ApiPropertyOptional({ enum: JOB_STAGES, description: 'While running, once reported.' })
  stage?: JobStage;

  @ApiPropertyOptional({ description: 'True once the owner asked to cancel.' })
  cancelRequested?: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiPropertyOptional({
    description:
      'When succeeded. Depends on kind: query.run gives QueryJobResultDto, question.ask gives AskResultDto, connection.create, connection.update, and connection.test give ConnectionDto, and schema.refresh gives RefreshSummaryDto.',
    oneOf: JOB_RESULT_MODELS.map((model) => ({ $ref: getSchemaPath(model) })),
  })
  result?: unknown;

  @ApiPropertyOptional({ type: JobErrorDto, description: 'When failed or cancelled.' })
  error?: JobErrorDto;
}
