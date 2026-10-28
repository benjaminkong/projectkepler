export type CategoryId = "mrt" | "primary_school" | "mall" | "hawker" | "park";

export interface Category {
  id: CategoryId;
  label: string;
  /** Short text drawn inside the map marker, so categories differ by more than colour. */
  glyph: string;
  color: string;
  /** Singular and plural nouns for sentences, e.g. "1 park", "3 parks". */
  noun: [string, string];
  /** Search 2 km when nothing is within 1 km (FR-2.5: primary schools only). */
  widenTo2km?: boolean;
  /** Show straight-line distance instead of walking distance. */
  straightLine?: boolean;
}

export const countNoun = (c: Category, n: number) => `${n} ${c.noun[n === 1 ? 0 : 1]}`;

export const CATEGORIES: Category[] = [
  { id: "mrt", label: "MRT / LRT stations", glyph: "M", color: "#d42e12", noun: ["MRT/LRT station", "MRT/LRT stations"] },
  { id: "primary_school", label: "Primary schools", glyph: "S", color: "#2563eb", noun: ["primary school", "primary schools"], widenTo2km: true, straightLine: true },
  { id: "mall", label: "Shopping malls", glyph: "🛍", color: "#db2777", noun: ["shopping mall", "shopping malls"] },
  { id: "hawker", label: "Hawker centres", glyph: "H", color: "#ea580c", noun: ["hawker centre", "hawker centres"] },
  { id: "park", label: "Parks", glyph: "P", color: "#16a34a", noun: ["park", "parks"] },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  CategoryId,
  Category
>;
