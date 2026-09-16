import 'reflect-metadata';
import { Controller, Get, Module, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Response } from 'express';
import type { Registry } from '@prometheus-io/client';

export async function healthServer(
  port: number,
  ready: () => Promise<boolean>,
  registry: Registry,
) {
  @Controller()
  class HealthController {
    @Get('live') live() {
      return { status: 'alive' };
    }
    @Get('ready') async readiness(@Res() res: Response) {
      const ok = await ready();
      res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'unavailable' });
    }
    @Get('metrics') async metrics(@Res() res: Response) {
      res.type(registry.contentType).send(await registry.metrics());
    }
  }
  @Module({ controllers: [HealthController] })
  class HealthModule {}
  const app = await NestFactory.create(HealthModule, { logger: false });
  await app.listen(port, '0.0.0.0');
  return app;
}
