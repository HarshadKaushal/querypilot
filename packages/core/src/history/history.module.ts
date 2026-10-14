import { Module } from '@nestjs/common';
import { PrismaQueryHistory, QUERY_HISTORY } from './query-history';

/** Query history storage: written by the worker, read and deleted by the API. */
@Module({
  providers: [{ provide: QUERY_HISTORY, useClass: PrismaQueryHistory }],
  exports: [QUERY_HISTORY],
})
export class HistoryModule {}
