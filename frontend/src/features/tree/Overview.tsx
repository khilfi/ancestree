import { Panel, useReactFlow, useStore } from "@xyflow/react";
import { MapIcon, XIcon } from "lucide-react";
import { memo, type PointerEvent, useMemo, useState } from "react";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { DRAWING } from "@/styles/drawing";
import { NODE_WIDTH, PHOTO, SMALL_PHOTO } from "./geometry";
import type { PersonFlowNode } from "./PersonNode";

const WIDTH = 160;
const HEIGHT = 120;
// Drawn only on a canvas this big at least: on a narrow one, as when the panel opens beside the
// tree in a small window, it would cover too much of it.
const ROOM = { width: 640, height: 400 };
const HIDDEN = "ancestree:tree-overview-hidden";

type Box = { x: number; y: number; w: number; h: number };
type Dots = { colour: string; path: string }[];

function hiddenHere(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN) === "yes";
  } catch {
    return false; // private windows and blocked storage: shown
  }
}

function keepHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN, "yes");
    else window.localStorage.removeItem(HIDDEN);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

/**
 * The minimap. Everyone is a dot in one path per colour, so it costs the same for 90 people
 * as for 2,000 (React Flow's own minimap draws each person separately). The dots stay put
 * while the view moves; only the small viewport box is redrawn. Click or drag to move there.
 *
 * Small, at the canvas's bottom left: the panel opens on the right, so it never moves
 * over the tree as the panel does; and it can be hidden, as this browser remembers.
 */
export function Overview({ nodes }: { nodes: PersonFlowNode[] }) {
  const { setCenter, getZoom } = useReactFlow();
  const { box, dots, radius } = useMemo(() => overview(nodes), [nodes]);
  const roomy = useStore((s) => s.width >= ROOM.width && s.height >= ROOM.height);
  const [hidden, setHidden] = useState(hiddenHere);
  if (nodes.length === 0 || !roomy) return null;

  const hide = (now: boolean) => {
    setHidden(now);
    keepHidden(now);
  };
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = box.x + ((event.clientX - rect.left) / rect.width) * box.w;
    const y = box.y + ((event.clientY - rect.top) / rect.height) * box.h;
    setCenter(x, y, { zoom: getZoom() });
  };

  return (
    // On a phone or an upright tablet it would cover much of the tree, and a finger moves round
    // faster anyway.
    <Panel position="bottom-left" className="!m-3 max-lg:hidden">
      {hidden ? (
        <Hint label="Show the overview of the whole tree">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Show the overview"
            className="bg-card shadow-sm"
            onClick={() => hide(false)}
          >
            <MapIcon />
          </Button>
        </Hint>
      ) : (
        <div className="relative">
          <div
            className="relative cursor-pointer overflow-hidden rounded-md border border-border bg-card/90 shadow-sm"
            style={{ width: WIDTH, height: HEIGHT }}
            role="img"
            aria-label="The whole tree: click or drag to move there"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              moveTo(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event);
            }}
          >
            <DotsLayer box={box} dots={dots} radius={radius} />
            <ViewportBox box={box} />
          </div>
          <Hint label="Hide the overview">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Hide the overview"
              className="absolute top-0.5 right-0.5 bg-card/80"
              onClick={() => hide(true)}
            >
              <XIcon />
            </Button>
          </Hint>
        </div>
      )}
    </Panel>
  );
}

function overview(nodes: PersonFlowNode[]): { box: Box; dots: Dots; radius: number } {
  const byColour = new Map<string, string[]>();
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    const x = Math.round(node.position.x + NODE_WIDTH / 2);
    const y = Math.round(node.position.y + (node.type === "unknown" ? SMALL_PHOTO : PHOTO) / 2);
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
    const colour = node.data.colour ?? DRAWING.line;
    const list = byColour.get(colour);
    if (list) list.push(`M${x} ${y}h0`);
    else byColour.set(colour, [`M${x} ${y}h0`]);
  }
  // The minimap's own shape, with a margin, whatever the family's shape.
  const margin = Math.max(right - left, bottom - top, 400) * 0.08;
  let [w, h] = [right - left + 2 * margin, bottom - top + 2 * margin];
  if (w / h > WIDTH / HEIGHT) h = (w * HEIGHT) / WIDTH;
  else w = (h * WIDTH) / HEIGHT;
  return {
    box: { x: (left + right - w) / 2, y: (top + bottom - h) / 2, w, h },
    dots: [...byColour].map(([colour, list]) => ({ colour, path: list.join("") })),
    radius: Math.max((w / WIDTH) * 1.2, PHOTO / 2), // at least a pixel, at most a photo
  };
}

const DotsLayer = memo(function DotsLayer({
  box,
  dots,
  radius,
}: {
  box: Box;
  dots: Dots;
  radius: number;
}) {
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="absolute inset-0"
      aria-hidden="true"
    >
      {dots.map(({ colour, path }) => (
        <path
          key={colour}
          d={path}
          stroke={colour}
          strokeWidth={radius * 2}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
});

/** What's on screen now: redrawn on its own layer as the view moves. */
function ViewportBox({ box }: { box: Box }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      className="pointer-events-none absolute inset-0 will-change-transform"
      aria-hidden="true"
    >
      <rect
        x={-tx / zoom}
        y={-ty / zoom}
        width={width / zoom}
        height={height / zoom}
        fill={DRAWING.view}
        fillOpacity={0.08}
        stroke={DRAWING.view}
        strokeWidth={(box.w / WIDTH) * 1.5}
      />
    </svg>
  );
}
