import {
  Background,
  type Connection,
  Controls,
  type Edge,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  type Rect,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSavePositions, useTreeSettings } from "@/api/queries";
import type { Graph, GraphPerson, KinRelation } from "@/api/types";
import { useCanEdit } from "@/app/copy";
import { useOfferTreePicture } from "@/features/export/treePicture";
import { clustersToOpen, glowFor } from "@/features/kinship/glow";
import { RelatingBar } from "@/features/kinship/RelatingBar";
import { useMeId } from "@/features/me/useMeId";
import { typing } from "@/lib/keyboard";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { ChildEdge, type ChildEdgeData, PairEdge, SpouseEdge, type SpouseEdgeData } from "./edges";
import { familyMembers } from "./families";
import { applyFilter, NO_FILTER, type TreeView, writeView } from "./filters";
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
import { type PersonFlowNode, PersonNode } from "./PersonNode";
import type { TreeSnapshot } from "./picture";
import { RingsBackdrop } from "./RingsBackdrop";
import type { Point } from "./rings";
import { type TreeActions, TreeActionsContext } from "./TreeActions";
import { TreeToolbar } from "./TreeToolbar";
import { type TreeEdge, toFlow } from "./toFlow";
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
const CROWD = 500; // people on screen at once that stay smooth
const CONNECTION_LINE = { stroke: "#0ea5e9", strokeWidth: 2 };

/** A big family opens on its middle, framing about CROWD people: only what's on screen is
 *  drawn, so 2,000 people still open in under a second. Fit shows everyone. */
function middleView(nodes: PersonFlowNode[], middle: Point, aspect: number): Rect {
  const reach =
    nodes
      .map(({ position }) =>
        Math.max(
          Math.abs(position.x + NODE_WIDTH / 2 - middle.x) / aspect,
          Math.abs(position.y + PHOTO / 2 - middle.y),
        ),
      )
      .sort((a, b) => a - b)[CROWD - 1] ?? 0;
  return {
    x: middle.x - reach * aspect,
    y: middle.y - reach,
    width: 2 * reach * aspect,
    height: 2 * reach,
  };
}

type Pending =
  | { kind: "link"; source: GraphPerson; target: GraphPerson; at: Point }
  | { kind: "edit"; pick: EdgePick; at: Point }
  | { kind: "unknown"; id: string; at: Point };

const EVERYONE: TreeView = { layout: "rings", depth: null, filter: NO_FILTER };

/** Whom an hourglass or fan chart is around: the filter's person, else whoever is open in
 *  the panel, else the centre of the rings. */
function focusFor(graph: Graph, view: TreeView, selectedId: string | null): string | null {
  const real = (id: string | null | undefined) =>
    id && graph.people.some((person) => person.id === id && !person.placeholder) ? id : null;
  return (
    real(view.filter.around) ??
    real(selectedId) ??
    graph.layout.units[0]?.centre.map(real).find(Boolean) ??
    null
  );
}

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
}) {
  const settings = useTreeSettings();
  const colours = readOnly ? "branch" : (settings.data?.colours ?? "branch");
  // Nothing on the canvas changes the family in the made-up sample or a view-only
  // copy. A copy still keeps its viewer's colours and folds; the sample doesn't.
  // What can be changed here: nothing in a view-only copy or the made-up sample;
  // in a copy to edit, what it allows.
  const canEdit = useCanEdit();
  const canAdd = useCanEdit("add");
  const canChange = useCanEdit("change");
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
  const focus = view.layout === "hourglass" || view.layout === "fan" ? around : null;
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
    return ringsArrangement(graph, open, hidden);
  }, [graph, open, kept, hideOthers, focus, viewKey]);
  const leaveCare = view.filter.leave.has("care");
  // "Me": who you are, to colour everyone by how close they are to you.
  const meId = useMeId();
  const me = readOnly ? null : meId;
  const flow = useMemo(
    () =>
      toFlow(graph, layout, colours, {
        me,
        saved: layout.layout === "rings",
        elbows: layout.elbows,
        faded: hideOthers ? null : kept,
        care: !leaveCare,
      }),
    [graph, layout, colours, me, hideOthers, kept, leaveCare],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonFlowNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [distance, setDistance] = useState<Distance>("near");
  const [moving, setMoving] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { mutate: savePositions } = useSavePositions();
  const { fitView, fitBounds, zoomIn, zoomOut, setCenter, getZoom, getNode, flowToScreenPosition } =
    useReactFlow();
  const people = useMemo(() => new Map(graph.people.map((person) => [person.id, person])), [graph]);
  // Zooming out stops once the whole family fits in a few hundred pixels, however big.
  const minZoom = useMemo(() => {
    const xs = flow.nodes.map((node) => node.position.x);
    const ys = flow.nodes.map((node) => node.position.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return size > 0 ? Math.min(0.03, 400 / size) : 0.03;
  }, [flow.nodes]);
  const big = flow.nodes.length > CROWD;
  const middle = big && layout.layout === "rings" ? layout.middles.get("main:0") : undefined;
  // A big family tree is far wider than any screen: it opens on its oldest generations, at a
  // size you can read, rather than as a thin line (Fit still shows everyone).
  const top =
    big && layout.layout === "tree"
      ? layout.points.get(graph.layout.units[0]?.centre[0] ?? "")
      : undefined;
  const start = useCallback(
    (instance: Pick<ReactFlowInstance<PersonFlowNode, Edge>, "fitBounds" | "setCenter">) => {
      if (middle) {
        const aspect = (box.current?.clientWidth || 800) / (box.current?.clientHeight || 600);
        instance.fitBounds(middleView(flow.nodes, middle, aspect), { padding: 0.02 });
        return true;
      }
      if (top) {
        const height = box.current?.clientHeight || 600;
        instance.setCenter(top.x, top.y + height * 0.7, { zoom: 0.7, duration: 400 });
        return true;
      }
      return false;
    },
    [middle, top, flow.nodes],
  );
  const onInit = useCallback(
    (instance: ReactFlowInstance<PersonFlowNode, Edge>) => {
      start(instance);
    },
    [start],
  );

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
      flow.nodes.map((node) =>
        mark(node.id === selected.current ? { ...node, selected: true } : node),
      ),
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
  }, [flow, glow, pulsing, highlight, setNodes, setEdges]);

  // A new layout, filter, centre or person at the middle of an hourglass: bring it all into
  // view once it's drawn (the first view is React Flow's own fitting).
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
      if (!start({ fitBounds, setCenter })) fitView({ duration: 500, padding: 0.12 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes, fitView, fitBounds, setCenter, start]);

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
      readOnly: fixed || !canAdd, // no linking by dragging, nor filling in an unknown parent
      toggleFold: (unit) => setFolding((now) => toggled(now, unit)),
    }),
    [fixed, canAdd],
  );

  // Escape closes an open card first; otherwise it ends finding a relationship.
  const onEscape = useRef(() => {});
  onEscape.current = () => {
    if (pending) setPending(null);
    else if (relating) onStopRelating?.();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape works even from a card's search box, unless a menu inside it took the key.
      if (event.key === "Escape") {
        if (!event.defaultPrevented) onEscape.current();
        return;
      }
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

  const onNodeClick = useCallback(
    (event: MouseEvent, node: PersonFlowNode) => {
      if (relating) {
        // Finding a relationship: a click picks the second person (an unknown parent can't be).
        if (node.type !== "unknown" && node.id !== relating.from) onPick?.(node.id);
        return;
      }
      if (node.type === "unknown") {
        if (!fixed && canAdd)
          setPending({
            kind: "unknown",
            id: node.id,
            at: relative({ x: event.clientX, y: event.clientY }),
          });
        return;
      }
      setPending(null);
      onSelect(node.id);
    },
    [fixed, canAdd, relating, relative, onSelect, onPick],
  );

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
  const keepsMoves = !fixed && canChange && layout.layout === "rings";
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
    <div
      ref={box}
      className={cn(
        "relative h-full",
        distance !== "near" && "tree-far",
        distance === "tiny" && "tree-tiny",
        moving && "tree-moving",
        relating && "tree-kin",
        glow && "tree-kin-result",
      )}
    >
      <TreeActionsContext.Provider value={actions}>
        <ReactFlow<PersonFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeDragStop={onNodeDragStop}
          onMove={onMove}
          // The made-up sample: moves aren't saved. A view-only copy: nothing moves at all.
          nodesDraggable={canChange}
          nodesConnectable={!fixed && canAdd}
          elementsSelectable={false}
          onlyRenderVisibleElements
          connectionRadius={40}
          connectionLineStyle={CONNECTION_LINE}
          fitView={!middle && !top}
          onInit={onInit}
          minZoom={minZoom}
          maxZoom={2}
        >
          <RingsBackdrop
            rings={layout.rings}
            tray={layout.tray}
            guides={layout.guides}
            tinted={colours === "generation"}
          />
          <Background gap={32} color="#e7e5e4" />
          <Controls showInteractive={false} />
          <Overview nodes={flow.nodes} />
        </ReactFlow>
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
  );
}
