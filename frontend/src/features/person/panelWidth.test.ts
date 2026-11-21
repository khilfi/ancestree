// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWidth, PANEL_WIDTH, saveWidth } from "./panelWidth";

// The person panel's width remembered, in this browser alone.
describe("the panel's width", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("opens as wide as it was last made", () => {
    expect(loadWidth()).toBe(PANEL_WIDTH);
    saveWidth(512.4);
    expect(loadWidth()).toBe(512);
  });

  it("is never narrower than the panel can be, nor anything but a width", () => {
    window.localStorage.setItem("ancestree:person-panel-width", "120");
    expect(loadWidth()).toBe(PANEL_WIDTH);
    window.localStorage.setItem("ancestree:person-panel-width", "wide");
    expect(loadWidth()).toBe(PANEL_WIDTH);
  });

  it("does without, where the browser keeps nothing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveWidth(500)).not.toThrow();
    expect(loadWidth()).toBe(PANEL_WIDTH);
  });
});
