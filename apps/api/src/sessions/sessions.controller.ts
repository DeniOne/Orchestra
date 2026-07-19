import { Body, Controller, Get, Param, Post, HttpCode, HttpStatus, NotFoundException } from '@nestjs/common';
import { GsdEngineService } from '../gsd/gsd-engine.service.js';
import { CreateSessionDto } from './dto/create-session.dto.js';
import { OverrideGateDto } from './dto/override-gate.dto.js';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly gsd: GsdEngineService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateSessionDto) {
    return this.gsd.startSession(dto.name, dto.projectId);
  }

  @Get()
  async listSessions() {
    return this.gsd.listSessions();
  }

  @Get(':id')
  async getSession(@Param('id') id: string) {
    const session = await this.gsd.getSession(id);
    if (!session) throw new NotFoundException(`Session not found: ${id}`);
    return session;
  }

  @Post(':id/rounds')
  @HttpCode(HttpStatus.CREATED)
  async startRound(@Param('id') id: string) {
    try {
      return await this.gsd.startRound(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  async advancePhase(@Param('id') id: string) {
    try {
      return await this.gsd.advancePhase(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approveTransition(@Param('id') id: string) {
    try {
      return await this.gsd.approveTransition(id);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Post(':id/override')
  @HttpCode(HttpStatus.OK)
  async overrideGate(@Param('id') id: string, @Body() dto: OverrideGateDto) {
    try {
      return await this.gsd.overrideGate(id, dto.reason);
    } catch (e) {
      throw this.mapEngineError(e);
    }
  }

  @Get(':id/rounds')
  async listRounds(@Param('id') id: string) {
    const session = await this.gsd.getSession(id);
    if (!session) throw new NotFoundException(`Session not found: ${id}`);
    return this.gsd.listRounds(id);
  }

  private mapEngineError(e: unknown) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('Unknown session')) return new NotFoundException(msg);
    return e;
  }
}
