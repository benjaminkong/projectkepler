const nf = new Intl.NumberFormat("en-SG");

export const fmtNumber = (n?: number) => (n === undefined ? undefined : nf.format(n));
export const fmtMoney = (n?: number) => (n === undefined ? "–" : `$${nf.format(n)}`);

export function fmtDate(iso?: string) {
  if (!iso) return undefined;
  return new Date(`${iso}T00:00:00+08:00`).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  });
}

/** "2026-03" -> "Mar 2026" */
export function fmtMonth(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-SG", { month: "short", year: "numeric" });
}

export function closesInLabel(days: number) {
  if (days < 0) return "Tender closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `Closes in ${days} days`;
}
