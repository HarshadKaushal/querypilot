import { Module } from '@nestjs/common';
import { UserDatabaseModule } from '../user-database/user-database.module';
import { CONNECTION_REPOSITORY } from './connection.repository';
import {
  ADDRESS_RESOLVER,
  ConnectionService,
  DnsAddressResolver,
} from './connection.service';
import { SequelizeConnectionRepository } from './sequelize-connection.repository';

/** Connection storage, credential sealing, and target resolution, without HTTP routes. */
@Module({
  imports: [UserDatabaseModule],
  providers: [
    ConnectionService,
    SequelizeConnectionRepository,
    { provide: CONNECTION_REPOSITORY, useExisting: SequelizeConnectionRepository },
    { provide: ADDRESS_RESOLVER, useClass: DnsAddressResolver },
  ],
  exports: [ConnectionService],
})
export class ConnectionsCoreModule {}
