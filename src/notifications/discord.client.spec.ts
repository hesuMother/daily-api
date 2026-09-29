import { jest } from '@jest/globals';
import { DiscordClient } from './discord.client';

describe('Discord webhook transport', () => {
  afterEach(() => jest.restoreAllMocks());
  const url = 'https://discord.com/api/webhooks/123/private-token';
  const signal = () => new AbortController().signal;
  it('requests delivery confirmation and suppresses mentions', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));
    expect(await new DiscordClient().send(url, '@everyone', signal())).toEqual({
      status: 'sent',
    });
    expect(fetch.mock.calls[0][0]).toEqual(new URL(url + '?wait=true'));
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      allowed_mentions: { parse: [] },
    });
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
  });
  it('honors both JSON retry_after and Retry-After without immediate retries', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"retry_after": 120.5}', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    );
    expect(await new DiscordClient().send(url, 'alert', signal())).toEqual({
      status: 'retry',
      error: 'HTTP_429',
      delayMs: 121500,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('sanitizes failures and distinguishes permanent HTTP failures from outages', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error(url))
      .mockResolvedValueOnce(new Response(url, { status: 401 }))
      .mockResolvedValueOnce(new Response(url, { status: 503 }));
    const client = new DiscordClient();
    expect(await client.send(url, 'alert', signal())).toEqual({
      status: 'retry',
      error: 'NETWORK_OR_TIMEOUT',
    });
    expect(await client.send(url, 'alert', signal())).toEqual({
      status: 'failed',
      error: 'HTTP_401',
    });
    expect(await client.send(url, 'alert', signal())).toEqual({
      status: 'retry',
      error: 'HTTP_503',
    });
  });
});
