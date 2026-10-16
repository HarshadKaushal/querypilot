import type { DependencyCheck, HealthReport } from '@ayd/shared';
import { ApiProperty } from '@nestjs/swagger';

// What the health routes send back, for the API docs only. `implements` keeps each class
// in step with the shared type.

export class LiveDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

export class DependencyCheckDto implements DependencyCheck {
  @ApiProperty({ enum: ['up', 'down'] })
  status!: 'up' | 'down';

  @ApiProperty()
  latencyMs!: number;
}

export class HealthChecksDto {
  @ApiProperty({ type: DependencyCheckDto })
  appDatabase!: DependencyCheckDto;

  @ApiProperty({ type: DependencyCheckDto })
  redis!: DependencyCheckDto;
}

export class HealthReportDto implements HealthReport {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
