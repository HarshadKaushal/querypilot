import { ApiProperty } from '@nestjs/swagger';

// What GET /v1/usage sends back, for the API docs. The controller declares this as its
// return type, so the compiler checks the object it builds against this class.

export class UsedOfLimitDto {
  @ApiProperty({ example: 3 })
  used!: number;

  @ApiProperty({ example: 50 })
  limit!: number;
}

export class TokenCountsDto {
  @ApiProperty()
  input!: number;

  @ApiProperty()
  output!: number;
}

/** Today's usage against the limits. The day is UTC. */
export class UsageTodayDto {
  @ApiProperty({ example: '2026-10-16', description: 'The UTC day.' })
  day!: string;

  @ApiProperty({ example: 'free' })
  plan!: string;

  @ApiProperty({
    type: UsedOfLimitDto,
    description: 'Questions submitted today, counted as the quota counts them.',
  })
  questions!: UsedOfLimitDto;

  @ApiProperty({ example: 10 })
  submissionsPerMinute!: number;

  @ApiProperty({ description: 'Questions that finished today.' })
  finishedQuestions!: number;

  @ApiProperty()
  rowsReturned!: number;

  @ApiProperty({ type: TokenCountsDto })
  tokens!: TokenCountsDto;
}
