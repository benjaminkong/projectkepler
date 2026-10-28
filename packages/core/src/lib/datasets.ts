import type { CategoryId } from "./categories";
import mrt from "../../data/mrt.json";
import primarySchools from "../../data/primary_schools.json";
import hawker from "../../data/hawker.json";
import park from "../../data/park.json";
import mall from "../../data/mall.json";

export interface Poi {
  name: string;
  lat: number;
  lng: number;
  /** Optional second line for the popup, e.g. an address. */
  detail?: string;
}

// JSON imports are typed loosely; the refresh script guarantees the Poi shape.
export const DATASETS = {
  mrt,
  primary_school: primarySchools,
  mall,
  hawker,
  park,
} as unknown as Record<CategoryId, Poi[]>;
