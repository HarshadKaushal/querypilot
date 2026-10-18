import { Module } from '@nestjs/common';
import { QUERY_HISTORY } from './query-history.repository';
import { SequelizeQueryHistory } from './sequelize-query-history.repository';

/** Query history storage: written by the worker, read and deleted by the API. */
@Module({
  providers: [{ provide: QUERY_HISTORY, useClass: SequelizeQueryHistory }],
  exports: [QUERY_HISTORY],
})
export class HistoryModule {}
