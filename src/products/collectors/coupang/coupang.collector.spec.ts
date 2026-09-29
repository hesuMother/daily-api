import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { productSyncSettings } from '../../../config/product-sync.config';
import { CoupangClient } from './coupang.client';
import { CoupangCollector } from './coupang.collector';
import { CoupangProtocol } from './coupang.protocol';

describe('CoupangCollector', () => {
  const product = { externalProductId: '42', name: 'Shirt', price: 1000 };
  function setup() {
    const config = new ConfigService({
      app: {
        productSync: productSyncSettings({
          COUPANG_SYNC_KEYWORDS: 'shirt,coat',
        }),
      },
    });
    const protocol = new CoupangProtocol();
    const client = new CoupangClient(config, protocol);
    const search = jest.spyOn(client, 'search').mockResolvedValue({});
    return {
      search,
      protocol,
      collector: new CoupangCollector(config, client, protocol),
    };
  }
  it('filters bad candidates and deduplicates overlapping keyword results by external ID', async () => {
    const { collector, protocol, search } = setup();
    jest
      .spyOn(protocol, 'toCandidates')
      .mockReturnValueOnce([product, { ...product, price: -1 }])
      .mockReturnValueOnce([{ ...product, price: 2000 }]);
    expect(await collector.collect()).toEqual([
      expect.objectContaining({ externalProductId: '42', price: 2000 }),
    ]);
    expect(search.mock.calls).toEqual([
      [{ keyword: 'shirt' }, undefined],
      [{ keyword: 'coat' }, undefined],
    ]);
  });
  it('does not turn an API-wide failure into an empty successful batch', async () => {
    const { collector, search } = setup();
    search.mockRejectedValue(new Error('API unavailable'));
    await expect(collector.collect()).rejects.toThrow('API unavailable');
  });
});
