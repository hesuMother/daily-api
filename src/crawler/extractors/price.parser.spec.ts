import { parseKrwPrice } from './price.parser';

describe('KRW price parser', () => {
  it.each([
    ['129,000원', 129000],
    ['₩89,900', 89900],
    ['129000', 129000],
    ['129000.00', 129000],
    [0, 0],
    [undefined, null],
    [null, null],
    ['', null],
    ['가격 없음', null],
    ['20%', null],
    ['20% 할인 10,000원', null],
    ['1,00원', null],
    ['12.50', null],
    ['1000~2000원', null],
    [-1, null],
    [Infinity, null],
  ])('normalizes %s to %s', (input, expected) => {
    expect(parseKrwPrice(input)).toBe(expected);
  });
  it('never interprets another currency as KRW', () => {
    expect(parseKrwPrice('100', 'USD')).toBeNull();
  });
});
