import { Module } from '@nestjs/common';
import { UserDatabaseProbe } from './user-database.probe';

@Module({
  providers: [UserDatabaseProbe],
  exports: [UserDatabaseProbe],
})
export class ExecutorModule {}
