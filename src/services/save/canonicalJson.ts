/** Object key order is not save data: normalize it for byte-stable exports. Array order stays intact. */
export function canonicalJson(value: unknown): string {
  const order = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(order);
    if (item !== null && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, order(v)]),
    );
    return item;
  };
  return JSON.stringify(order(value), null, 2);
}
