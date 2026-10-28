import { jest } from '@jest/globals';
import { CrawlRobotsPolicy, permittedUrl } from './crawl-policy';

describe('Crawler URL and robots policy', () => {
  afterEach(() => jest.restoreAllMocks());
  const policy = {
    allowedOrigins: ['https://shop.test'],
    isAllowedPath: (url: URL) => url.pathname.startsWith('/products/'),
  };
  it.each([
    'http://localhost/products/a',
    'https://shop.test.evil.test/products/a',
    'https://user:pass@shop.test/products/a',
    'file:///products/a',
    'https://shop.test/admin',
  ])('rejects unexpected URL %s', (url) => {
    expect(() => permittedUrl(url, policy)).toThrow('URL_NOT_ALLOWED');
  });
  it('removes fragments without dropping product-identifying query parameters', () => {
    expect(
      permittedUrl('https://shop.test/products/a?variant=1#anchor', policy),
    ).toBe('https://shop.test/products/a?variant=1');
  });
  it('uses robots rules and caches the file within a batch', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('User-agent: *\nDisallow: /products/private\n'),
      );
    const robots = new CrawlRobotsPolicy();
    await robots.assertAllowed(
      'https://shop.test/products/a',
      new AbortController().signal,
    );
    await expect(
      robots.assertAllowed(
        'https://shop.test/products/private',
        new AbortController().signal,
      ),
    ).rejects.toThrow('ROBOTS_DENIED');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
  });
  it('denies unavailable robots files but treats 404 as no published rules', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const robots = new CrawlRobotsPolicy();
    await expect(
      robots.assertAllowed(
        'https://shop.test/products/a',
        new AbortController().signal,
      ),
    ).rejects.toThrow('ROBOTS_DENIED');
    await expect(
      robots.assertAllowed(
        'https://shop.test/products/a',
        new AbortController().signal,
      ),
    ).resolves.toBeUndefined();
  });
});
