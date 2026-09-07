import type { Driver, Library, OverlapGroup, Variable } from "./types";
import { globalKeyOf } from "./types";

export interface Conflict {
  group: OverlapGroup;
  /** The selected drivers that clash, in library order. */
  drivers: Driver[];
}

/**
 * Overlap groups violated by this selection.
 *
 * Mirrors `find_conflicts` in backend/modeling.py deliberately: running it in
 * the browser means tile clicks give instant feedback with no round trip. The
 * rules themselves still come from the library, never hard-coded here.
 */
export function findConflicts(library: Library, selected: Set<string>): Conflict[] {
  return library.overlapGroups.flatMap((group) => {
    if (!selected.has(group.exclusive)) return [];

    const clashing = group.conflictsWith.filter((id) => selected.has(id));
    if (clashing.length === 0) return [];

    const ids = new Set([group.exclusive, ...clashing]);
    const drivers = library.drivers.filter((d) => ids.has(d.id));
    return [{ group, drivers }];
  });
}

/** The shared inputs this selection actually references, in library order. */
export function globalsUsedBy(library: Library, selected: Set<string>) {
  const used = new Set<string>();
  for (const driver of library.drivers) {
    if (!selected.has(driver.id)) continue;
    for (const variable of driver.formula.variables) {
      const key = globalKeyOf(variable);
      if (key) used.add(key);
    }
  }
  return library.globalInputs.filter((g) => used.has(g.key));
}

/** A driver's own inputs — the ones not supplied by the shared section. */
export const driverInputsOf = (driver: Driver): Variable[] =>
  driver.formula.variables.filter((v) => globalKeyOf(v) === null);
