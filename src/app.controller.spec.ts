import { jest } from '@jest/globals';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './redis/redis.service';

describe('App health', () => {
  const setup = () => {
    const database = jest.fn<() => Promise<void>>().mockResolvedValue();
    const redis = jest.fn<() => Promise<void>>().mockResolvedValue();
    const service = new AppService(
      { ping: database } as unknown as PrismaService,
      { ping: redis } as unknown as RedisService,
    );
    return { database, redis, service, controller: new AppController(service) };
  };
  afterEach(() => jest.useRealTimers());
  it('checks liveness without querying dependencies', () => {
    const { controller, database, redis } = setup();
    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(database).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();
  });
  it('shares concurrent readiness checks', async () => {
    const { controller, database } = setup();
    const results = await Promise.all([
      controller.readiness(),
      controller.readiness(),
    ]);
    expect(results[0]).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    expect(database).toHaveBeenCalledTimes(1);
  });
  it('returns an unavailable response without exposing dependency errors', async () => {
    const { service, database } = setup();
    database.mockRejectedValueOnce(new Error('private connection details'));
    await expect(service.readiness()).rejects.toMatchObject({
      status: 503,
      response: { status: 'error', checks: { database: 'down', redis: 'up' } },
    });
    expect(await service.readiness()).toMatchObject({ status: 'ok' });
  });
  it('bounds a stalled probe without piling up duplicate dependency queries', async () => {
    jest.useFakeTimers();
    const { service, database } = setup();
    let finish!: () => void;
    database.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = expect(service.readiness()).rejects.toMatchObject({
      status: 503,
    });
    await jest.advanceTimersByTimeAsync(3000);
    await result;
    const next = service.readiness();
    expect(database).toHaveBeenCalledTimes(1);
    finish();
    await expect(next).resolves.toMatchObject({ status: 'ok' });
  });
  it('fails readiness during shutdown while liveness still responds', async () => {
    const { service, database } = setup();
    service.onModuleDestroy();
    await expect(service.readiness()).rejects.toMatchObject({
      status: 503,
      response: { status: 'shutting_down' },
    });
    expect(service.liveness()).toEqual({ status: 'ok' });
    expect(database).not.toHaveBeenCalled();
  });
});
