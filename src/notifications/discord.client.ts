import { Injectable } from '@nestjs/common';

export type DeliveryResult =
  | { status: 'sent' }
  | { status: 'retry'; error: string; delayMs?: number }
  | { status: 'failed'; error: string };

@Injectable()
export class DiscordClient {
  async send(
    webhook: string,
    content: string,
    signal: AbortSignal,
  ): Promise<DeliveryResult> {
    const url = new URL(webhook);
    url.searchParams.set('wait', 'true');
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.slice(0, 2000),
          allowed_mentions: { parse: [] },
          flags: 4,
        }),
      });
      if (response.ok) {
        await response.body?.cancel();
        return { status: 'sent' };
      }
      if (response.status === 429) {
        let seconds = Number(response.headers.get('retry-after'));
        const body: unknown = await response.json().catch(() => null);
        if (
          body &&
          typeof body === 'object' &&
          'retry_after' in body &&
          typeof body.retry_after === 'number'
        )
          seconds = Math.max(seconds, body.retry_after);
        // Invalid responses use a conservative fallback. Never shorten a supplied retry delay.
        const delayMs =
          Number.isFinite(seconds) && seconds > 0
            ? Math.ceil(seconds * 1000) + 1000
            : 60000;
        return { status: 'retry', error: 'HTTP_429', delayMs };
      }
      await response.body?.cancel();
      return {
        status: response.status >= 500 ? 'retry' : 'failed',
        error: 'HTTP_' + response.status,
      };
    } catch {
      return {
        status: 'retry',
        error: signal.aborted ? 'SHUTDOWN' : 'NETWORK_OR_TIMEOUT',
      };
    }
  }
}
