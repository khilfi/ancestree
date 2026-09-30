import { useStore } from "@xyflow/react";
import { memo } from "react";
import { RING_LINE, ringStroke } from "./colours";
import type { Guide } from "./layouts";
import type { RingLayout } from "./rings";

type Props = Pick<RingLayout, "rings" | "tray"> & {
  guides: Guide[];
  tinted?: boolean; // coloured by generation: each ring and row takes its generation's tint
};

/** The other layouts' rows and bands: a generation's row in the family tree and the
 *  hourglass, a generation's half-circle in the fan chart. */
function GuideLine({ guide, tinted }: { guide: Guide; tinted: boolean }) {
  if (guide.kind === "row") {
    return (
      <line
        x1={guide.x1}
        y1={guide.y}
        x2={guide.x2}
        y2={guide.y}
        stroke={ringStroke(guide.generation, tinted)}
        strokeWidth={1.5}
      />
    );
  }
  if (guide.kind === "arc") {
    const r = guide.radius;
    return (
      <path
        d={`M ${-r},0 A ${r} ${r} 0 0 1 ${r},0`}
        fill="none"
        stroke={RING_LINE}
        strokeWidth={1.5}
      />
    );
  }
  if (guide.kind === "line") {
    return (
      <line
        x1={guide.x1}
        y1={guide.y1}
        x2={guide.x2}
        y2={guide.y2}
        stroke={RING_LINE}
        strokeWidth={1.5}
      />
    );
  }
  return null;
}

function guideLabel(guide: Guide): { x: number; y: number; label: string; start: boolean } | null {
  if (guide.kind === "row")
    return { x: guide.x1, y: guide.y - 22, label: guide.label, start: true };
  if (guide.kind === "arc") return { x: -guide.radius, y: 8, label: guide.label, start: false };
  if (guide.kind === "text") return { x: guide.x, y: guide.y, label: guide.label, start: false };
  return null;
}

/** The rings, their labels and the tray, in the tree's own coordinates. Drawn once: only the
 *  transform around it changes as the view pans and zooms. A married-in family's rings are
 *  drawn and named like the main ones, in the tree's own generations. */
const Drawing = memo(function Drawing({ rings, tray, guides, tinted = false }: Props) {
  return (
    <>
      <svg
        className="absolute top-0 left-0 overflow-visible"
        width={1}
        height={1}
        aria-hidden="true"
      >
        {/* Solid, not dashed: a dashed ring thousands of pixels round costs a frame to draw. */}
        {rings.map((ring) => (
          <circle
            key={`${ring.unit}:${ring.generation}`}
            cx={ring.x}
            cy={ring.y}
            r={ring.radius}
            fill="none"
            stroke={ringStroke(ring.generation, tinted)}
            strokeWidth={1.5}
          />
        ))}
        {guides.map((guide, index) => (
          // Guides only change all together, with the layout.
          // biome-ignore lint/suspicious/noArrayIndexKey: a new layout draws a new set
          <GuideLine key={index} guide={guide} tinted={tinted} />
        ))}
      </svg>
      {guides.map((guide, index) => {
        const label = guideLabel(guide);
        if (!label) return null;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            key={`label:${index}`}
            className="absolute top-0 left-0 px-1 text-[11px] whitespace-nowrap text-stone-500"
            style={{
              transform: `translate(${label.x}px, ${label.y}px)${label.start ? "" : " translate(-50%, 0)"}`,
            }}
          >
            {label.label}
          </div>
        );
      })}
      {rings.map((ring) => (
        <div
          key={`label:${ring.unit}:${ring.generation}`}
          className="absolute top-0 left-0 px-1 text-[11px] whitespace-nowrap text-stone-500"
          style={{
            transform: `translate(${ring.x}px, ${ring.y - ring.radius}px) translate(-50%, -140%)`,
          }}
        >
          Generation {ring.generation}
        </div>
      ))}
      {tray && (
        <div
          className="absolute top-0 left-0 rounded-2xl border-2 border-dashed border-amber-300"
          style={{
            transform: `translate(${tray.x}px, ${tray.y}px)`,
            width: tray.width,
            height: tray.height,
          }}
        >
          <span className="absolute -top-3 left-4 rounded bg-amber-50 px-2 text-xs font-medium text-amber-800">
            Not linked yet
          </span>
        </div>
      )}
    </>
  );
});

/**
 * Quiet rings with their generation labels, and the "Not linked yet" tray, beneath the links,
 * people and names. React Flow draws its viewport portal after the people, so
 * this is a layer of its own under the whole canvas, following the view as the background
 * pattern does.
 */
export function RingsBackdrop(props: Props) {
  const [x, y, zoom] = useStore((state) => state.transform);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
      aria-hidden="true"
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}
      >
        <Drawing {...props} />
      </div>
    </div>
  );
}
