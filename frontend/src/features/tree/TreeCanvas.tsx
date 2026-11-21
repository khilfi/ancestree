import {
  Background,
  type Connection,
  type Edge,
  type NodeChange,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import {
  type FocusEvent,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSavePositions, useTreeSettings } from "@/api/queries";
import type { Graph, GraphPerson, KinRelation } from "@/api/types";
import { useCanEdit } from "@/app/copy";
import { ViewHead } from "@/components/ViewToolbar";
import { useOfferTreePicture } from "@/features/export/treePicture";
import { clustersToOpen, glowFor } from "@/features/kinship/glow";
import { RelatingBar } from "@/features/kinship/RelatingBar";
import { useMeId } from "@/features/me/useMeId";
import { useEscape } from "@/lib/escape";
import { typing } from "@/lib/keyboard";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { DRAWING } from "@/styles/drawing";
import { AddBeside } from "./AddBeside";
import { ChildEdge, type ChildEdgeData, PairEdge, SpouseEdge, type SpouseEdgeData } from "./edges";
import { familyMembers } from "./families";
import { applyFilter, drawnFrom, NO_FILTER, type TreeView, writeView } from "./filters";
import { type Around, firstView, readingOrder } from "./firstView";
import {
  BIG_FAMILY,
  everything,
  type Folding,
  initialFolding,
  loadFolding,
  openUnits,
  saveFolding,
  toggled,
  unfolded,
} from "./folding";
import { NODE_WIDTH, PHOTO } from "./geometry";
import { useKeepInView, useNeverEmpty } from "./keepInView";
import { DEFAULT_DEPTH } from "./LayoutMenu";
import { type EdgePick, LinkEditor } from "./LinkEditor";
import { LinkPicker } from "./LinkPicker";
import {
  type Arrangement,
  familyTreeLayout,
  fanLayout,
  hourglassLayout,
  ringsArrangement,
} from "./layouts";
import { Overview } from "./Overview";
import { cardId, type PersonFlowNode, PersonNode } from "./PersonNode";
import type { TreeSnapshot } from "./picture";
import { RingsBackdrop } from "./RingsBackdrop";
import type { Point } from "./rings";
import { routesOf } from "./routing";
import { type TreeActions, TreeActionsContext } from "./TreeActions";
import { type Steps, TreeToolbar } from "./TreeToolbar";
import { type TreeEdge, toFlow } from "./toFlow";
import { focusFor } from "./trail";
import { UnknownParentCard } from "./UnknownParentCard";
import { shortName } from "./words";

/** Finding a relationship: from whom, whether the second person is still to be
 *  picked, and the relation whose path is lit. */
export type Relating = { from: string; picking: boolean; relation: KinRelation | null };

const nodeTypes = { person: PersonNode, unknown: PersonNode };
const edgeTypes = { child: ChildEdge, spouse: SpouseEdge, pair: PairEdge };
// Semantic zoom: further out than FAR, faces only; further than TINY, photos are
// dots, so what can't be seen (shadows, initials, arrowheads) isn't drawn either.
const FAR = 0.45;
const TINY = 0.2;
type Distance = "near" | "far" | "tiny";
const distanceAt = (zoom: number): Distance => (zoom < TINY ? "tiny" : zoom < FAR ? "far" : "near");
const CONNECTION_LINE = { stroke: DRAWING.dragging, strokeWidth: 2 };
const PRO_OPTIONS = { hideAttribution: true }; // React Flow is MIT; its credit isn't needed

/** Someone on the canvas as the keyboard and a screen reader meet them: a button named by
 *  their full name, described by their card; reached in reading order. */
function reachable(nodes: PersonFlowNode[]): PersonFlowNode[] {
  return readingOrder(nodes).map((node) => ({
    ...node,
    ariaRole: "button",
    ariaLabel: node.type === "unknown" ? "Unknown parent" : node.data.person.full_name,
    domAttributes: {
      "aria-roledescription": undefined,
      "aria-describedby": node.type === "unknown" ? undefined : cardId(node.id),
    },
  }));
}

type Pending =
  | { kind: "link"; source: GraphPerson; target: GraphPerson; at: Point }
  | { kind: "edit"; pick: EdgePick; at: Point }
  | { kind: "unknown"; id: string; at: Point };

const EVERYONE: TreeView = { layout: "rings", depth: null, filter: NO_FILTER, from: null };

export function TreeCanvas({
  graph,
  selectedId,
  onSelect,
  focusId = null,
  onFocused,
  readOnly = false,
  relating = null,
  onPick,
  onStopRelating,
  view = EVERYONE,
  onView,
  onFrom,
  steps,
}: {
  graph: Graph;
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusId?: string | null; // fly to this person (after a search)
  onFocused?: () => void;
  readOnly?: boolean;
  relating?: Relating | null;
  onPick?: (id: string) => void; // the second person, while finding a relationship
  onStopRelating?: () => void;
  view?: TreeView; // the layout and the filter, from the address
  onView?: (view: TreeView) => void;
  onFrom?: (id: string) => void; // draw the hourglass or fan chart from them
  steps?: Steps; // Back and Forward through those it was drawn from before
}) {
  const settings = useTreeSettings();
  const colours = readOnly ? "branch" : (settings.data?.colours ?? "branch");
  // How married-in families are placed: this computer's choice, or a copy's viewer's.
  const way = readOnly ? "fans" : (settings.data?.married_in ?? "fans");
  // Nothing on the canvas changes the family in the made-up sample or a view-only
  // copy. A copy still keeps its viewer's colours and folds; the sample doesn't.
  // What can be changed here: nothing in a view-only copy, the made-up sample, or on a
  // computer that only receives the family.
  const canEdit = useCanEdit();
  const fixed = readOnly || !canEdit;
  // Married-in families open unfolded, unless this browser remembers otherwise. The
  // generated sample is big, and opens folded; it isn't remembered.
  const [folding, setFolding] = useState<Folding>(() =>
    initialFolding(readOnly ? null : loadFolding(), graph.people.length),
  );
  useEffect(() => {
    if (!readOnly) saveFolding(folding);
  }, [folding, readOnly]);
  const clusters = useMemo(
    () => graph.layout.units.flatMap((unit) => (unit.anchor ? [unit.id] : [])),
    [graph],
  );
  const open = useMemo(() => openUnits(folding, clusters), [folding, clusters]);

  // Who the filter keeps, and their layout. The address gives a new
  // view object on every render, so its written form is what the memos follow.
  const viewKey = writeView(view).toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey stands for the view
  const kept = useMemo(() => applyFilter(graph, view.filter), [graph, viewKey]);
  const hideOthers = view.filter.others === "hidden";
  // Whom an hourglass or fan chart is (or would be) around: the Layout menu names them.
  const around = focusFor(graph, view, selectedId);
  const focus = drawnFrom(view.layout) ? around : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey stands for the view
  const layout = useMemo((): Arrangement => {
    const hidden = hideOthers ? kept : null;
    const depth = view.depth;
    if (view.layout === "tree") return familyTreeLayout(graph, open, hidden);
    if (view.layout === "hourglass" && focus) {
      return hourglassLayout(graph, focus, depth ?? DEFAULT_DEPTH.hourglass, hidden);
    }
    if (view.layout === "fan" && focus) {
      return fanLayout(graph, focus, depth ?? DEFAULT_DEPTH.fan, hidden);
    }
    return ringsArrangement(graph, open, hidden, way);
  }, [graph, open, kept, hideOthers, focus, viewKey, way]);
  const leaveCare = view.filter.leave.has("care");
  // "Me": who you are, to colour everyone by how close they are to you.
  const meId = useMeId();
  const me = readOnly ? null : meId;
  // The links between families, routed through the openings on the rings: worked out
  // again when someone moves or a link changes, not for a new colour.
  const routes = useMemo(
    () =>
      layout.layout === "rings"
        ? routesOf(
            toFlow(graph, layout, "off", { saved: true, care: !leaveCare, route: true }).edges,
          )
        : undefined,
    [graph, layout, leaveCare],
  );
  const flow = useMemo(
    () =>
      toFlow(graph, layout, colours, {
        me,
        saved: layout.layout === "rings",
        elbows: layout.elbows,
        faded: hideOthers ? null : kept,
        care: !leaveCare,
        routes,
      }),
    [graph, layout, colours, me, hideOthers, kept, leaveCare, routes],
  );
  const drawn = useMemo(() => reachable(flow.nodes), [flow.nodes]);
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonFlowNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [distance, setDistance] = useState<Distance>("near");
  const [moving, setMoving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useKeepInView(box, selectedId, focusId !== null); // never under their panel
  const { mutate: savePositions } = useSavePositions();
  const {
    fitView,
    zoomIn,
    zoomOut,
    setCenter,
    getZoom,
    getNode,
    getViewport,
    setViewport,
    flowToScreenPosition,
  } = useReactFlow();
  const people = useMemo(() => new Map(graph.people.map((person) => [person.id, person])), [graph]);
  // Zooming out stops once the whole family fits in a few hundred pixels, however big.
  const minZoom = useMemo(() => {
    const xs = flow.nodes.map((node) => node.position.x);
    const ys = flow.nodes.map((node) => node.position.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return size > 0 ? Math.min(0.03, 400 / size) : 0.03;
  }, [flow.nodes]);
  // The first view: names that can be read, around the family at the centre on the rings,
  // its oldest generations at the top of a family tree, or whom a chart is drawn from; the whole
  // family where it can be read so. Only what's on screen is drawn, so 2,000 people open as
  // quickly as 60. Show everyone, and F, frame the whole family.
  const opensAround = useMemo((): Around | null => {
    if (layout.layout === "rings") {
      const middle = layout.middles.get(graph.layout.units[0]?.id ?? "");
      return middle ? { point: middle, at: "middle" } : null;
    }
    if (layout.layout === "tree") {
      const top = layout.points.get(graph.layout.units[0]?.centre[0] ?? "");
      return top ? { point: top, at: "top" } : null;
    }
    const focused = layout.focus ? layout.points.get(layout.focus) : undefined;
    return focused ? { point: focused, at: "middle" } : null;
  }, [layout, graph]);
  const showFirst = useCallback(
    (duration: number) => {
      const size = { width: box.current?.clientWidth ?? 0, height: box.current?.clientHeight ?? 0 };
      // Whoever a filter hides isn't among the nodes.
      const view = firstView(flow.nodes, opensAround, size);
      if (view) setCenter(view.centre.x, view.centre.y, { zoom: view.zoom, duration });
    },
    [flow.nodes, opensAround, setCenter],
  );
  // React Flow calls onInit a moment after it's ready: by then a search's person may have been
  // flown to (below), which the first view mustn't undo.
  const flown = useRef(false);
  const onInit = useCallback(() => {
    if (!flown.current && !focusId) showFirst(0);
  }, [showFirst, focusId]);
  useNeverEmpty(box, nodes, showFirst, focusId !== null); // after Undo of adding someone

  // Finding a relationship: the person it starts from pulses while the second is picked;
  // then the path between them glows and everyone else fades.
  const relation = relating?.relation ?? null;
  const glow = useMemo(
    () => (relation ? glowFor(relation, flow.edges) : null),
    [relation, flow.edges],
  );
  const pulsing = relating?.picking ? relating.from : null;
  // A family or branch hovered in the Centre menu: everyone else fades meanwhile.
  const [highlight, setHighlight] = useState<ReadonlySet<string> | null>(null);

  // New data (someone added, a link changed, a cluster unfolded, a relationship found):
  // redraw from it. The selection follows the address (?person=), so it's applied here,
  // not by clicking.
  const selected = useRef(selectedId);
  useEffect(() => {
    selected.current = selectedId;
    setNodes((current) =>
      current.map((node) =>
        node.selected === (node.id === selectedId)
          ? node
          : { ...node, selected: node.id === selectedId },
      ),
    );
  }, [selectedId, setNodes]);
  useEffect(() => {
    // The glow joins whatever the node already has, such as a filter's fading.
    const also = (className: string | undefined, add: string) =>
      className ? `${className} ${add}` : add;
    const lit = (...ids: string[]) => !highlight || ids.every((id) => highlight.has(id));
    const mark = (node: PersonFlowNode): PersonFlowNode => {
      if (!lit(node.id)) return { ...node, className: also(node.className, "tree-faded") };
      if (node.id === pulsing) return { ...node, className: also(node.className, "kin-from") };
      return glow?.people.has(node.id)
        ? { ...node, className: also(node.className, "kin-path") }
        : node;
    };
    setNodes(
      drawn.map((node) => mark(node.id === selected.current ? { ...node, selected: true } : node)),
    );
    setEdges(
      flow.edges.map((edge: TreeEdge) =>
        !lit(edge.source, edge.target)
          ? { ...edge, className: also(edge.className, "tree-faded") }
          : glow?.edges.has(edge.id)
            ? { ...edge, className: also(edge.className, "kin-path") }
            : edge,
      ) as Edge[],
    );
  }, [drawn, flow.edges, glow, pulsing, highlight, setNodes, setEdges]);

  // A new layout, filter, centre or person at the middle of an hourglass: its first view again,
  // once it's drawn.
  const centreNow = graph.layout.units[0]?.centre.join("+") ?? "";
  const viewNow = `${layout.layout}|${focus}|${viewKey}|${centreNow}`;
  const lastView = useRef(viewNow);
  const refit = useRef(false);
  useEffect(() => {
    if (lastView.current === viewNow) return;
    lastView.current = viewNow;
    refit.current = true;
  }, [viewNow]);
  useEffect(() => {
    if (!refit.current || nodes.length === 0) return;
    // Still wanted until it's done: another render before the frame (the history and the
    // graph arriving one after the other, after an Undo) cancels it and asks again.
    const frame = window.requestAnimationFrame(() => {
      refit.current = false;
      showFirst(500);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes, showFirst]);

  // A new answer: open any folded family on its path, then bring the whole path into view.
  const graphNow = useRef(graph);
  graphNow.current = graph;
  const fitTo = useRef<string[] | null>(null);
  useEffect(() => {
    if (!relation) return;
    const people = [...relation.path, ...relation.shared_ancestors];
    const folded = clustersToOpen(graphNow.current, people);
    if (folded.length) setFolding((now) => unfolded(now, folded));
    fitTo.current = people;
  }, [relation]);

  // Search and the panel reach anyone: the family holding them unfolds. Only when
  // they're chosen, so folding that family away again afterwards stays folded.
  useEffect(() => {
    const wanted = [focusId, selectedId].filter((id): id is string => Boolean(id));
    const folded = clustersToOpen(graphNow.current, wanted);
    if (folded.length) setFolding((now) => unfolded(now, folded));
  }, [focusId, selectedId]);
  useEffect(() => {
    const ids = fitTo.current;
    if (!ids) return;
    const shown = new Set(nodes.map((node) => node.id));
    if (!ids.every((id) => shown.has(id))) return;
    fitTo.current = null;
    fitView({ nodes: ids.map((id) => ({ id })), duration: 600, padding: 0.3, maxZoom: 1 });
  }, [nodes, fitView]);

  // Show, in the Centre menu: a family unfolds, if it was folded away, and comes into
  // view. Whoever a filter hides is left out of the framing.
  const [showing, setShowing] = useState<string[] | null>(null);
  const showFamily = useCallback(
    (unit: string) => {
      const ids = familyMembers(graphNow.current, unit).filter(
        (id) => !hideOthers || kept === null || kept.has(id),
      );
      if (clusters.includes(unit)) setFolding((now) => unfolded(now, [unit]));
      if (ids.length) setShowing(ids);
    },
    [clusters, hideOthers, kept],
  );
  useEffect(() => {
    if (!showing) return;
    const shown = new Set(nodes.map((node) => node.id));
    if (!showing.every((id) => shown.has(id))) return;
    setShowing(null);
    fitView({ nodes: showing.map((id) => ({ id })), duration: 600, padding: 0.2, maxZoom: 1 });
  }, [showing, nodes, fitView]);

  // Fly to someone found by search, keeping the zoom readable.
  useEffect(() => {
    const node = focusId ? nodes.find((candidate) => candidate.id === focusId) : undefined;
    if (!node) return;
    flown.current = true;
    setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 40, {
      zoom: Math.max(getZoom(), 0.9),
      duration: 600,
    });
    onFocused?.();
  }, [focusId, nodes, getZoom, setCenter, onFocused]);

  const relative = useCallback((screen: Point): Point => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: screen.x - rect.left, y: screen.y - rect.top } : screen;
  }, []);
  const bounds = {
    width: box.current?.clientWidth ?? 800,
    height: box.current?.clientHeight ?? 600,
  };

  const actions = useMemo<TreeActions>(
    () => ({
      readOnly: fixed, // no linking by dragging, nor filling in an unknown parent
      toggleFold: (unit) => setFolding((now) => toggled(now, unit)),
    }),
    [fixed],
  );

  // Esc closes what's on top: an open card, or finding a relationship, whichever opened
  // last, once a menu or a dialog over them has closed. It works even from a card's search box.
  useEscape(() => setPending(null), pending !== null);
  useEscape(() => onStopRelating?.(), Boolean(relating));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "f" || event.key === "F") fitView({ duration: 400 });
      else if (event.key === "+" || event.key === "=") zoomIn({ duration: 200 });
      else if (event.key === "-") zoomOut({ duration: 200 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitView, zoomIn, zoomOut]);

  const onConnect = useCallback(
    ({ source, target }: Connection) => {
      const [from, to] = [people.get(source), people.get(target)];
      const node = getNode(target);
      if (!from || !to || !node || source === target) return;
      const at = relative(
        flowToScreenPosition({ x: node.position.x + NODE_WIDTH / 2, y: node.position.y + 56 }),
      );
      setPending({ kind: "link", source: from, target: to, at });
    },
    [people, getNode, relative, flowToScreenPosition],
  );

  const onEdgeClick = useCallback(
    (event: MouseEvent, edge: Edge) => {
      if (fixed || relating) return;
      const at = relative({ x: event.clientX, y: event.clientY });
      let pick: EdgePick | null = null;
      if (edge.type === "child")
        pick = { type: "child", links: (edge.data as ChildEdgeData).links };
      else if (edge.type === "spouse")
        pick = { type: "spouse", link: (edge.data as SpouseEdgeData).link };
      else if (edge.type === "pair") pick = { type: "pair", a: edge.source, b: edge.target };
      if (pick) setPending({ kind: "edit", pick, at });
    },
    [fixed, relating, relative],
  );

  // Someone clicked, or reached by Tab and opened with Enter, at a point on screen.
  const openNode = useCallback(
    (node: PersonFlowNode, at: Point) => {
      if (relating) {
        // Finding a relationship: a click picks the second person (an unknown parent can't be).
        if (node.type !== "unknown" && node.id !== relating.from) onPick?.(node.id);
        return;
      }
      if (node.type === "unknown") {
        if (!fixed) setPending({ kind: "unknown", id: node.id, at: relative(at) });
        return;
      }
      setPending(null);
      onSelect(node.id);
    },
    [fixed, relating, relative, onSelect, onPick],
  );
  const onNodeClick = useCallback(
    (event: MouseEvent, node: PersonFlowNode) =>
      openNode(node, { x: event.clientX, y: event.clientY }),
    [openNode],
  );
  // Enter, or Space, on someone opens them, as a click does; at their photo.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const element = event.target as HTMLElement;
      if (!element.classList.contains("react-flow__node")) return;
      const node = getNode(element.dataset.id ?? "") as PersonFlowNode | undefined;
      if (!node) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      openNode(node, { x: rect.left + rect.width / 2, y: rect.top + (PHOTO / 2) * getZoom() });
    },
    [getNode, getZoom, openNode],
  );
  // Someone the keyboard reaches is brought into view with their card, as a page scrolls to
  // what has the focus: only as far as it takes.
  const onFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const element = event.target as HTMLElement;
      const canvas = box.current?.getBoundingClientRect();
      if (!canvas || !element.classList.contains("react-flow__node")) return;
      if (!element.matches(":focus-visible")) return;
      const seen = [element, element.querySelector(".person-card")]
        .map((each) => each?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => !!rect && rect.width > 0);
      const [left, right] = [
        Math.min(...seen.map((rect) => rect.left)),
        Math.max(...seen.map((rect) => rect.right)),
      ];
      const [top, bottom] = [
        Math.min(...seen.map((rect) => rect.top)),
        Math.max(...seen.map((rect) => rect.bottom)),
      ];
      const room = 8;
      const by = (low: number, high: number, from: number, to: number) =>
        low < from + room ? from + room - low : high > to - room ? to - room - high : 0;
      const [dx, dy] = [
        by(left, right, canvas.left, canvas.right),
        by(top, bottom, canvas.top, canvas.bottom),
      ];
      if (!dx && !dy) return;
      const { x, y, zoom } = getViewport();
      void setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 200 });
    },
    [getViewport, setViewport],
  );

  // In an hourglass or fan chart, a double-click draws it from them; a click only opens
  // their panel, above.
  const onNodeDoubleClick = useCallback(
    (_: MouseEvent, node: PersonFlowNode) => {
      if (relating || node.type === "unknown" || !drawnFrom(view.layout)) return;
      onFrom?.(node.id);
    },
    [relating, view.layout, onFrom],
  );
  // The mouse's back and forward buttons step through those it was drawn from, rather than
  // through the pages: the browser goes back on the button's release, unless told not to.
  const stepsNow = useRef(steps);
  stepsNow.current = steps;
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onMouseUp = (event: globalThis.MouseEvent) => {
      const now = stepsNow.current;
      const by = event.button === 3 ? -1 : event.button === 4 ? 1 : 0;
      if (!by || !now || !(by < 0 ? now.back : now.forward)) return;
      event.preventDefault();
      now.onStep(by);
    };
    element.addEventListener("mouseup", onMouseUp);
    return () => element.removeEventListener("mouseup", onMouseUp);
  }, []);

  // Handlers keep their identity: React Flow stores each new one, and every store update
  // reaches every person and link on screen (it adds up while dragging among 500 people).
  const onChange = useCallback(
    // The selection follows the address: a click the unsaved-changes guard stops must not
    // highlight the wrong person.
    (changes: NodeChange<PersonFlowNode>[]) =>
      onNodesChange(changes.filter((change) => change.type !== "select")),
    [onNodesChange],
  );
  const onPaneClick = useCallback(() => setPending(null), []);
  const isValidConnection = useCallback(
    (connection: Edge | Connection) =>
      connection.source !== connection.target && !people.get(connection.source)?.placeholder,
    [people],
  );
  // Only places on the rings are kept: in the other layouts a move lasts until you
  // leave, as they're always worked out afresh.
  const keepsMoves = !fixed && layout.layout === "rings";
  const onNodeDragStop = useCallback(
    (_: unknown, __: unknown, dragged: PersonFlowNode[]) => {
      if (!keepsMoves) return;
      savePositions(
        dragged.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        { onError: showError },
      );
    },
    [keepsMoves, savePositions],
  );
  const onMove = useCallback(
    (_: unknown, viewport: Viewport) => setDistance(distanceAt(viewport.zoom)),
    [],
  );

  // The Export dialog draws the tree as it is now: where everyone is, folds and colours.
  const now = useRef<TreeSnapshot | null>(null);
  now.current = {
    nodes,
    edges: edges as TreeEdge[],
    rings: layout.rings,
    tray: layout.tray,
    guides: layout.guides,
    tinted: colours === "generation",
  };
  const snapshot = useCallback(() => now.current as TreeSnapshot, []);
  useOfferTreePicture(snapshot);

  const unknownChildren = (id: string) =>
    graph.links
      .filter((link) => link.type === "parent" && link.source === id)
      .flatMap((link) => people.get(link.target) ?? []);

  return (
    // The toolbar above the canvas, not over it; while finding a relationship, what to do
    // next in its place. Family facts starts below either.
    <div className="flex h-full flex-col">
      <ViewHead>
        {relating ? (
          <RelatingBar
            name={shortName(people.get(relating.from) ?? { full_name: "", nickname: null })}
            picking={relating.picking}
            onDone={() => onStopRelating?.()}
          />
        ) : (
          <TreeToolbar
            graph={graph}
            readOnly={readOnly}
            view={view}
            onView={onView}
            focus={around}
            steps={steps}
            shown={kept}
            onRearranged={() => {
              setMoving(true);
              window.setTimeout(() => setMoving(false), 700);
            }}
            families={{
              all: layout.layout === "rings" || layout.layout === "tree" ? clusters.length : 0,
              folded: clusters.length - open.size,
              big: graph.people.length > BIG_FAMILY,
            }}
            onFoldAll={(mode) => setFolding(everything(mode))}
            onShowFamily={showFamily}
            onHighlight={setHighlight}
          />
        )}
      </ViewHead>
      <div
        ref={box}
        className={cn(
          "relative min-h-0 flex-1",
          distance !== "near" && "tree-far",
          distance === "tiny" && "tree-tiny",
          moving && "tree-moving",
          relating && "tree-kin",
          glow && "tree-kin-result",
        )}
      >
        <TreeActionsContext.Provider value={actions}>
          <ReactFlow<PersonFlowNode, Edge>
            aria-label="The family tree"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            // A double-click on someone draws an hourglass or fan from them, not a zoom.
            zoomOnDoubleClick={!drawnFrom(view.layout)}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeDragStop={onNodeDragStop}
            onMove={onMove}
            // The made-up sample: moves aren't saved. A view-only copy: nothing moves at all.
            nodesDraggable={canEdit}
            nodesConnectable={!fixed}
            elementsSelectable={false}
            // People are Tab stops, opened with Enter (above); the lines aren't, and React Flow's
            // own keys (select, then move with the arrows) are off: moves are made by dragging.
            edgesFocusable={false}
            disableKeyboardA11y
            onlyRenderVisibleElements
            connectionRadius={40}
            connectionLineStyle={CONNECTION_LINE}
            onInit={onInit}
            minZoom={minZoom}
            maxZoom={2}
            proOptions={PRO_OPTIONS}
          >
            <RingsBackdrop
              rings={layout.rings}
              tray={layout.tray}
              guides={layout.guides}
              tinted={colours === "generation"}
            />
            <Background gap={32} color={DRAWING.canvasDots} />
            <Overview nodes={flow.nodes} />
            <AddBeside personId={fixed || relating ? null : selectedId} onOpen={onSelect} />
          </ReactFlow>
          {pending?.kind === "link" && (
            <LinkPicker
              source={pending.source}
              target={pending.target}
              at={pending.at}
              bounds={bounds}
              onClose={() => setPending(null)}
            />
          )}
          {pending?.kind === "edit" && (
            <LinkEditor
              pick={pending.pick}
              people={people}
              at={pending.at}
              bounds={bounds}
              onClose={() => setPending(null)}
            />
          )}
          {pending?.kind === "unknown" && (
            <UnknownParentCard
              id={pending.id}
              kids={unknownChildren(pending.id)}
              at={pending.at}
              bounds={bounds}
              onClose={() => setPending(null)}
            />
          )}
        </TreeActionsContext.Provider>
      </div>
    </div>
  );
}
