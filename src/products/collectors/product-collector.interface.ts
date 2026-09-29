import type {
  CollectedProduct,
  ProductSource,
} from './collected-product.interface';

export interface ProductCollector {
  readonly source: ProductSource;
  collect(signal?: AbortSignal): Promise<CollectedProduct[]>;
}
