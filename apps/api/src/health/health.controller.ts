import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Is the process up? (no dependencies checked)' })
  @ApiResponse({ status: 200, description: 'status: ok.' })
  @HttpCode(200)
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Can it serve requests? Checks the database and Redis' })
  @ApiResponse({ status: 200, description: 'Ready, with each check.' })
  @ApiResponse({ status: 503, description: 'Not ready, with the failing check.' })
  async ready(@Res({ passthrough: true }) response: Response) {
    const report = await this.health.ready();
    response.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
