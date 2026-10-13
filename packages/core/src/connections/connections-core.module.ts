import { Module } from '@nestjs/common';
import { UserDatabaseModule } from '../user-database/user-database.module';
import { CONNECTION_REPOSITORY } from './connection.repository';
import {
  ADDRESS_RESOLVER,
  ConnectionService,
  DnsAddressResolver,
} from './connection.service';
import { PrismaConnectionRepository } from './prisma-connection.repository';

/** Connection storage, credential sealing, and target resolution, without HTTP routes. */
@Module({
  imports: [UserDatabaseModule],
  providers: [
    ConnectionService,
    PrismaConnectionRepository,
    { provide: CONNECTION_REPOSITORY, useExisting: PrismaConnectionRepository },
    { provide: ADDRESS_RESOLVER, useClass: DnsAddressResolver },
  ],
  exports: [ConnectionService],
})
export class ConnectionsCoreModule {}
