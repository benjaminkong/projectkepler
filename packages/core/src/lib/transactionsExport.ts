// Excel export for the Transactions page, in the layout of the team's comparables template
// ("<Site> - comparables"): sheet "Comparable Resi Sales" with
//  - a subject-site row,
//  - left table (B-R): each project's sales by the developer since launch,
//  - right table (T-AC): each project's caveats in the chosen period (default: past 9 months),
//  - footnotes and "Updated on / Printed on" dates.
// Styles (Cambria, navy headers, light-blue $psf columns, A3 landscape) follow the template. Server-only.
import ExcelJS from "exceljs";
import { OFFICE_THEME_XML } from "./officeTheme";
import type { DeveloperSales, PipelineProject, Transaction } from "./transactions";

const SQM_TO_SQFT = 10.7639;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface SubjectSite {
  name: string;
  district: string;
  /** e.g. "390m to Orchard Boulevard MRT" */
  mrt: string;
  /** e.g. "99 years" */
  tenure: string;
}

export interface ComparablesInput {
  /** Project names in the order the user selected them. */
  projects: string[];
  /** Every transaction (URA's 5-year window), for since-launch figures. */
  allRows: Transaction[];
  /** Transactions in the period (all sale types), already filtered by the user's price filters. */
  periodRows: Transaction[];
  /** Period as "YYYY-MM" months, inclusive; `latest` is the newest month in URA's data. */
  period: { from: string; to: string; latest: string };
  pipeline: PipelineProject[];
  /** Latest developer sales survey: total units for sale (excludes e.g. serviced residences). */
  developerSales?: DeveloperSales[];
  /** Project -> "250m to Marina South MRT" (walking). */
  mrtByProject: Map<string, string>;
  subject?: SubjectSite;
}

export interface ProjectStats {
  caveats: number;
  avgSizeSqft: number;
  /** Average price, rounded to the nearest $1,000 like the template. */
  avgQuantum: number;
  /** Total price / total area. */
  avgPsf: number;
  minPsf: number;
  maxPsf: number;
}

export interface ComparableRow {
  project: string;
  district: string;
  mrt: string;
  tenure: string;
  /** First month of developer sales, as a date (first of the month). */
  launch?: Date;
  completion: string;
  totalUnits?: number;
  soldByDeveloperPct?: number;
  developer: string;
  sinceLaunch?: ProjectStats;
  inPeriod?: ProjectStats;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const monthDate = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** "99 yrs lease commencing from 2022" -> "99 years"; "Freehold" stays. */
export function shortTenure(tenure: string): string {
  const m = tenure.match(/^(\d+)\s*(?:yrs?|years?)/i);
  return m ? `${m[1]} years` : tenure;
}

export function stats(rows: Transaction[]): ProjectStats | undefined {
  if (rows.length === 0) return undefined;
  const sqft = rows.reduce((n, r) => n + r.areaSqm * SQM_TO_SQFT, 0);
  const price = rows.reduce((n, r) => n + r.price, 0);
  const psfs = rows.map((r) => r.psf);
  return {
    caveats: rows.length,
    avgSizeSqft: sqft / rows.length,
    avgQuantum: Math.round(price / rows.length / 1000) * 1000,
    avgPsf: price / sqft,
    minPsf: Math.min(...psfs),
    maxPsf: Math.max(...psfs),
  };
}

export function comparableRows(input: ComparablesInput): ComparableRow[] {
  const pipelineByName = new Map(input.pipeline.map((p) => [norm(p.project), p]));
  const devSalesByName = new Map((input.developerSales ?? []).map((d) => [norm(d.project), d]));
  return input.projects.map((project) => {
    const history = input.allRows.filter((r) => r.project === project);
    const newSales = history.filter((r) => r.saleType === "New Sale");
    const pipe = pipelineByName.get(norm(project));
    const firstNewSale = newSales.reduce<string | undefined>((m, r) => (!m || r.month < m ? r.month : m), undefined);
    const unitsSold = newSales.reduce((n, r) => n + r.noOfUnits, 0);
    // Homes for sale from the developer survey; the pipeline's total can include serviced residences.
    const totalUnits = devSalesByName.get(norm(project))?.unitsAvail || pipe?.totalUnits || undefined;
    return {
      project,
      district: mostCommon(history.map((r) => r.district)) || "-",
      mrt: input.mrtByProject.get(project) ?? "-",
      tenure: shortTenure(mostCommon(history.map((r) => r.tenure))) || "-",
      launch: firstNewSale ? monthDate(firstNewSale) : undefined,
      completion: pipe ? (/^\d{4}$/.test(pipe.expectedTOPYear) ? pipe.expectedTOPYear : "Uncompleted") : "Completed",
      totalUnits,
      soldByDeveloperPct: totalUnits ? unitsSold / totalUnits : undefined,
      developer: pipe?.developerName || "-",
      sinceLaunch: stats(newSales),
      inPeriod: stats(input.periodRows.filter((r) => r.project === project)),
    };
  });
}

/** "Past 9 months transactions from 1 Jan 2026", or "Transactions from Jan 2026 to Mar 2026". */
export function periodTitle(p: ComparablesInput["period"]): string {
  const [fy, fm] = [Number(p.from.slice(0, 4)), Number(p.from.slice(5, 7))];
  const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  if (p.to < p.latest) return `Transactions from ${label(p.from)} to ${label(p.to)}`;
  const months = (Number(p.to.slice(0, 4)) - fy) * 12 + Number(p.to.slice(5, 7)) - fm + 1;
  return `Past ${months} months transactions from 1 ${MONTHS[fm - 1]} ${fy}`;
}

// --- Styling (from the template) -------------------------------------------------------------

const FONT = "Cambria";
// Theme colours and tints exactly as in the template (theme 3 = Dark Blue 2, theme 0 = white).
type ThemeColor = { theme: number; tint: number };
const NAVY: ThemeColor = { theme: 3, tint: 0.0999786370433668 };
const LIGHT_BLUE: ThemeColor = { theme: 3, tint: 0.8999908444471572 };
const GREY: ThemeColor = { theme: 0, tint: -0.0499893185216834 };
const thin: Partial<ExcelJS.Border> = { style: "thin" };
const fill = (color: ThemeColor): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: color as Partial<ExcelJS.Color> });
const FMT = { money: '"$"#,##0', int: "#,##0", pct: "0%", month: "mmm-yy" };

/** Column widths A-AC, as in the template. */
const WIDTHS = [7.44, 14, 52.22, 13.44, 38.55, 19.55, 16.44, 24.22, 11.78, 18.44, 14.55, 27.44, 17.78, 25.78, 14.78, 1.78, 15.78, 35, 2.78, 13.55, 52.22, 13.44, 11.78, 29.89, 19.22, 28.78, 15.44, 2.22, 14.44];

const LEFT_HEADERS: [string, string][] = [
  ["B", "S/N"], ["C", "Project Name"], ["D", "District "], ["E", "Walking distance\n to MRT"], ["F", "Tenure"],
  ["G", "Launch Date"], ["H", "Completion Year"], ["I", "Total units"], ["J", "Sold by developer\n(%)"],
  ["K", "Avg. Size\n(sq ft) "], ["L", "Avg. Price Quantum \n($)"], ["M", "Avg. price of Units Sold \n($ psf)"],
  ["N", "Adjusted for GFA Harmonisation*\n($psf) "], ["O", "Price Range ($psf)"], ["R", "Developer"],
];
const RIGHT_HEADERS: [string, string][] = [
  ["T", "S/N"], ["U", "Project Name"], ["V", "No. of Caveats"], ["W", "Avg. Size\n(sq ft) "],
  ["X", "Avg. Price Quantum \n($)"], ["Y", "Avg. price of Units Sold \n($ psf)"],
  ["Z", "Adjusted for GFA harmonisation*\n($psf) "], ["AA", "Price Range ($psf)"],
];
/** Light-blue $psf columns. */
const PSF_COLS = new Set(["M", "N", "O", "P", "Q", "Y", "Z", "AA", "AB", "AC"]);

function style(
  cell: ExcelJS.Cell,
  opts: { size?: number; bold?: boolean; color?: string; bg?: ThemeColor; align?: "left" | "center"; fmt?: string; indent?: number },
) {
  cell.font = { name: FONT, family: 1, size: opts.size ?? 21, bold: opts.bold, color: opts.color ? { argb: opts.color } : undefined };
  if (opts.bg) cell.fill = fill(opts.bg);
  cell.alignment = { horizontal: opts.align ?? "center", vertical: "middle", wrapText: true, indent: opts.indent };
  if (opts.fmt) cell.numFmt = opts.fmt;
}

/** Thin top/bottom borders across a table row, outer edges on the end columns, and a boxed S/N cell. */
function borderRow(ws: ExcelJS.Worksheet, row: number, from: number, to: number) {
  for (let c = from; c <= to; c++) {
    ws.getCell(row, c).border = {
      top: thin,
      bottom: thin,
      left: c === from ? thin : undefined,
      right: c === from || c === to ? thin : undefined,
    };
  }
}

export async function buildComparablesWorkbook(input: ComparablesInput, now = new Date()): Promise<Buffer> {
  const rows = comparableRows(input);
  const wb = new ExcelJS.Workbook();
  // exceljs writes its own default theme unless one is set; `_themes` is its (private) hook for that.
  (wb as unknown as { _themes?: Record<string, string> })._themes = { theme1: OFFICE_THEME_XML };
  wb.creator = "Tender Sites Portal";
  wb.created = now;
  const ws = wb.addWorksheet("Comparable Resi Sales", {
    views: [{ zoomScale: 40, zoomScaleNormal: 40 }],
    pageSetup: {
      paperSize: 8 as ExcelJS.PaperSize, // A3 (missing from exceljs typings; valid in Excel)
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Row 1: right-table title.
  ws.getRow(1).height = 34.05;
  const title = ws.getCell("T1");
  title.value = periodTitle(input.period);
  title.font = { name: FONT, family: 1, size: 18, bold: true, underline: true };
  title.alignment = { horizontal: "left", vertical: "middle" };

  // Row 2: headers.
  ws.getRow(2).height = 128.55;
  for (const [col, text] of [...LEFT_HEADERS, ...RIGHT_HEADERS]) ws.getCell(`${col}2`).value = text;
  ws.mergeCells("O2:Q2");
  ws.mergeCells("AA2:AC2");
  for (const [from, to] of [[2, 18], [20, 29]]) {
    for (let c = from; c <= to; c++) {
      const isName = c === 3 || c === 21;
      style(ws.getCell(2, c), {
        size: 18,
        bold: true,
        color: "FFFFFFFF",
        bg: NAVY,
        align: isName ? "left" : "center",
        indent: isName ? 1 : undefined,
      });
    }
    borderRow(ws, 2, from, to);
  }

  // Row 3: subject site.
  ws.getRow(3).height = 60;
  const s = input.subject;
  const subject: [string, string][] = [
    ["B", "Subject site "],
    ["C", s ? s.name.toUpperCase() : "-"],
    ["D", s?.district ?? "-"],
    ["E", s?.mrt ?? "-"],
    ["F", s?.tenure ?? "-"],
  ];
  // Grey band across the left table for the subject row and the spacer row under it, as in the template.
  for (const row of [3, 4]) {
    for (let c = 2; c <= 18; c++) {
      style(ws.getCell(row, c), { bg: GREY, align: c === 3 ? "left" : "center", indent: c === 3 ? 1 : undefined });
    }
    borderRow(ws, row, 2, 18);
  }
  for (const [col, v] of subject) ws.getCell(`${col}3`).value = v;
  ws.getRow(4).height = 34.5;

  // Rows 5..: one per project.
  const first = 5;
  const formats: Record<string, string> = {
    G: FMT.month, I: FMT.int, J: FMT.pct, K: FMT.int, L: FMT.money, M: FMT.money, N: FMT.money, O: FMT.money, Q: FMT.money,
    V: FMT.int, W: FMT.int, X: FMT.money, Y: FMT.money, Z: FMT.money, AA: FMT.money, AC: FMT.money,
  };
  rows.forEach((r, i) => {
    const n = first + i;
    ws.getRow(n).height = 94.95;
    const L = r.sinceLaunch;
    const P = r.inPeriod;
    const values: Record<string, ExcelJS.CellValue> = {
      B: i + 1,
      C: r.project,
      D: r.district,
      E: r.mrt,
      F: r.tenure,
      G: r.launch ?? "-",
      H: r.completion,
      I: r.totalUnits ?? "-",
      J: r.soldByDeveloperPct ?? "-",
      K: L?.avgSizeSqft ?? "-",
      L: L?.avgQuantum ?? "-",
      M: L?.avgPsf ?? "-",
      N: "-",
      O: L?.minPsf ?? "-",
      P: "-",
      Q: L?.maxPsf ?? "-",
      R: r.developer,
      T: { formula: `B${n}`, result: i + 1 },
      U: { formula: `C${n}`, result: r.project },
      V: P?.caveats ?? 0,
      W: P?.avgSizeSqft ?? "-",
      X: P?.avgQuantum ?? "-",
      Y: P?.avgPsf ?? "-",
      Z: "-",
      AA: P?.minPsf ?? "-",
      AB: "-",
      AC: P?.maxPsf ?? "-",
    };
    for (const [col, v] of Object.entries(values)) {
      const cell = ws.getCell(`${col}${n}`);
      cell.value = v;
      const isName = col === "C" || col === "U";
      style(cell, {
        bold: ["L", "M", "N", "X", "Y", "Z"].includes(col),
        bg: PSF_COLS.has(col) ? LIGHT_BLUE : undefined,
        align: isName ? "left" : "center",
        indent: isName ? 1 : undefined,
        fmt: formats[col],
      });
    }
    borderRow(ws, n, 2, 18);
    borderRow(ws, n, 20, 29);
  });

  // Footnotes and dates.
  const last = first + rows.length - 1;
  const notes: [number, string, number][] = [
    [last + 1, "* Adjusted with 5% premium for WP submitted before GFA harmonisation (fill in where it applies)", 32.55],
    [last + 2, "Source: URA Data Service (private residential transactions, pipeline and developer sales; total units are homes for sale). Walking distances: OpenStreetMap (FOSSGIS routing).", 22.05],
  ];
  for (const [row, text, h] of notes) {
    ws.getRow(row).height = h;
    const cell = ws.getCell(row, 2);
    cell.value = text;
    cell.font = { name: FONT, family: 1, size: 22 };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  }
  ws.getRow(last + 3).height = 10.5;
  for (const [row, label] of [[last + 4, "Updated on"], [last + 5, "Printed on"]] as const) {
    ws.mergeCells(row, 2, row, 3);
    const cell = ws.getCell(row, 2);
    cell.value = { formula: "TODAY()", result: now };
    cell.numFmt = `"${label}" dd-mmm-yyyy`;
    cell.font = { name: FONT, family: 1, size: 22 };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  }
  ws.pageSetup.printArea = `B1:AC${last + 5}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "Orchard Boulevard - comparables 2026-10-19.xlsx" (Singapore date). */
export function exportFileName(subjectName: string | undefined, now = new Date()): string {
  const day = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const safe = (subjectName ?? "Projects").replace(/[^\w .-]/g, "").trim() || "Projects";
  return `${safe} - comparables ${day}.xlsx`;
}
