/**
 * graph-model.ts: core module for the topology data model, coordinate conversion, auto layout, and import/export.
 * Main functions/types:
 *   - Constants (NODE_W/NODE_H, GROUP_DEFAULT_*, EDGE_KIND_META, ENTRY_STATUS_LABEL, etc.): canvas dimensions, edge-type semantics, and status text
 *   - findingID / nodeTitle / nodeSubtitle: evidence-reference parsing and node title/subtitle
 *   - absolutePosition / groupSize / nextGroupPlacement: relative-coordinate conversion, group sizing, and new-group placement
 *   - autoLayout / LayoutPlan: full two-level auto layout based on dagre
 *   - buildExportPayload / downloadJSON / normalizeImport: JSON export payload, browser download, and import-file parsing
 */
import dagre from "@dagrejs/dagre";

import type {
  TopologyEdgeKind,
  TopologyGraph,
  TopologyGraphEdge,
  TopologyGraphGroup,
  TopologyGraphNode,
  TopologyNote,
} from "@/lib/types";

/** Default canvas node size, matching the card styles in topology-canvas. */
export const NODE_W = 200;
export const NODE_H = 78;
export const GROUP_DEFAULT_W = 380;
export const GROUP_DEFAULT_H = 260;

export const ASSET_GRAPH_FORMAT = "artex-asset-graph";
export const ASSET_GRAPH_VERSION = 1;

export type EdgeKindMeta = {
  label: string;
  hint: string;
  stroke: string;
  dash?: string;
  chip: string;
};

/** Semantics, colors, and dash styles of the four edge types. */
export const EDGE_KIND_META: Record<TopologyEdgeKind, EdgeKindMeta> = {
  solid: {
    label: "Breached",
    hint: "Vulnerability found or lateral movement succeeded",
    stroke: "#1d4ed8",
    chip: "border-blue-500/40 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
  },
  reachable: {
    label: "Reachable",
    hint: "Connectivity confirmed by scanning",
    stroke: "#94a3b8",
    dash: "6 4",
    chip: "border-slate-400/40 bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200",
  },
};

export const EDGE_KIND_OPTIONS: Array<{ value: TopologyEdgeKind; label: string }> = (
  Object.keys(EDGE_KIND_META) as TopologyEdgeKind[]
).map((kind) => ({ value: kind, label: EDGE_KIND_META[kind].label }));

export const ENTRY_STATUS_LABEL: Record<string, string> = {
  "": "Not an entry",
  suspected: "Suspected entry",
  confirmed: "Confirmed entry",
};

/** The backend records evidence references as `finding:12`; returns null when unparseable. */
export function findingID(evidenceRef: string | undefined): number | null {
  if (!evidenceRef) return null;
  const m = /^finding:(\d+)$/.exec(evidenceRef.trim());
  if (!m) return null;
  const id = Number.parseInt(m[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function nodeTitle(node: TopologyGraphNode): string {
  return node.hostname.trim() || node.ip;
}

export function nodeSubtitle(node: TopologyGraphNode): string {
  const parts = [node.ip];
  if (node.display_label.trim()) parts.push(node.display_label.trim());
  return parts.join(" · ");
}

/** Node coordinates are relative: relative to the group frame's top-left inside a group, absolute canvas coordinates outside. */
export function absolutePosition(node: TopologyGraphNode, groups: TopologyGraphGroup[]): { x: number; y: number } {
  if (node.group_id == null) return { x: node.x, y: node.y };
  const group = groups.find((g) => g.id === node.group_id);
  if (!group) return { x: node.x, y: node.y };
  return { x: group.x + node.x, y: group.y + node.y };
}

export function groupSize(group: TopologyGraphGroup): { width: number; height: number } {
  return {
    width: group.width > 0 ? group.width : GROUP_DEFAULT_W,
    height: group.height > 0 ? group.height : GROUP_DEFAULT_H,
  };
}

/** Bottom-right boundary of existing canvas content, used for placing new elements. */
function contentBounds(graph: TopologyGraph): { maxX: number; minY: number; empty: boolean } {
  let maxX = 0;
  let minY = 0;
  let empty = true;
  for (const node of graph.nodes) {
    const abs = absolutePosition(node, graph.groups);
    if (empty || abs.y < minY) minY = abs.y;
    maxX = Math.max(maxX, abs.x + NODE_W);
    empty = false;
  }
  for (const group of graph.groups) {
    if (empty || group.y < minY) minY = group.y;
    maxX = Math.max(maxX, group.x + groupSize(group).width);
    empty = false;
  }
  return { maxX, minY, empty };
}

/** New groups are placed to the right of all content to avoid covering existing nodes. */
export function nextGroupPlacement(graph: TopologyGraph): { x: number; y: number } {
  const box = contentBounds(graph);
  if (box.empty) return { x: 0, y: 0 };
  return { x: Math.round(box.maxX + 120), y: Math.round(box.minY) };
}

const GROUP_PAD = 36;

export type LayoutPlan = {
  /** IP → new coordinates: relative inside a group frame, absolute outside (consistent with DB semantics). */
  positions: Map<string, { x: number; y: number }>;
  /** Group id → new frame position and size shrunk to fit its contents. */
  groupBoxes: Map<number, { x: number; y: number; width: number; height: number }>;
};

/**
 * Full two-level dagre layout (auto arrange).
 * Level one: members of each group are laid out with dagre LR (relative coordinates), and the frame is shrunk to the members' bounding box;
 * Level two: group frames are treated as large nodes and laid out with dagre LR together with ungrouped nodes, yielding absolute frame positions.
 * Returned coordinates match DB storage semantics (relative inside groups / absolute outside); callers PATCH them back one by one.
 */
export function autoLayout(graph: TopologyGraph): LayoutPlan {
  const positions = new Map<string, { x: number; y: number }>();
  const groupBoxes = new Map<number, { x: number; y: number; width: number; height: number }>();
  const plan: LayoutPlan = { positions, groupBoxes };
  if (graph.nodes.length === 0) return plan;

  // ---- Level one: intra-group layout + frame shrink-to-fit ----
  const groupDims = new Map<number, { width: number; height: number }>();
  for (const group of graph.groups) {
    const members = graph.nodes.filter((n) => n.group_id === group.id);
    const size = groupSize(group);
    if (members.length === 0) {
      groupDims.set(group.id, size);
      continue;
    }
    const memberSet = new Set(members.map((m) => m.ip));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 48, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const m of members) g.setNode(m.ip, { width: NODE_W, height: NODE_H });
    for (const edge of graph.edges) {
      if (memberSet.has(edge.src_ip) && memberSet.has(edge.dst_ip)) g.setEdge(edge.src_ip, edge.dst_ip);
    }
    dagre.layout(g);

    // Member relative coordinates (dagre returns centers; convert to top-left) + member bounding box.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const rel = new Map<string, { x: number; y: number }>();
    for (const m of members) {
      const placed = g.node(m.ip) as { x?: number; y?: number } | undefined;
      const x = Math.round((placed?.x ?? 0) - NODE_W / 2);
      const y = Math.round((placed?.y ?? 0) - NODE_H / 2);
      rel.set(m.ip, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W);
      maxY = Math.max(maxY, y + NODE_H);
    }
    // Translate to the padding origin: member coordinates are relative to the frame's top-left; frame size = content + padding on both sides.
    for (const m of members) {
      const p = rel.get(m.ip);
      if (!p) continue;
      positions.set(m.ip, { x: p.x - minX + GROUP_PAD, y: p.y - minY + GROUP_PAD });
    }
    groupDims.set(group.id, {
      width: Math.max(Math.round(maxX - minX + GROUP_PAD * 2), GROUP_DEFAULT_W),
      height: Math.max(Math.round(maxY - minY + GROUP_PAD * 2), GROUP_DEFAULT_H),
    });
  }

  // ---- Level two: overall layout of ungrouped nodes + group frames ----
  const containerOf = (ip: string): string => {
    const node = graph.nodes.find((n) => n.ip === ip);
    return node?.group_id != null ? `group:${node.group_id}` : `node:${ip}`;
  };
  const top = new dagre.graphlib.Graph();
  top.setGraph({ rankdir: "LR", nodesep: 64, ranksep: 160, marginx: 0, marginy: 0 });
  top.setDefaultEdgeLabel(() => ({}));
  const topIDs: string[] = [];
  for (const group of graph.groups) {
    const dim = groupDims.get(group.id) ?? groupSize(group);
    const id = `group:${group.id}`;
    top.setNode(id, { width: dim.width, height: dim.height });
    topIDs.push(id);
  }
  for (const node of graph.nodes) {
    if (node.group_id != null) continue;
    const id = `node:${node.ip}`;
    top.setNode(id, { width: NODE_W, height: NODE_H });
    topIDs.push(id);
  }
  const edgeSeen = new Set<string>();
  for (const edge of graph.edges) {
    const s = containerOf(edge.src_ip);
    const d = containerOf(edge.dst_ip);
    if (s === d) continue;
    const key = `${s}->${d}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);
    top.setEdge(s, d);
  }
  dagre.layout(top);

  for (const id of topIDs) {
    const placed = top.node(id) as { x?: number; y?: number } | undefined;
    if (!placed || placed.x == null || placed.y == null) continue;
    if (id.startsWith("group:")) {
      const gid = Number(id.slice("group:".length));
      const dim = groupDims.get(gid);
      if (!dim) continue;
      groupBoxes.set(gid, {
        x: Math.round(placed.x - dim.width / 2),
        y: Math.round(placed.y - dim.height / 2),
        width: dim.width,
        height: dim.height,
      });
    } else {
      positions.set(id.slice("node:".length), {
        x: Math.round(placed.x - NODE_W / 2),
        y: Math.round(placed.y - NODE_H / 2),
      });
    }
  }
  return plan;
}

export type AssetGraphExport = {
  format: typeof ASSET_GRAPH_FORMAT;
  version: typeof ASSET_GRAPH_VERSION;
  exported_at: string;
  task_id: string;
  datasets: {
    topology: TopologyGraph;
    coverage: unknown;
  };
};

export function buildExportPayload(taskId: string, topology: TopologyGraph, coverage: unknown): AssetGraphExport {
  return {
    format: ASSET_GRAPH_FORMAT,
    version: ASSET_GRAPH_VERSION,
    exported_at: new Date().toISOString(),
    task_id: taskId,
    datasets: { topology, coverage: coverage ?? null },
  };
}

export function downloadJSON(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asKind(value: unknown): TopologyEdgeKind {
  return value === "solid" || value === "reachable" ? value : "reachable";
}

/**
 * Parses the topology dataset from an export file. Lenient with defaults, strict about the skeleton structure,
 * so dirty data never reaches the backend.
 */
export function normalizeImport(text: string): TopologyGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  const root = asRecord(raw, "file");
  if (asString(root.format) !== ASSET_GRAPH_FORMAT) {
    throw new Error(`format must be ${ASSET_GRAPH_FORMAT}`);
  }
  if (asNumber(root.version) !== ASSET_GRAPH_VERSION) {
    throw new Error(`Only version ${ASSET_GRAPH_VERSION} is supported`);
  }
  const datasets = asRecord(root.datasets, "datasets");
  const topology = asRecord(datasets.topology, "datasets.topology");

  const nodes: TopologyGraphNode[] = asArray(topology.nodes, "datasets.topology.nodes").map((item, idx) => {
    const n = asRecord(item, `nodes[${idx}]`);
    const ip = asString(n.ip);
    if (!ip) throw new Error(`nodes[${idx}] is missing ip`);
    const status = asString(n.entry_status);
    return {
      ip,
      hostname: asString(n.hostname),
      display_label: asString(n.display_label),
      group_id: asNumberOrNull(n.group_id),
      x: asNumber(n.x),
      y: asNumber(n.y),
      entry_status: status === "suspected" || status === "confirmed" || status === "" ? status : "",
      color: asString(n.color),
      description: asString(n.description),
    };
  });
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.ip)) throw new Error(`Duplicate node IP: ${node.ip}`);
    seen.add(node.ip);
  }

  const groups: TopologyGraphGroup[] = asArray(topology.groups, "datasets.topology.groups").map((item, idx) => {
    const g = asRecord(item, `groups[${idx}]`);
    const name = asString(g.name);
    if (!name) throw new Error(`groups[${idx}] is missing name`);
    return {
      id: asNumber(g.id, -(idx + 1)),
      name,
      x: asNumber(g.x),
      y: asNumber(g.y),
      width: asNumber(g.width, GROUP_DEFAULT_W),
      height: asNumber(g.height, GROUP_DEFAULT_H),
      color: asString(g.color),
    };
  });

  const edges: TopologyGraphEdge[] = asArray(topology.edges, "datasets.topology.edges").map((item, idx) => {
    const e = asRecord(item, `edges[${idx}]`);
    const src = asString(e.src_ip);
    const dst = asString(e.dst_ip);
    if (!src || !dst) throw new Error(`edges[${idx}] is missing src_ip or dst_ip`);
    return {
      id: asNumber(e.id, 0),
      src_ip: src,
      dst_ip: dst,
      label: asString(e.label),
      kind: asKind(e.kind),
      evidence_ref: asString(e.evidence_ref),
      color: asString(e.color),
    };
  });

  const notes: Record<string, TopologyNote[]> = {};
  const rawNotes = topology.notes;
  if (rawNotes && typeof rawNotes === "object" && !Array.isArray(rawNotes)) {
    for (const [ip, list] of Object.entries(rawNotes as Record<string, unknown>)) {
      const items = asArray(list, `notes[${ip}]`).map((item, idx) => {
        const note = asRecord(item, `notes[${ip}][${idx}]`);
        return {
          id: asNumber(note.id, idx + 1),
          body: asString(note.body),
          created_by: asString(note.created_by),
          created_at: asString(note.created_at),
        };
      });
      if (items.length > 0) notes[ip] = items;
    }
  }

  return { nodes, edges, groups, notes };
}
