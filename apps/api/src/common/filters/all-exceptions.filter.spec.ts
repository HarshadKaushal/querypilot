import { Controller, Get, HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AppException } from '@ayd/core';
import { AllExceptionsFilter } from './all-exceptions.filter';

@Controller('probe')
class ProbeController {
  @Get('missing')
  missing(): void {
    throw new HttpException('database password=hidden', 404);
  }

  @Get('invalid')
  invalid(): void {
    throw new AppException('VALIDATION_ERROR', 'Port must be a number.', 400);
  }

  @Get('boom')
  boom(): void {
    throw new Error('connection string postgresql://user:secret@db/app');
  }
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: { id?: string }, _res: unknown, next: () => void) => {
      req.id = 'req-test-01';
      next();
    });
    app.useGlobalFilters(
      new AllExceptionsFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('hides framework detail on not found', async () => {
    const response = await request(app.getHttpServer()).get('/probe/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'That resource was not found.',
        requestId: 'req-test-01',
      },
    });
  });

  it('returns the application message for a known error', async () => {
    const response = await request(app.getHttpServer()).get('/probe/invalid');
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Port must be a number.',
      requestId: 'req-test-01',
    });
  });

  it('does not return raw exception text', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('Something went wrong. Try again.');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
