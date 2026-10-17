import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthReportDto, LiveDto } from './health.responses';
import { HealthService } from './health.service';

/** GET /health/live and /health/ready. Public: no sign-in, and outside the /v1 prefix. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Is the process up? (no dependencies checked)' })
  @ApiResponse({ status: 200, description: 'Up.', type: LiveDto })
  @HttpCode(200)
  live(): LiveDto {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Can it serve requests? Checks the database and Redis' })
  @ApiResponse({
    status: 200,
    description: 'Ready, with each check.',
    type: HealthReportDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Not ready: the same report, with the failing check down.',
    type: HealthReportDto,
  })
  async ready(@Res({ passthrough: true }) response: Response) {
    const report = await this.health.ready();
    response.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
