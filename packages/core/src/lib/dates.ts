/** Whole days from today (Singapore time) until the close date. */
export function daysUntil(isoDate: string, now = new Date()): number {
  const todaySg = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(isoDate) - Date.parse(todaySg)) / 86_400_000);
}
