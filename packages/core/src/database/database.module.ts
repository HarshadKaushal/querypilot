import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { sequelizeOptions } from '@ayd/database';
import { APP_ENV, type CoreEnv } from '../config/env';
import { DatabaseService } from './database.service';

/**
 * The application database connection, shared by every module in the API and the worker.
 * Sequelize connects on the first query, so the app starts even when the database is down
 * (the readiness check reports it).
 */
@Global()
@Module({
  imports: [
    SequelizeModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: CoreEnv) => ({
        uri: env.DATABASE_URL,
        ...sequelizeOptions(),
        // Only the migrations in packages/database create or change tables. Never sync().
        autoLoadModels: false,
        synchronize: false,
      }),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
