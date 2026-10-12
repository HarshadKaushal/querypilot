import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

const SETUP_SQL = [
  "CREATE ROLE ayd_ro LOGIN PASSWORD '<choose-a-password>';",
  'GRANT CONNECT ON DATABASE <database> TO ayd_ro;',
  'GRANT USAGE ON SCHEMA public TO ayd_ro;',
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ayd_ro;',
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ayd_ro;',
].join('\n');

@Controller('v1/meta')
export class MetaController {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  @Get('egress')
  egress(): { egressIp: string; setupSql: string; firewall: string } {
    return {
      egressIp: this.env.EGRESS_IP,
      setupSql: SETUP_SQL,
      firewall:
        'Allow inbound database traffic only from the egress IP. Do not open the port to the whole internet.',
    };
  }
}
