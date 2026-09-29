import { validateCollectedProduct } from './collected-product.interface';

describe('CollectedProduct validation', () => {
  const valid = { externalProductId: '42', name: 'Shirt', price: 1000 };
  it.each([-1, 1.5, NaN, Infinity, 2147483648])(
    'rejects invalid price %s',
    (price) => {
      expect(() => validateCollectedProduct({ ...valid, price })).toThrow();
    },
  );
  it.each([
    { externalProductId: '' },
    { externalProductId: 42 },
    { name: ' ' },
    { purchaseUrl: 'javascript:alert(1)' },
    { imageUrl: 'https://user:pass@example.com/a' },
    { currency: 'krw' },
    { isSoldOut: 'false' },
  ])('rejects invalid external data %s', (input) => {
    expect(() => validateCollectedProduct({ ...valid, ...input })).toThrow();
  });
  it('preserves unknown availability instead of turning it into in-stock', () => {
    expect(validateCollectedProduct(valid)).toMatchObject({
      ...valid,
      currency: 'KRW',
      isSoldOut: undefined,
    });
  });
});
