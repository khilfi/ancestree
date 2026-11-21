import { type ReactFlowState, useOnViewportChange, useReactFlow, useStore } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { NODE_HEIGHT, NODE_WIDTH } from "./geometry";

/** Room kept between the person and the canvas's edge, and below them for + Parent, + Child and
 *  + Spouse, which are as wide as `BUTTONS` at any zoom. */
const MARGIN = 48;
const BELOW = 40;
const BUTTONS = 200; // px
/** A search's flight to someone (600 ms), and a little more: the view is left to it meanwhile,
 *  then checked once it has landed. */
const FLIGHT = 650; // ms

type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
/** A corner of the canvas that something stands over, from `left` to `right` and from `top` to
 *  its bottom edge: the overview map, at the bottom left. */
type Corner = { left: number; top: number; right: number };

/** How far to move the view so a rectangle on screen is inside a box of this size, with room
 *  round it, and clear of a corner covered: nothing when it's in view already, else just
 *  enough. */
export function nudge(rect: Rect, size: Size, corner?: Corner): { x: number; y: number } {
  const along = (start: number, end: number, length: number, before: number, after: number) => {
    if (end - start > length - before - after) return 0; // wider than the canvas: leave it
    if (start < before) return before - start;
    if (end > length - after) return length - after - end;
    return 0;
  };
  const x = along(rect.left, rect.right, size.width, MARGIN, MARGIN);
  // Above the corner, where they'd be over it once moved.
  const over = corner && rect.right + x > corner.left && rect.left + x < corner.right;
  const height = over ? corner.top : size.height;
  return { x, y: along(rect.top, rect.bottom, height, MARGIN, MARGIN + BELOW) };
}

/** Someone on the tree, where React Flow has them: their size measured, or as drawn. */
type Drawn = {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

/** Whether anyone is wholly or partly on a canvas of this size, in this view. */
export function anyoneInView(
  people: Drawn[],
  view: { x: number; y: number; zoom: number },
  size: Size,
): boolean {
  return people.some(({ position, measured }) => {
    const left = position.x * view.zoom + view.x;
    const top = position.y * view.zoom + view.y;
    const width = (measured?.width ?? NODE_WIDTH) * view.zoom;
    const height = (measured?.height ?? NODE_HEIGHT) * view.zoom;
    return left + width > 0 && left < size.width && top + height > 0 && top < size.height;
  });
}

/**
 * Never an empty canvas after someone has gone from the tree: the view follows the person
 * chosen, at the first view's zoom often into a corner of their own, such as "Not linked yet"
 * for someone just added, and Undo of adding them took it away, leaving nothing in view. When
 * fewer are drawn and no one is in view, the first view comes back. Not while a search flies to
 * someone (`waiting`), and never for your own panning, which draws no one fewer.
 *
 * While the view is moving, it's where it stops that counts. With Undo pressed twice, quickly,
 * the view was still gliding after her into her corner as she went: someone was in view at that
 * moment, so it was left to land on an empty canvas.
 */
export function useNeverEmpty(
  box: RefObject<HTMLDivElement | null>,
  drawn: Drawn[],
  showFirst: (duration: number) => void,
  waiting: boolean,
) {
  const { getViewport } = useReactFlow();
  const now = useRef({ drawn, showFirst });
  now.current = { drawn, showFirst };
  const look = useCallback(() => {
    const element = box.current;
    const { drawn, showFirst } = now.current;
    if (!element || drawn.length === 0) return;
    const size = { width: element.clientWidth, height: element.clientHeight };
    if (size.width > 0 && !anyoneInView(drawn, getViewport(), size)) showFirst(500);
  }, [box, getViewport]);

  // Moves under way, counted: a glide cut short by the next says it has ended only after the
  // next has begun.
  const moves = useRef(0);
  const later = useRef(false); // someone went as it moved: look once it stops
  const onStart = useCallback(() => {
    moves.current += 1;
  }, []);
  const onEnd = useCallback(() => {
    moves.current = Math.max(0, moves.current - 1);
    if (moves.current > 0 || !later.current) return;
    later.current = false;
    look();
  }, [look]);
  useOnViewportChange({ onStart, onEnd }); // React Flow keeps one such listener: this one

  const before = useRef(drawn.length);
  useEffect(() => {
    const fewer = drawn.length < before.current;
    before.current = drawn.length;
    if (!fewer || waiting) return;
    look();
    if (moves.current > 0) later.current = true;
  }, [drawn, waiting, look]);
}

/** The canvas's bottom left corner, where the overview map stands, or its button once
 *  it's hidden, if either is shown. */
function covered(canvas: HTMLElement | null): Corner | undefined {
  const map = canvas?.querySelector(".react-flow__panel.bottom.left");
  if (!canvas || !map) return undefined;
  const [outer, inner] = [canvas.getBoundingClientRect(), map.getBoundingClientRect()];
  if (inner.width === 0) return undefined; // hidden, on a narrow window
  return {
    left: inner.left - outer.left - 8,
    top: inner.top - outer.top - 8,
    right: inner.right - outer.left + 8,
  };
}

/** Where someone is on the tree: not drawn, being dragged, or their place. */
type Place = null | "dragging" | `${number},${number}`;

/**
 * The person chosen stays in view, with room below them for + Parent, + Child and
 * + Spouse:
 * - when their panel opens beside the tree, or is made wider, the canvas narrows from the
 *   right, and someone near that edge would be under the panel: the view moves at once;
 * - when someone is chosen out of sight, as a relative opened from the panel or someone just
 *   added, or moves out of sight, as when a parent added seats them on the rings, it glides
 *   after them.
 * - when a search's flight to them (`flying`) lands, as their panel opening meanwhile can leave
 *   them under it.
 * Only as far as it must, and never for your own panning, while they're dragged, as the tree
 * first opens on them, or while a search flies to them.
 */
export function useKeepInView(
  box: RefObject<HTMLDivElement | null>,
  personId: string | null,
  flying: boolean,
) {
  const { getInternalNode, getViewport, setViewport } = useReactFlow();
  const chosen = useRef(personId);
  chosen.current = personId;
  const inFlight = useRef(false);
  const keep = useCallback(
    (size: Size, glide: boolean) => {
      const node = chosen.current ? getInternalNode(chosen.current) : undefined;
      if (!node || inFlight.current) return;
      const { x, y, zoom } = getViewport();
      const at = node.internals.positionAbsolute;
      const width = (node.measured.width ?? NODE_WIDTH) * zoom;
      const middle = at.x * zoom + x + width / 2;
      const top = at.y * zoom + y;
      const bottom = top + (node.measured.height ?? NODE_HEIGHT) * zoom;
      // Them, and the buttons centred below them, however far out the tree is, clear of the
      // overview map in the corner.
      const half = Math.max(width, BUTTONS) / 2;
      const by = nudge(
        { left: middle - half, top, right: middle + half, bottom },
        size,
        covered(box.current),
      );
      if (by.x || by.y) {
        setViewport({ x: x + by.x, y: y + by.y, zoom }, glide ? { duration: 300 } : undefined);
      }
    },
    [box, getInternalNode, getViewport, setViewport],
  );

  // A search flies to them, centred on the canvas as it was: its panel opening meanwhile can
  // leave them under it, so once it lands, they're kept in view. A timer rather than the clock,
  // which a test may stop.
  const landing = useRef(0);
  useEffect(() => {
    if (!flying) return;
    inFlight.current = true;
    window.clearTimeout(landing.current);
    landing.current = window.setTimeout(() => {
      inFlight.current = false;
      const element = box.current;
      if (element) keep({ width: element.clientWidth, height: element.clientHeight }, true);
    }, FLIGHT);
  }, [flying, box, keep]);
  useEffect(() => () => window.clearTimeout(landing.current), []);

  // The canvas narrowed, or widened.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && keep(entry.contentRect, false));
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, keep]);

  // Chosen, drawn, or moved on the tree.
  const place = useStore(
    useCallback(
      (state: ReactFlowState): Place => {
        const node = personId ? state.nodeLookup.get(personId) : undefined;
        if (!node) return null;
        if (node.dragging) return "dragging";
        const at = node.internals.positionAbsolute;
        return `${at.x},${at.y}`;
      },
      [personId],
    ),
  );
  const last = useRef<{ id: string | null; place: Place }>({ id: null, place: null });
  const opened = useRef(personId); // chosen as the tree opens: its first view is its own
  useEffect(() => {
    const before = last.current;
    last.current = { id: personId, place };
    if (place === null || place === "dragging" || before.place === "dragging") return;
    if (before.id === personId && before.place === place) return;
    if (personId === opened.current) {
      opened.current = null;
      return;
    }
    const element = box.current;
    if (element) keep({ width: element.clientWidth, height: element.clientHeight }, true);
  }, [personId, place, box, keep]);
}
