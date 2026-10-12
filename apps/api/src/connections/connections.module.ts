import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserDatabaseModule } from '../user-database/user-database.module';
import {
  ADDRESS_RESOLVER,
  ConnectionService,
  DnsAddressResolver,
} from './connection.service';
import { CONNECTION_REPOSITORY } from './connection.repository';
import { ConnectionsController } from './connections.controller';
import { PrismaConnectionRepository } from './prisma-connection.repository';

@Module({
  imports: [AuthModule, UserDatabaseModule],
  controllers: [ConnectionsController],
  providers: [
    ConnectionService,
    PrismaConnectionRepository,
    { provide: CONNECTION_REPOSITORY, useExisting: PrismaConnectionRepository },
    { provide: ADDRESS_RESOLVER, useClass: DnsAddressResolver },
  ],
  exports: [ConnectionService],
})
export class ConnectionsModule {}
