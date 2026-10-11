const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
export const ABYSS_WEEK_MS = 7 * DAY;
// UTC+8 1970-01-05（周一）04:00，固定偏移，不读取浏览器本地时区。
const SETTLEMENT_ANCHOR = Date.UTC(1970, 0, 4, 20);

/** 严格晚于now的下一周结算时刻；到点立即滚入下一周。这里只计时，不结算资源。 */
export function nextAbyssSettlement(now: number): number {
  if (!Number.isFinite(now)) throw new RangeError('结算时间必须是有效时间戳');
  return SETTLEMENT_ANCHOR + (Math.floor((now - SETTLEMENT_ANCHOR) / ABYSS_WEEK_MS) + 1) * ABYSS_WEEK_MS;
}

export function formatAbyssCountdown(remainingMs: number): string {
  const seconds = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / SECOND)) : 0;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${days}天 ${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`;
}
