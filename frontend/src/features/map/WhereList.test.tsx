// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphPerson } from "@/api/types";
import { EXAMPLE_NAMES, EXAMPLE_SPOTS } from "./examplePlaces";
import { type Spot, stateOf } from "./levels";
import { listBeside, WhereList } from "./WhereList";

/*
 * The list beside the map, with the example family's places: a country without
 * states lists its towns; and where the list goes.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const people = new Map(
  [...EXAMPLE_NAMES].map(([id, full_name]) => [
    id,
    { id, full_name, nickname: null } as unknown as GraphPerson,
  ]),
);

function show(spots: Spot[] = EXAMPLE_SPOTS): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const nothing = () => {};
  act(() =>
    root?.render(
      <WhereList
        field="residence"
        spots={spots}
        people={people}
        rough={[]}
        missing={[]}
        unfound={[]}
        atParents={new Map()}
        pins={[]}
        editable
        onShow={nothing}
        onSelect={nothing}
        onPlace={nothing}
        onRemovePin={nothing}
      />,
    ),
  );
  return container;
}

const section = (container: HTMLElement, country: string) =>
  [...container.querySelectorAll("section")].find((each) =>
    each.querySelector("button")?.textContent?.startsWith(country),
  ) as HTMLElement;

describe("the place list", () => {
  it("lists a country's towns where it has no states, as Singapore", () => {
    const singapore = section(show(), "Singapore");
    // Before, a single "State not known" held all seven.
    expect(singapore.textContent).not.toContain("State not known");
    const towns = [...singapore.querySelectorAll("li > button:first-child")].map(
      (button) => button.textContent,
    );
    expect(towns).toEqual(["Tampines Estate", "Bedok New Town", "Jurong West"]);
  });

  it("lists Brunei's towns too, though GeoNames gives it districts as states", () => {
    // A made-up family in Brunei, as the map's page makes its spots.
    const brunei = (id: string, place: string, state: string): Spot => ({
      id,
      x: 0,
      y: 0,
      place,
      district: null,
      state: stateOf("Brunei", state),
      country: "Brunei",
      rough: false,
    });
    const container = show([
      brunei("a", "Bandar Seri Begawan", "Brunei-Muara District"),
      brunei("b", "Tutong", "Tutong"),
    ]);
    const towns = [...section(container, "Brunei").querySelectorAll("li > button:first-child")];
    expect(towns.map((button) => button.textContent).sort()).toEqual([
      "Bandar Seri Begawan",
      "Tutong",
    ]);
    expect(container.querySelector("summary")).toBeNull();
    expect(stateOf("Malaysia", "Kelantan")).toBe("Kelantan");
  });

  it("lists a country's states where it has them, each with its towns", () => {
    const container = show();
    const malaysia = section(container, "Malaysia");
    const states = [...malaysia.querySelectorAll("summary > button")].map(
      (button) => button.textContent,
    );
    expect(states.slice(0, 3)).toEqual(["Selangor", "Kelantan", "Johor"]);
    expect(section(container, "Australia").querySelector("summary")?.textContent).toContain(
      "Victoria",
    );
  });

  it("sits beside the map only where that leaves the map room", () => {
    expect(listBeside(1366)).toBe(true);
    expect(listBeside(800)).toBe(true); // 512 px of map
    // 1024 px with someone's panel open: beside it, it left the map about 300 px.
    expect(listBeside(1024 - 440)).toBe(false);
    expect(listBeside(0)).toBe(false);
  });
});
