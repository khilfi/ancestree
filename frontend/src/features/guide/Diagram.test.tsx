// @vitest-environment jsdom
/**
 * The guide's diagrams: written in the guide as Mermaid and drawn by it, at its
 * strictest; its text shown where one can't be drawn. jsdom lays out no SVG, so Mermaid itself
 * is stood in for here; the app's own check draws real ones under the page's policy.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { until } from "@/viewer/looking";
import { Diagram } from "./Diagram";
import { GuideText } from "./GuideText";
import { readGuide } from "./guide";

const drawer = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, text: string) => ({
    svg: `<svg id="${id}"><text>${text.split("\n").length} lines drawn</text></svg>`,
  })),
}));
vi.mock("mermaid", () => ({ default: drawer }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
async function show(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

describe("a diagram in the guide", () => {
  it("is drawn by Mermaid, at its strictest, with no scripts or links of its own", async () => {
    await show(<Diagram text={"flowchart LR\n  A --> B"} />);
    await until("2 lines drawn");
    expect(drawer.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
    expect(document.querySelector('.guide-diagram[role="img"] svg')).not.toBeNull();
  });

  it("shows its text where it can't be drawn", async () => {
    drawer.render.mockRejectedValueOnce(new Error("Parse error"));
    await show(<Diagram text="not a diagram at all" />);
    await until("not a diagram at all");
    expect(document.querySelector("pre.guide-diagram-text")).not.toBeNull();
  });

  it("is drawn where the guide writes one, as GitHub draws it", async () => {
    const [section] = readGuide(
      "# Steps\n\nFirst:\n\n```mermaid\nsequenceDiagram\n  A->>B: hello\n  B->>A: hello again\n```\n",
    ).sections;
    if (!section) throw new Error("no section");
    await show(
      <GuideText section={section} target={section.slug} onOpen={() => {}} onPicture={() => {}} />,
    );
    await until("3 lines drawn");
  });
});
