import { Module } from '@nestjs/common';
import { GsdModule } from '../gsd/gsd.module.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  imports: [GsdModule],
  controllers: [SessionsController],
})
export class SessionsModule {}
