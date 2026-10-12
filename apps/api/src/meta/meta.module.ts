import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { MetaController } from './meta.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [MetaController],
})
export class MetaModule {}
