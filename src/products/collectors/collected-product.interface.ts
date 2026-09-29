export interface CollectedProduct {
  externalProductId: string;
  name: string;
  price: number;
  // 통화가 바뀐 경우에도 이력의 금액을 해석할 수 있도록 함께 저장합니다.
  currency?: string;
  imageUrl?: string;
  purchaseUrl?: string;
  isSoldOut?: boolean;
}

export interface ProductSource {
  slug: string;
  name: string;
}

export class InvalidCollectedProductError extends Error {
  constructor() {
    super('Invalid collected product');
  }
}

export function validateCollectedProduct(value: unknown): CollectedProduct {
  const invalid = () => {
    throw new InvalidCollectedProductError();
  };
  if (!value || typeof value !== 'object') return invalid();
  const p = value as Record<string, unknown>;
  if (
    typeof p.externalProductId !== 'string' ||
    !p.externalProductId.trim() ||
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    typeof p.price !== 'number' ||
    !Number.isInteger(p.price) ||
    p.price < 0 ||
    p.price > 2147483647
  )
    return invalid();
  const currency = p.currency ?? 'KRW';
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
    return invalid();
  if (p.isSoldOut !== undefined && typeof p.isSoldOut !== 'boolean')
    return invalid();
  const url = (v: unknown): string | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string') return invalid();
    try {
      const parsed = new URL(v);
      if (
        !['https:', 'http:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        return invalid();
      return parsed.href;
    } catch {
      return invalid();
    }
  };
  return {
    externalProductId: p.externalProductId.trim(),
    name: p.name.trim(),
    price: p.price,
    currency,
    imageUrl: url(p.imageUrl),
    purchaseUrl: url(p.purchaseUrl),
    isSoldOut: p.isSoldOut,
  };
}
