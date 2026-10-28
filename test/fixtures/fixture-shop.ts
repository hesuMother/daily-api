import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function createFixtureShop(port = 0) {
  const hits = new Map<string, number>();
  const product = {
    '@type': ['Thing', 'Product'],
    productID: 'shirt-1',
    name: '테스트 셔츠',
    brand: { '@type': 'Brand', name: 'Daily' },
    sku: 'SHIRT-SKU',
    mpn: 'SHIRT-MODEL',
    image: '/shirt.jpg',
    offers: [
      {
        price: '129,000원',
        priceCurrency: 'KRW',
        availability: 'https://schema.org/InStock',
      },
    ],
  };
  const jsonLd = (data: unknown) =>
    '<script type="application/ld+json">' + JSON.stringify(data) + '</script>';
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (path === '/robots.txt') {
      response.setHeader('Content-Type', 'text/plain');
      response.end('User-agent: *\nDisallow: /products/blocked\n');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (path === '/search') {
      response.end(
        [
          'json-ld',
          'json-ld',
          'state',
          'dom',
          'missing-price',
          'missing',
          'retry',
          'blocked',
        ]
          .map((id) => `<a data-product-link href="/products/${id}">${id}</a>`)
          .join(''),
      );
      return;
    }
    if (path === '/products/json-ld') {
      response.end(
        '<script type="application/ld+json">{broken</script>' +
          jsonLd({ '@graph': [product] }),
      );
      return;
    }
    if (path === '/products/state') {
      response.end(
        '<script id="product-state" type="application/json">' +
          JSON.stringify({
            product: { ...product, productID: 'state-1', name: 'State shirt' },
          }) +
          '</script>',
      );
      return;
    }
    if (path === '/products/dom') {
      response.end(
        '<h1 data-product-name>DOM shoes</h1><div data-product-price>₩89,900</div>',
      );
      return;
    }
    if (path === '/products/missing-price') {
      response.end(
        jsonLd({
          '@type': 'Product',
          name: '가격 미정 상품',
          offers: { price: '20%', priceCurrency: 'KRW' },
        }),
      );
      return;
    }
    if (path === '/products/retry') {
      if (hits.get(path) === 1) {
        response.statusCode = 503;
        response.end('Temporarily unavailable');
        return;
      }
      response.end(jsonLd({ ...product, productID: 'retry-1' }));
      return;
    }
    if (path === '/products/redirect') {
      response.statusCode = 302;
      response.setHeader('Location', '/private');
      response.end();
      return;
    }
    if (path === '/products/slow') {
      const timer = setTimeout(() => response.end(jsonLd(product)), 5000);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (path === '/products/missing' || path === '/products/blocked') {
      response.end('<h1>No product</h1>');
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
