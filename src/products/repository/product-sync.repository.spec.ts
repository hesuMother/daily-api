import { jest } from '@jest/globals';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ProductSyncRepository } from './product-sync.repository';

describe('ProductSyncRepository', () => {
  const source = { slug: 'coupang', name: 'Coupang' };
  const product = {
    externalProductId: '42',
    name: 'Shirt',
    price: 1000,
    imageUrl: 'https://example.test/a.jpg',
  };
  function setup(existing = false) {
    const tx = {
      seller: {
        upsert: jest
          .fn<() => Promise<{ id: string }>>()
          .mockResolvedValue({ id: 'seller' }),
      },
      product: {
        create: jest
          .fn<() => Promise<{ id: string }>>()
          .mockResolvedValue({ id: 'product' }),
      },
      productOffer: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(
          existing
            ? {
                id: 'offer',
                productId: 'product',
                price: 1000,
                currency: 'KRW',
                purchaseUrl: null,
                isSoldOut: false,
              }
            : null,
        ),
        create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
        update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
      },
      productImage: {
        findFirst: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ id: 'image' }),
        create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
      },
    };
    const transaction = jest
      .fn<
        (
          fn: (t: Prisma.TransactionClient) => Promise<string>,
          options: unknown,
        ) => Promise<string>
      >()
      .mockImplementation((fn) =>
        fn(tx as unknown as Prisma.TransactionClient),
      );
    return {
      tx,
      transaction,
      repository: new ProductSyncRepository({
        $transaction: transaction,
      } as unknown as PrismaService),
    };
  }
  it('creates the product, image, offer and initial price within a serializable transaction', async () => {
    const { tx, transaction, repository } = setup();
    await expect(repository.sync(source, product)).resolves.toBe('created');
    expect(transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: 'Serializable',
    });
    expect(tx.seller.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'coupang' } }),
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Shirt',
          images: { create: { imageUrl: product.imageUrl } },
        },
      }),
    );
    expect(tx.productOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalProductId: '42',
        sellerId: 'seller',
        priceHistories: { create: { price: 1000, currency: 'KRW' } },
      }) as unknown,
    });
  });
  it('does not insert an unchanged price or an existing image again', async () => {
    const { tx, repository } = setup(true);
    await expect(repository.sync(source, product)).resolves.toBe('unchanged');
    expect(tx.productOffer.update).toHaveBeenCalledWith({
      where: { id: 'offer' },
      data: {
        price: 1000,
        currency: 'KRW',
        purchaseUrl: undefined,
        isSoldOut: undefined,
      },
    });
    expect(tx.productImage.create).not.toHaveBeenCalled();
    expect(tx.product.create).not.toHaveBeenCalled();
  });
  it.each([{ price: 900 }, { currency: 'USD' }])(
    'records a price/currency change in the same offer update %s',
    async (input) => {
      const { tx, repository } = setup(true);
      await repository.sync(source, { ...product, ...input });
      expect(tx.productOffer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priceHistories: {
              create: {
                price: input.price ?? 1000,
                currency: input.currency ?? 'KRW',
              },
            },
          }) as unknown,
        }),
      );
    },
  );
  it('retries a serialization conflict but not indefinitely', async () => {
    const { transaction, repository } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
      code: 'P2034',
      clientVersion: '7.10.0',
    });
    transaction.mockRejectedValueOnce(conflict);
    await expect(repository.sync(source, product)).resolves.toBe('created');
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction.mockClear().mockRejectedValue(conflict);
    await expect(repository.sync(source, product)).rejects.toBe(conflict);
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('propagates history write failures out of the transaction', async () => {
    const { tx, transaction, repository } = setup(true);
    tx.productOffer.update.mockRejectedValueOnce(new Error('history failure'));
    await expect(
      repository.sync(source, { ...product, price: 900 }),
    ).rejects.toThrow('history failure');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.productImage.findFirst).not.toHaveBeenCalled();
  });
});
