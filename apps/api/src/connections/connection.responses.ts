import type { PublicConnection } from '@ayd/core';
import { ApiProperty } from '@nestjs/swagger';

// What the connection routes send back, for the API docs only. Request bodies are in
// connection.dto.ts.

/** A connection as its owner sees it: never the username or password. */
export class ConnectionDto implements PublicConnection {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Sample shop' })
  label!: string;

  @ApiProperty({ example: '127.0.0.1' })
  host!: string;

  @ApiProperty({ example: 5433 })
  port!: number;

  @ApiProperty({ example: 'sample' })
  databaseName!: string;

  @ApiProperty({ enum: ['require', 'verify-full'] })
  sslMode!: string;

  @ApiProperty({
    enum: ['active', 'failing'],
    description: 'From the last read-only check.',
  })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastTestedAt!: string | null;

  @ApiProperty()
  sendSampleRowsToLlm!: boolean;

  @ApiProperty({ description: 'Which master key sealed the credentials.' })
  keyVersion!: number;
}
