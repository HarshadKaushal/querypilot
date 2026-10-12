import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV } from '../config/app-config.module';
import type { AppEnv } from '../config/env';

// Shown to the customer, who runs it in their own database as an admin. The platform never
// runs it. The placeholders in <angle brackets> are theirs to fill in.
export const SETUP_SQL = [
  "CREATE ROLE ayd_ro LOGIN PASSWORD '<choose-a-password>';",
  'GRANT CONNECT ON DATABASE <database> TO ayd_ro;',
  'GRANT USAGE ON SCHEMA public TO ayd_ro;',
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ayd_ro;',
  '-- Make tables created later readable too. Default privileges only cover tables created',
  '-- by the role named here, so name the role your application creates tables as.',
  'ALTER DEFAULT PRIVILEGES FOR ROLE <table_owner_role> IN SCHEMA public GRANT SELECT ON TABLES TO ayd_ro;',
  '-- Repeat for every other schema the assistant should read, for example:',
  '--   GRANT USAGE ON SCHEMA <schema> TO ayd_ro;',
  '--   GRANT SELECT ON ALL TABLES IN SCHEMA <schema> TO ayd_ro;',
  '--   ALTER DEFAULT PRIVILEGES FOR ROLE <table_owner_role> IN SCHEMA <schema> GRANT SELECT ON TABLES TO ayd_ro;',
  '-- PostgreSQL 14 and earlier let every role create tables in the public schema.',
  '-- This platform refuses a role that can create objects, so remove that default.',
  '-- If another role creates tables in public, grant it CREATE first:',
  '--   GRANT CREATE ON SCHEMA public TO <that_role>;',
  'REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
].join('\n');

@Controller('v1/meta')
export class EgressController {
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
