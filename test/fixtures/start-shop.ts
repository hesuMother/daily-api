import { networkInterfaces } from 'node:os';
import { createFixtureShop } from './fixture-shop';

void createFixtureShop(9080).then((shop) => {
  console.log(
    'Example shop fixture: http://localhost:' + shop.port + '/search',
  );
  const host = Object.values(networkInterfaces())
    .flat()
    .find(
      (address) => address?.family === 'IPv4' && !address.internal,
    )?.address;
  if (host)
    console.log('CRAWLER_EXAMPLE_BASE_URL=http://' + host + ':' + shop.port);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void shop.close();
    });
});
