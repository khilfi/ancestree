import { describe, expect, it } from "vitest";
import { refused } from "./rules";

const ENGINE = "http://127.0.0.1:51234";

describe("what the journeys' pages may reach", () => {
  it("lets the app reach its own engine", () => {
    expect(refused(`${ENGINE}/tree`, "GET")).toBeNull();
    expect(refused(`${ENGINE}/api/persons`, "POST")).toBeNull();
    expect(refused(`${ENGINE}/api/map/packs`, "GET")).toBeNull();
    expect(refused(`${ENGINE}/api/history/undo`, "POST")).toBeNull();
    expect(refused(`${ENGINE}/api/downloads`, "POST")).toBeNull();
    expect(refused("data:image/png;base64,AAAA", "GET")).toBeNull();
  });

  it("refuses everywhere outside this computer, by name or by address", () => {
    expect(refused("https://tiles.openfreemap.org/planet", "GET")).toBe("outside this computer");
    expect(refused("https://fonts.googleapis.com/css2", "GET")).toBe("outside this computer");
    expect(refused("http://localhost:51234/tree", "GET")).toBe("outside this computer");
    expect(refused("http://192.168.1.10/", "GET")).toBe("outside this computer");
    expect(refused("http://127.0.0.1.example.com/", "GET")).toBe("outside this computer");
  });

  it("refuses what would have the engine fetch from the internet", () => {
    expect(refused(`${ENGINE}/api/map/packs/world`, "POST")).toBe("a download of the map's");
    expect(refused(`${ENGINE}/api/map/countries/MY`, "POST")).toBe("a download of the map's");
    expect(refused(`${ENGINE}/api/map/online`, "PUT")).toBe("the map's online extra");
    expect(refused(`${ENGINE}/api/places/lookup`, "POST")).toBe("an address looked up online");
    expect(refused(`${ENGINE}/api/family-folder/sign-in`, "POST")).toBe("Google Drive");
    expect(refused(`${ENGINE}/api/desktop/update/check`, "POST")).toBe("the app's updates");
  });

  it("refuses opening a window on the desktop", () => {
    expect(refused(`${ENGINE}/api/downloads/show`, "POST")).toBe("a window on the desktop");
  });
});
