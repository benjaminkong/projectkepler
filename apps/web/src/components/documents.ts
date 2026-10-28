export function fmtWhen(v?: string) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v; // already formatted by the API
  return d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }).replace(",", "");
}
