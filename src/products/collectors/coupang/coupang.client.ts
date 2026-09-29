import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AppSettings } from '../../../config/environment';
import type { ProductSyncSettings } from '../../../config/product-sync.config';
import { CoupangProtocol } from './coupang.protocol';
import {
  CoupangApiError,
  type CoupangSearchQuery,
  type CoupangSearchResponse,
} from './coupang.types';

@Injectable()
export class CoupangClient {
  private readonly settings: ProductSyncSettings;
  // 같은 프로세스의 호출을 직렬화해 수집기의 무제한 병렬 요청을 막습니다.
  private tail: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(
    config: ConfigService,
    private readonly protocol: CoupangProtocol,
  ) {
    this.settings = config.getOrThrow<AppSettings>('app').productSync;
  }

  search(
    query: CoupangSearchQuery,
    signal?: AbortSignal,
  ): Promise<CoupangSearchResponse> {
    const request = this.tail.then(() => this.execute(query, signal));
    this.tail = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  private async execute(
    query: CoupangSearchQuery,
    signal?: AbortSignal,
  ): Promise<CoupangSearchResponse> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      await sleep(Math.max(0, this.nextRequestAt - Date.now()), undefined, {
        signal,
      });
      // 재시도마다 서명을 새로 생성해야 합니다.
      const request = this.protocol.buildSearchRequest(
        query,
        this.settings,
        new Date(),
      );
      let response: Response;
      try {
        response = await fetch(request.url, {
          method: 'GET',
          headers: request.headers,
          redirect: 'error',
          signal: AbortSignal.any([
            AbortSignal.timeout(this.settings.timeoutMs),
            ...(signal ? [signal] : []),
          ]),
        });
      } catch {
        throw new CoupangApiError('network');
      } finally {
        this.nextRequestAt = Date.now() + this.settings.requestIntervalMs;
      }
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          throw new CoupangApiError('network');
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= this.settings.maxRetries)
          throw new CoupangApiError('http', response.status);
        const header = response.headers.get('retry-after');
        let retryAfter = 0;
        if (header) {
          retryAfter = /^\d+$/.test(header)
            ? Number(header) * 1000
            : Math.max(0, Date.parse(header) - Date.now());
          if (!Number.isFinite(retryAfter)) retryAfter = 0;
        }
        // Retry-After가 너무 길면 대기 시간을 줄여 호출하지 않고 배치를 종료합니다.
        if (retryAfter > this.settings.maxBackoffMs)
          throw new CoupangApiError('rate-limit', response.status);
        const delay = Math.max(
          retryAfter,
          Math.min(
            this.settings.maxBackoffMs,
            this.settings.retryBaseMs * 2 ** attempt,
          ),
        );
        await sleep(delay, undefined, { signal });
        continue;
      }
      try {
        return (await response.json()) as unknown;
      } catch {
        throw new CoupangApiError('response');
      }
    }
  }
}
