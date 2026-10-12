import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { EgressController } from './egress.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [EgressController],
})
export class EgressModule {}
