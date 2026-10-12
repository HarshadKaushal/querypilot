import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const report = await this.health.ready();
    response.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
