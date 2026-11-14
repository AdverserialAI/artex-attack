/**
 * topology-canvas.tsx: topology canvas; renders custom node cards/group frames/edges with React Flow and handles interactions.
 * Main functions/types:
 *   - TopologyCanvas / TopologyCanvasInner: canvas components; converts the whole graph to RF nodes/edges and handles select/move/box-select callbacks
 *   - TopologyCanvasProps: canvas prop contract; NodeMovePayload / BoxSelectRect: move and box-select payload types
 */
"use client";
"use no memo";

import * as React from "react";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
  Handle,
  MarkerType,
  MiniMap,
  type NodeProps,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RFEdge,
  type Node as RFNode,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crosshair, Link2, Loader2 } from "lucide-react";

import type { TopologyGraph, TopologyGraphGroup, TopologyGraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  absolutePosition,
  EDGE_KIND_META,
  ENTRY_STATUS_LABEL,
  GROUP_DEFAULT_H,
  GROUP_DEFAULT_W,
  groupSize,
  NODE_H,
  NODE_W,
  nodeSubtitle,
  nodeTitle,
} from "./graph-model";

const GROUP_PREFIX = "group-";

function groupNodeID(id: number): string {
  return `${GROUP_PREFIX}${id}`;
}

/** Entry status → card outline and corner badge (outline stays readable in dark mode; Tailwind only colors the badge). */
type EntryTone = {
  stroke: string;
  dashed: boolean;
  badge: string;
  badgeClass: string;
};

function entryTone(status: string): EntryTone {
  if (status === "confirmed") {
    return {
      stroke: "#10b981",
      dashed: false,
      badge: "Entry",
      badgeClass:
        "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
    };
  }
  if (status === "suspected") {
    return {
      stroke: "#f59e0b",
      dashed: true,
      badge: "Suspected",
      badgeClass:
        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-300",
    };
  }
  return { stroke: "", dashed: false, badge: "", badgeClass: "" };
}

// Custom elements: draw.io-style node cards / group containers / smoothstep edges.

type TopoCardData = {
  title: string;
  subtitle: string;
  /** One-line node fact ("what it is"); the third row is not rendered when empty. */
  description: string;
  badge: string;
  badgeClass: string;
  toneStroke: string;
  toneDashed: boolean;
  connectFrom: boolean;
  /** Custom node color ("" = default). */
  color: string;
};
type TopoCardNode = RFNode<TopoCardData, "topology">;

type GroupCardData = {
  name: string;
  width: number;
  height: number;
  /** Zoom end (including position) is reported back to the editor for persistence. */
  onResized: (params: { x: number; y: number; width: number; height: number }) => void;
  onRename: () => void;
  onDelete: () => void;
};
/**
 * The type name deliberately avoids "group": RF base styles hard-code
 * width:150px + padding:10px + border/background on .react-flow__node-group, which would squash the custom frame to 150px (the observed "frame bug").
 */
type GroupCardNode = RFNode<GroupCardData, "frame">;

type CanvasNode = TopoCardNode | GroupCardNode;

function TopoCard({ data, selected }: NodeProps<TopoCardNode>) {
  // Custom color wins: when set, both outline and title use it (draw.io style-override semantics).
  const borderColor = data.color || data.toneStroke || undefined;
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-center gap-0.5 rounded-lg border bg-white px-3 py-2 shadow-none transition-shadow hover:shadow-md dark:bg-neutral-900",
        "border-[#666666] dark:border-neutral-600",
        data.toneDashed && "border-dashed",
        data.connectFrom && "border-2 border-[#4d90fe]",
        selected && "border-[#4d90fe] shadow-md ring-1 ring-[#4d90fe]/40",
      )}
      style={{ width: NODE_W, height: NODE_H, borderColor }}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !opacity-0" />
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="truncate font-semibold text-[13px] text-slate-900 dark:text-neutral-100"
          style={data.color ? { color: data.color } : undefined}
        >
          {data.title}
        </span>
        {data.badge ? (
          <span className={cn("ml-auto shrink-0 rounded-full border px-1.5 py-px text-[10px]", data.badgeClass)}>
            {data.badge}
          </span>
        ) : null}
      </div>
      <span className="truncate font-mono text-[11px] text-slate-500 dark:text-neutral-400">{data.subtitle}</span>
      {data.description ? (
        <span
          className="max-w-full truncate text-[10px] leading-tight text-slate-400 dark:text-neutral-500"
          title={data.description}
        >
          {data.description}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} className="!size-2 !opacity-0" />
    </div>
  );
}

function GroupCard({ data, selected, id }: NodeProps<GroupCardNode>) {
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  // Reset the confirmation state on selection changes (including before a node unmounts after deletion).
  if (!selected && confirmingDelete) setConfirmingDelete(false);
  return (
    <div
      className={cn(
        "relative h-full w-full rounded-lg border border-dashed",
        selected ? "border-[#4d90fe]" : "border-[#666666] dark:border-neutral-600",
      )}
      style={{ width: data.width, height: data.height }}
    >
      {/* Group name is always visible (previously only in NodeToolbar when selected). */}
      <div className="pointer-events-none absolute -top-6 left-1 max-w-full truncate text-xs font-medium text-muted-foreground">
        {data.name}
      </div>
      <NodeToolbar
        isVisible={Boolean(selected)}
        nodeId={id}
        position={Position.Top}
        offset={8}
        className="flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm"
      >
        <span className="max-w-32 truncate px-1.5 text-muted-foreground text-xs">{data.name}</span>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            data.onRename();
          }}
        >
          Rename
        </button>
        {confirmingDelete ? (
          <button
            type="button"
            className="rounded bg-destructive px-2 py-1 text-destructive-foreground text-xs hover:bg-destructive/90"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmingDelete(false);
              data.onDelete();
            }}
          >
            Confirm delete? Members kept
          </button>
        ) : (
          <button
            type="button"
            className="rounded px-2 py-1 text-destructive text-xs hover:bg-destructive/10"
            onClick={(event) => {
              event.stopPropagation();
              setConfirmingDelete(true);
            }}
          >
            Delete group
          </button>
        )}
      </NodeToolbar>
      <NodeResizer
        isVisible={Boolean(selected)}
        minWidth={220}
        minHeight={140}
        lineClassName="!border-[#4d90fe]"
        handleClassName="!size-2 !rounded-sm !border !border-[#4d90fe] !bg-white dark:!bg-neutral-900"
        onResizeEnd={(_event, params) => data.onResized(params)}
      />
    </div>
  );
}

type TopoEdgeData = { label: string };
type TopoRFEdge = RFEdge<TopoEdgeData>;

function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerEnd,
}: EdgeProps<TopoRFEdge>) {
  const [path, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <span
          className="pointer-events-none absolute max-w-40 truncate rounded border border-slate-200 bg-white/90 px-1.5 py-px text-[10px] text-slate-600 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-300"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={data?.label}
        >
          {data?.label}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { topology: TopoCard, frame: GroupCard };
const edgeTypes = { topology: TopologyEdge };

// Backend full graph → React Flow data.

/**
 * Converts graph data to RF nodes. Coordinates follow the DB (intra-group nodes are relative, which naturally matches RF parentId semantics);
 * Current canvas positions are kept only when parentage is unchanged, so poll/save responses don't snap nodes back to old coordinates.
 */
function buildRFNodes(
  graph: TopologyGraph,
  selectedIP: string | null,
  connectFrom: string | null,
  prev: CanvasNode[],
  onGroupResized: (group: TopologyGraphGroup, params: { x: number; y: number; width: number; height: number }) => void,
  onGroupAction: (group: TopologyGraphGroup, action: "rename" | "delete") => void,
): CanvasNode[] {
  const prevByID = new Map(prev.map((node) => [node.id, node]));
  const groupIDs = new Set(graph.groups.map((group) => group.id));

  const groupNodes: GroupCardNode[] = graph.groups.map((group) => {
    const id = groupNodeID(group.id);
    const size = groupSize(group);
    return {
      id,
      type: "frame" as const,
      position: prevByID.get(id)?.position ?? { x: group.x, y: group.y },
      data: {
        name: group.name,
        width: size.width,
        height: size.height,
        onResized: (params) => onGroupResized(group, params),
        onRename: () => onGroupAction(group, "rename"),
        onDelete: () => onGroupAction(group, "delete"),
      },
      zIndex: -1,
    };
  });

  const nodes: TopoCardNode[] = graph.nodes.map((node) => {
    const parentID = node.group_id != null && groupIDs.has(node.group_id) ? groupNodeID(node.group_id) : undefined;
    const prevNode = prevByID.get(node.ip);
    const tone = entryTone(node.entry_status);
    return {
      id: node.ip,
      type: "topology",
      parentId: parentID,
      position: prevNode && prevNode.parentId === parentID ? prevNode.position : { x: node.x, y: node.y },
      data: {
        title: nodeTitle(node),
        subtitle: nodeSubtitle(node),
        description: node.description ?? "",
        badge: tone.badge,
        badgeClass: tone.badgeClass,
        toneStroke: tone.stroke,
        toneDashed: tone.dashed,
        connectFrom: connectFrom === node.ip,
        color: node.color ?? "",
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      selected: selectedIP === node.ip,
      zIndex: 0,
    };
  });

  return [...groupNodes, ...nodes];
}

function buildRFEdges(graph: TopologyGraph): TopoRFEdge[] {
  const ipSet = new Set(graph.nodes.map((node) => node.ip));
  return graph.edges
    .filter((edge) => ipSet.has(edge.src_ip) && ipSet.has(edge.dst_ip))
    .map((edge) => {
      const meta = EDGE_KIND_META[edge.kind] ?? EDGE_KIND_META.reachable;
      const stroke = edge.color || meta.stroke;
      return {
        id: `edge-${edge.id}`,
        type: "topology",
        source: edge.src_ip,
        target: edge.dst_ip,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: edge.label?.trim() || meta.label },
        style: {
          stroke,
          strokeWidth: 1.5,
          ...(meta.dash ? { strokeDasharray: meta.dash } : {}),
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 12, height: 12 },
      };
    });
}

/** Normalizes a box-select rect to {x,y top-left + positive width/height} (flow and screen y-axes point the same way, so plain min/max). */
function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export type NodeMovePayload = { ip: string; groupID: number | null; x: number; y: number };
export type BoxSelectRect = { x: number; y: number; width: number; height: number };

export type TopologyCanvasProps = {
  graph: TopologyGraph;
  taskId: string;
  selectedIP: string | null;
  connectMode: boolean;
  connectFrom: string | null;
  busy?: boolean;
  boxSelectMode?: boolean;
  onBoxSelect?: (rect: BoxSelectRect, members: TopologyGraphNode[]) => void;
  onNodeClick: (ip: string) => void;
  onGroupRename: (group: TopologyGraphGroup) => void;
  onGroupDelete: (group: TopologyGraphGroup) => void;
  onGroupMoved: (group: TopologyGraphGroup, position: { x: number; y: number }) => void;
  onGroupResized: (group: TopologyGraphGroup, params: { x: number; y: number; width: number; height: number }) => void;
  onNodeMoved: (payload: NodeMovePayload) => void;
  onPaneClick: () => void;
};

// taskId remains in the props contract (topology-editor passes it), but the canvas no longer uses it.
export function TopologyCanvas(props: TopologyCanvasProps) {
  return (
    <ReactFlowProvider>
      <TopologyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function TopologyCanvasInner({
  graph,
  selectedIP,
  connectMode,
  connectFrom,
  busy = false,
  boxSelectMode = false,
  onBoxSelect,
  onNodeClick,
  onGroupRename,
  onGroupDelete,
  onGroupMoved,
  onGroupResized,
  onNodeMoved,
  onPaneClick,
}: TopologyCanvasProps) {
  const { screenToFlowPosition } = useReactFlow();
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<TopoRFEdge>([]);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  /** Rubber band while dragging (wrapper-local coordinates, render only). */
  const [band, setBand] = React.useState<BoxSelectRect | null>(null);
  const bandRef = React.useRef<{ startLocal: { x: number; y: number }; startFlow: { x: number; y: number } } | null>(
    null,
  );

  // Callbacks and graph both go through refs: the global mousemove/mouseup closures created for box-select still read the latest values.
  const handlersRef = React.useRef({ graph, onBoxSelect });
  handlersRef.current = { graph, onBoxSelect };
  // Group callbacks also go through refs: buildRFNodes runs in an effect and must not re-run just because callback identities change.
  const groupHandlersRef = React.useRef({
    onResized: onGroupResized,
    onRename: onGroupRename,
    onDelete: onGroupDelete,
  });
  groupHandlersRef.current = { onResized: onGroupResized, onRename: onGroupRename, onDelete: onGroupDelete };

  // Backend graph / selection / connection-source changes → rebuild nodes and edges (keeping current canvas positions, no local inference).
  React.useEffect(() => {
    setRfNodes((prev) =>
      buildRFNodes(
        graph,
        selectedIP,
        connectFrom,
        prev,
        (group, params) => groupHandlersRef.current.onResized(group, params),
        (group, action) =>
          action === "rename" ? groupHandlersRef.current.onRename(group) : groupHandlersRef.current.onDelete(group),
      ),
    );
  }, [graph, selectedIP, connectFrom, setRfNodes]);

  React.useEffect(() => {
    setRfEdges(buildRFEdges(graph));
  }, [graph, setRfEdges]);

  // Exiting box-select mode aborts an in-progress selection (the attached global listeners return early on mouseup when bandRef is empty).
  React.useEffect(() => {
    if (!boxSelectMode) bandRef.current = null;
  }, [boxSelectMode]);

  const handleWrapperMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boxSelectMode || event.button !== 0) return;
    // Only mousedown on empty canvas starts a selection; node/control clicks don't trigger it.
    if (!(event.target as HTMLElement).closest(".react-flow__pane")) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const toLocal = (clientX: number, clientY: number) => ({ x: clientX - bounds.left, y: clientY - bounds.top });
    const startLocal = toLocal(event.clientX, event.clientY);
    const startFlow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    bandRef.current = { startLocal, startFlow };

    const onMove = (moveEvent: MouseEvent) => {
      if (!bandRef.current) return;
      setBand(normalizeRect(bandRef.current.startLocal, toLocal(moveEvent.clientX, moveEvent.clientY)));
    };
    const onUp = (upEvent: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const pending = bandRef.current;
      bandRef.current = null;
      setBand(null);
      if (!pending) return;
      const endLocal = toLocal(upEvent.clientX, upEvent.clientY);
      // Drags below the threshold count as normal clicks, delegated to React Flow's onPaneClick.
      if (Math.abs(endLocal.x - pending.startLocal.x) < 4 && Math.abs(endLocal.y - pending.startLocal.y) < 4) return;
      const { graph: current, onBoxSelect: emit } = handlersRef.current;
      if (!emit) return;
      const rect = normalizeRect(pending.startFlow, screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY }));
      // Membership: absolute center inside the rect (simple math, no hook needed).
      const members = current.nodes.filter((node) => {
        const abs = absolutePosition(node, current.groups);
        const cx = abs.x + NODE_W / 2;
        const cy = abs.y + NODE_H / 2;
        return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
      });
      emit(rect, members);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleNodeDragStop = (_event: MouseEvent | TouchEvent, node: RFNode) => {
    if (node.type === "frame") {
      const group = graph.groups.find((item) => groupNodeID(item.id) === node.id);
      if (group) {
        onGroupMoved(group, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
      }
      return;
    }
    const topo = graph.nodes.find((item) => item.ip === node.id);
    if (!topo) return;
    // RF child coordinates are relative to the parent's top-left; DB intra-group coordinates share this semantics, so convert back to absolute for hit testing.
    const oldGroup = node.parentId ? graph.groups.find((item) => groupNodeID(item.id) === node.parentId) : undefined;
    const absX = node.position.x + (oldGroup ? oldGroup.x : 0);
    const absY = node.position.y + (oldGroup ? oldGroup.y : 0);
    const centerX = absX + NODE_W / 2;
    const centerY = absY + NODE_H / 2;
    const hit = graph.groups.find((group) => {
      const size = groupSize(group);
      return (
        centerX >= group.x && centerX <= group.x + size.width && centerY >= group.y && centerY <= group.y + size.height
      );
    });
    if (!hit) {
      onNodeMoved({ ip: node.id, groupID: null, x: Math.round(absX), y: Math.round(absY) });
      return;
    }
    if ((topo.group_id ?? null) === hit.id) {
      // Staying in the same group: convert straight back to intra-group relative coordinates, no boundary clamping (same as the original implementation).
      onNodeMoved({ ip: node.id, groupID: hit.id, x: Math.round(absX - hit.x), y: Math.round(absY - hit.y) });
      return;
    }
    const size = groupSize(hit);
    onNodeMoved({
      ip: node.id,
      groupID: hit.id,
      x: Math.round(Math.min(Math.max(absX - hit.x, 0), Math.max(size.width - NODE_W, 0))),
      y: Math.round(Math.max(absY - hit.y, 0)),
    });
  };

  const handleNodeDoubleClick = (_event: React.MouseEvent, node: RFNode) => {
    if (node.type !== "frame") return;
    const group = graph.groups.find((item) => groupNodeID(item.id) === node.id);
    if (group) onGroupRename(group);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the canvas container must capture mouse drags to draw the selection rectangle (box-select mode only).
    <div
      ref={wrapperRef}
      role="presentation"
      className={cn("relative min-h-0 flex-1 overflow-hidden rounded-lg border", boxSelectMode && "cursor-crosshair")}
      onMouseDown={handleWrapperMouseDown}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.type !== "frame") onNodeClick(node.id);
        }}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onPaneClick()}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable={!connectMode}
        panOnDrag={!boxSelectMode}
        deleteKeyCode={null}
        className="!bg-[#f0f2f7] dark:!bg-neutral-950"
      >
        <Background variant={BackgroundVariant.Lines} gap={10} className="text-neutral-300 dark:text-neutral-800" />
        <Controls
          showInteractive={false}
          className="!rounded-lg !border !shadow-sm [&>button]:!border-border [&>button]:!bg-card [&>button:hover]:!bg-accent [&_svg]:!fill-foreground"
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !bg-card !shadow-sm"
          maskColor="rgb(148 163 184 / 0.18)"
          nodeColor={(node) => {
            if (node.type === "frame") return "rgba(148, 163, 184, 0.25)";
            const data = node.data as TopoCardData | undefined;
            return data?.color || data?.toneStroke || "#94a3b8";
          }}
          nodeStrokeWidth={0}
          nodeBorderRadius={4}
        />
      </ReactFlow>

      {band ? (
        <div
          className="pointer-events-none absolute z-10 border border-[#4d90fe] bg-[#4d90fe]/10"
          style={{ left: band.x, top: band.y, width: band.width, height: band.height }}
        />
      ) : null}

      {/* Legend (group colors + entry states) */}
      <div className="pointer-events-none absolute top-3 left-3 flex flex-col gap-2 rounded-lg border bg-card/95 p-3 text-xs shadow-sm backdrop-blur">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-foreground">
          {Object.entries(EDGE_KIND_META).map(([kind, meta]) => (
            <span key={kind} className="inline-flex items-center gap-1.5" title={meta.hint}>
              <span
                className={cn("w-5 border-t-2", meta.dash ? "border-dashed" : "border-solid")}
                style={{ borderColor: meta.stroke }}
              />
              {meta.label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-border/60 border-t pt-2 text-muted-foreground">
          {Object.entries(ENTRY_STATUS_LABEL).map(([status, label]) => (
            <span key={status || "none"}>{label}</span>
          ))}
          <span>{`Group frames ${GROUP_DEFAULT_W}×${GROUP_DEFAULT_H} are draggable`}</span>
        </div>
      </div>

      {connectMode ? (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-lg border border-blue-400/60 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 text-xs shadow-sm dark:bg-blue-950/70 dark:text-blue-200">
            <Link2 className="size-3.5" />
            {connectFrom ? "Click the target node to finish the connection" : "Click a source node (the connection starts from it)"} · Esc to cancel
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="pointer-events-none absolute top-3 right-3">
          <div className="flex items-center gap-1.5 rounded-lg border bg-card/95 px-2.5 py-1.5 text-xs shadow-sm">
            <Loader2 className="size-3.5 animate-spin" />
            Saving
          </div>
        </div>
      ) : null}

      {graph.nodes.length === 0 ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-1.5 rounded-lg border bg-card/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
            <Crosshair className="size-3.5" />
            No nodes yet — use the toolbar's "Generate initial topology from assets" or "Import JSON"
          </div>
        </div>
      ) : null}
    </div>
  );
}
