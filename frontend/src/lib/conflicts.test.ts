import { describe, expect, it } from "vitest";
import { driverInputsOf, findConflicts, globalsUsedBy } from "./conflicts";
import type { Driver, Library, Variable } from "./types";

const variable = (key: string, source: string): Variable => ({
  key, label: key, unit: "count", source, defaultValue: source === "driverInput" ? 1 : null,
  notes: "",
});

const driver = (id: string, variables: Variable[]): Driver => ({
  id,
  category: "Cost Savings",
  name: id,
  shortDescription: "",
  narrative: "",
  formula: { display: "", variables },
  outputUnit: "USD/year",
  illustrativeExample: { assumptions: "", calculatedValue: 0 },
});

const library: Library = {
  globalInputs: [
    { key: "alpha", label: "Alpha", unit: "count", defaultValue: 1, notes: "" },
    { key: "beta", label: "Beta", unit: "count", defaultValue: 2, notes: "" },
    { key: "gamma", label: "Gamma", unit: "count", defaultValue: 3, notes: "" },
  ],
  drivers: [
    driver("uses-alpha", [variable("a", "globalInput:alpha"), variable("own", "driverInput")]),
    driver("uses-beta", [variable("b", "globalInput:beta")]),
    driver("uses-nothing", [variable("own", "driverInput")]),
    driver("exclusive-one", [variable("own", "driverInput")]),
  ],
  overlapGroups: [
    {
      id: "group-1",
      label: "Group one",
      exclusive: "exclusive-one",
      conflictsWith: ["uses-alpha", "uses-beta"],
      guidance: "guidance text",
    },
  ],
};

describe("findConflicts", () => {
  it("is quiet when the exclusive driver is not selected", () => {
    expect(findConflicts(library, new Set(["uses-alpha", "uses-beta"]))).toEqual([]);
  });

  it("is quiet when the exclusive driver stands alone", () => {
    expect(findConflicts(library, new Set(["exclusive-one"]))).toEqual([]);
  });

  it("flags the exclusive driver together with what it subsumes", () => {
    const conflicts = findConflicts(library, new Set(["exclusive-one", "uses-alpha"]));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.drivers.map((d) => d.id).sort()).toEqual(["exclusive-one", "uses-alpha"]);
  });

  it("reports every clashing member at once", () => {
    const conflicts = findConflicts(
      library, new Set(["exclusive-one", "uses-alpha", "uses-beta"]),
    );
    expect(conflicts[0]?.drivers).toHaveLength(3);
  });
});

describe("globalsUsedBy", () => {
  it("returns only referenced inputs, in library order", () => {
    const used = globalsUsedBy(library, new Set(["uses-beta", "uses-alpha"]));
    expect(used.map((g) => g.key)).toEqual(["alpha", "beta"]);
  });

  it("returns nothing for a driver with no shared inputs", () => {
    expect(globalsUsedBy(library, new Set(["uses-nothing"]))).toEqual([]);
  });

  it("returns nothing for an empty selection", () => {
    expect(globalsUsedBy(library, new Set())).toEqual([]);
  });
});

describe("driverInputsOf", () => {
  it("excludes globally-sourced variables", () => {
    const target = library.drivers.find((d) => d.id === "uses-alpha");
    expect(driverInputsOf(target!).map((v) => v.key)).toEqual(["own"]);
  });
});
