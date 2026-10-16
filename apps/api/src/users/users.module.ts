import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
})
export class UsersModule {}
