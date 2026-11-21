// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { initialsPicture, PersonAvatar } from "./PersonAvatar";

/*
 * A photo's circle while its photo is on its way: the person's initials, never
 * an empty ring. On the map, while its detail downloads, the photos were slow to come and every
 * person was a faint empty ring.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const HASSAN = {
  id: "a856b0e6-09eb-5763-a539-f73802614c7e",
  full_name: "Hassan bin Ismail",
  photo_version: 1,
  placeholder: false,
};

function show(person: typeof HASSAN): HTMLImageElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<PersonAvatar person={person} size="sm" />));
  return container.querySelector("img") as HTMLImageElement;
}

describe("a photo on its way", () => {
  it("shows the person's initials until it has come", () => {
    const photo = show(HASSAN);
    expect(photo.alt).toBe("Hassan bin Ismail");
    expect(photo.style.backgroundImage).toContain("data:image/svg+xml");
    expect(decodeURIComponent(photo.style.backgroundImage)).toContain(">H</text>");
    act(() => {
      photo.dispatchEvent(new Event("load"));
    });
    expect(photo.style.backgroundImage).toBe("");
  });

  it("keeps them if it never comes", () => {
    const photo = show(HASSAN);
    act(() => {
      photo.dispatchEvent(new Event("error"));
    });
    expect(decodeURIComponent(photo.style.backgroundImage)).toContain(">H</text>");
  });

  it("shows them again for a new photo, until it has come", () => {
    const photo = show(HASSAN);
    act(() => {
      photo.dispatchEvent(new Event("load"));
    });
    act(() => root?.render(<PersonAvatar person={{ ...HASSAN, photo_version: 2 }} size="sm" />));
    expect(photo.style.backgroundImage).toContain("data:image/svg+xml");
  });

  it("writes initials safely, whatever the name", () => {
    const picture = decodeURIComponent(initialsPicture("<Ali> & 'Abu'"));
    expect(picture).not.toContain("<Ali>");
    expect(picture).toContain("<text");
  });
});
