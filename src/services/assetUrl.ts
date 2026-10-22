/** All runtime resource URLs must also work when the static site is hosted below a subdirectory. */
export function assetUrl(url: string, base = import.meta.env.BASE_URL): string {
  if (!url.startsWith('/assets/')) return url;
  return `${base.endsWith('/') ? base : `${base}/`}${url.slice(1)}`;
}

export function rebaseAssetTree<T>(value: T, base = import.meta.env.BASE_URL): T {
  if (typeof value === 'string') return assetUrl(value, base) as T;
  if (Array.isArray(value)) return value.map(item => rebaseAssetTree(item, base)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, rebaseAssetTree(item, base)]),
  ) as T;
  return value;
}
