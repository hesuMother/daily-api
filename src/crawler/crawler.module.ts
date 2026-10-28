import { Module } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { LightpandaService } from './browser/lightpanda.service';
import { ExampleParser } from './providers/sites/example/example.parser';
import { ExampleProvider } from './providers/sites/example/example.provider';
import { Cm29Provider } from './providers/sites/cm29/cm29.provider';
import { PRODUCT_PROVIDERS } from './providers/product-provider.interface';

@Module({
  providers: [
    CrawlerService,
    LightpandaService,
    ExampleParser,
    ExampleProvider,
    Cm29Provider,
    {
      provide: PRODUCT_PROVIDERS,
      useFactory: (example: ExampleProvider, cm29: Cm29Provider) => [
        example,
        cm29,
      ],
      inject: [ExampleProvider, Cm29Provider],
    },
  ],
  exports: [PRODUCT_PROVIDERS, LightpandaService],
})
export class CrawlerModule {}
