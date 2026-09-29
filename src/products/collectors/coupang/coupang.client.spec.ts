import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { productSyncSettings } from '../../../config/product-sync.config';
import { CoupangClient } from './coupang.client';
import { CoupangProtocol } from './coupang.protocol';

describe('CoupangClient transport (synthetic protocol, not an API contract fixture)', () => {
  afterEach(() => jest.restoreAllMocks());
  function setup() {
    const settings = productSyncSettings({
      COUPANG_REQUEST_INTERVAL_MS: 0,
      COUPANG_RETRY_BASE_MS: 1,
    });
    const protocol = new CoupangProtocol();
    const sign = jest.spyOn(protocol, 'buildSearchRequest').mockReturnValue({
      url: new URL('https://example.test/search'),
      headers: { Authorization: 'synthetic-signature' },
    });
    return {
      sign,
      client: new CoupangClient(
        new ConfigService({ app: { productSync: settings } }),
        protocol,
      ),
    };
  }
  it('honors bounded 429 retries and refreshes request signing', async () => {
    const { client, sign } = setup();
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(client.search({ keyword: 'shirt' })).resolves.toEqual({});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      method: 'GET',
    });
  });
  it('does not retry authentication failures or expose their bodies', async () => {
    const { client } = setup();
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('secret value', { status: 401 }));
    await expect(client.search({ keyword: 'shirt' })).rejects.toThrow(
      'Coupang API http failure (401)',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('stops after the configured retry budget', async () => {
    const { client } = setup();
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('', { status: 503 })),
      );
    await expect(client.search({ keyword: 'shirt' })).rejects.toThrow('503');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('does not retry before a Retry-After that exceeds the wait budget', async () => {
    const { client } = setup();
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'Retry-After': '3600' } }),
      );
    await expect(client.search({ keyword: 'shirt' })).rejects.toThrow(
      'rate-limit',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('sanitizes network failures and rejects malformed JSON', async () => {
    const { client } = setup();
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('synthetic-signature'))
      .mockResolvedValueOnce(new Response('not json'));
    await expect(client.search({ keyword: 'shirt' })).rejects.toThrow(
      'Coupang API network failure',
    );
    await expect(client.search({ keyword: 'shirt' })).rejects.toThrow(
      'Coupang API response failure',
    );
  });
  it('fails closed until the official API contract is implemented', () => {
    expect(() => new CoupangProtocol().assertConfigured()).toThrow(
      'official documentation',
    );
  });

  it('does not issue a request after cancellation', async () => {
    const { client } = setup();
    const fetch = jest.spyOn(globalThis, 'fetch');
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.search({ keyword: 'shirt' }, controller.signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
