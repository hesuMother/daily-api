import { parseProductJsonLd } from './json-ld.extractor';
import { normalizeProduct } from './product.extractor';

describe('Reusable Product JSON-LD extraction', () => {
  const product = {
    '@type': 'Product',
    name: 'Shirt',
    sku: 'sku-1',
    mpn: 'model-1',
    image: '/shirt.jpg',
    offers: {
      price: '129,000원',
      priceCurrency: 'KRW',
      availability: 'https://schema.org/InStock',
    },
  };
  it.each([
    product,
    [product],
    { '@graph': [{ '@type': 'Organization' }, product] },
    { ...product, '@type': ['Thing', 'Product'] },
  ])('finds Product in supported containers', (input) => {
    expect(parseProductJsonLd([JSON.stringify(input)])?.name).toBe('Shirt');
  });
  it('skips malformed scripts and continues with the next script', () => {
    let malformed = 0;
    expect(
      parseProductJsonLd(['{bad', JSON.stringify(product)], () => malformed++),
    ).toEqual(product);
    expect(malformed).toBe(1);
  });
  it('returns null for broken JSON or a page without Product', () => {
    expect(parseProductJsonLd(['{bad'])).toBeNull();
    expect(parseProductJsonLd(['{"@type":"Organization"}'])).toBeNull();
  });
  it.each(['Daily', { name: 'Daily' }])(
    'normalizes string/object brand',
    (brand) => {
      expect(
        normalizeProduct(
          { ...product, brand },
          'example',
          'https://shop.test/a',
        ),
      ).toMatchObject({
        brand: 'Daily',
        sku: 'sku-1',
        modelNumber: 'model-1',
        imageUrl: 'https://shop.test/shirt.jpg',
        price: 129000,
        inStock: true,
      });
    },
  );
  it('supports offer arrays without mixing price/currency/stock between entries', () => {
    expect(
      normalizeProduct(
        {
          ...product,
          offers: [
            {
              price: '10',
              priceCurrency: 'USD',
              availability: 'https://schema.org/InStock',
            },
            {
              price: '89900',
              priceCurrency: 'KRW',
              availability: 'https://schema.org/OutOfStock',
            },
          ],
        },
        'example',
        'https://shop.test/a',
      ),
    ).toMatchObject({ price: 89900, inStock: false });
  });
  it('keeps unknown stock and price unknown; ignores credential-bearing images', () => {
    expect(
      normalizeProduct(
        { ...product, image: 'https://user:password@shop.test/a', offers: {} },
        'example',
        'https://shop.test/a',
      ),
    ).toMatchObject({
      price: null,
      originalPrice: undefined,
      inStock: undefined,
      imageUrl: undefined,
    });
  });
});
