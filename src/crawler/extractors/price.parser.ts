/** Only call with a price field; percentages, ranges, foreign currency and mixed text are rejected. */
export function parseKrwPrice(
  value: unknown,
  currency?: unknown,
): number | null {
  if (currency !== undefined && currency !== 'KRW') return null;
  if (typeof value === 'number')
    return Number.isInteger(value) && value >= 0 && value <= 2147483647
      ? value
      : null;
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/^(?:₩|KRW)\s*/i, '')
    .replace(/\s*원$/, '')
    .trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(cleaned)) return null;
  return parseKrwPrice(Number(cleaned.replaceAll(',', '')));
}
