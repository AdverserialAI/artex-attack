/**
 * topology-import-dialog.tsx: topology import dialog; parses an export file and rebuilds idempotently via backend APIs.
 * Main functions/types:
 *   - TopologyImportDialog: import dialog UI — file parsing, item-by-item rebuild, and progress log
 *   - rebuildFromGraph: rebuilds in group→node→edge→note order; existing items are reused/skipped
 */
"use client";

import * as React from "react";

import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { TopologyGraph, TopologyGraphEdge } from "@/lib/types";

import { normalizeImport } from "./graph-model";

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

/**
 * Rebuilds the topology dataset from an export file item by item via backend APIs.
 * Idempotency: groups are reused by name; nodes/IPs are PATCHed when present and POSTed otherwise; existing edges are skipped; notes are deduplicated by content.
 */
async function rebuildFromGraph(
  taskId: string,
  file: TopologyGraph,
  current: TopologyGraph,
  log: (line: string) => void,
): Promise<TopologyGraph> {
  let graph = current;

  // 1) Groups are created first so nodes can be placed inside them.
  const groupIDByName = new Map(graph.groups.map((g) => [g.name, g.id]));
  for (const group of file.groups) {
    const body = {
      name: group.name,
      x: Math.round(group.x),
      y: Math.round(group.y),
      width: Math.round(group.width),
      height: Math.round(group.height),
      color: group.color,
    };
    const existing = groupIDByName.get(group.name);
    graph = existing ? await api.patchTopologyGroup(taskId, existing, body) : await api.addTopologyGroup(taskId, body);
    const created = graph.groups.find((g) => g.name === group.name);
    if (created) groupIDByName.set(group.name, created.id);
    log(`${existing ? "Updated" : "Created"} group ${group.name}`);
  }

  // Each node's first incoming edge is created together with the node (the backend requires the node to exist before linking).
  const firstEdgeByDst = new Map<string, TopologyGraphEdge>();
  for (const edge of file.edges) {
    if (!firstEdgeByDst.has(edge.dst_ip)) firstEdgeByDst.set(edge.dst_ip, edge);
  }

  const fileGroupName = new Map(file.groups.map((g) => [g.id, g.name]));
  const consumedFirstEdges = new Set<TopologyGraphEdge>();
  const existingIPs = new Set(graph.nodes.map((n) => n.ip));

  // 2) Nodes.
  for (const node of file.nodes) {
    const groupName = node.group_id == null ? null : fileGroupName.get(node.group_id);
    const groupID = groupName ? (groupIDByName.get(groupName) ?? null) : null;
    const patch = {
      hostname: node.hostname,
      display_label: node.display_label,
      group_id: groupID,
      x: Math.round(node.x),
      y: Math.round(node.y),
      entry_status: node.entry_status,
    };
    if (existingIPs.has(node.ip)) {
      graph = await api.patchTopologyNode(taskId, node.ip, patch);
      log(`Updated node ${node.ip}`);
      continue;
    }
    const firstEdge = firstEdgeByDst.get(node.ip);
    graph = await api.addTopologyNode(
      taskId,
      { ip: node.ip, ...patch },
      firstEdge
        ? {
            src_ip: firstEdge.src_ip,
            dst_ip: node.ip,
            kind: firstEdge.kind,
            label: firstEdge.label,
            evidence_ref: firstEdge.evidence_ref,
          }
        : null,
    );
    const consumed = firstEdgeByDst.get(node.ip);
    if (consumed) consumedFirstEdges.add(consumed);
    log(`Created node ${node.ip}`);
  }

  // 3) Remaining connections: existing (deduplicated by source→target→type) or duplicate ones are skipped; illegal links such as cycles are only logged.
  const edgeKey = (src: string, dst: string, kind: string) => `${src}->${dst}:${kind}`;
  const known = new Set(graph.edges.map((e) => edgeKey(e.src_ip, e.dst_ip, e.kind)));
  for (const edge of file.edges) {
    if (consumedFirstEdges.has(edge)) continue;
    if (known.has(edgeKey(edge.src_ip, edge.dst_ip, edge.kind))) continue;
    try {
      graph = await api.addTopologyEdge(taskId, {
        src_ip: edge.src_ip,
        dst_ip: edge.dst_ip,
        kind: edge.kind,
        label: edge.label,
        evidence_ref: edge.evidence_ref,
      });
      known.add(edgeKey(edge.src_ip, edge.dst_ip, edge.kind));
    } catch (reason) {
      log(`Skipped connection ${edge.src_ip} → ${edge.dst_ip}: ${errorText(reason)}`);
    }
  }

  // 4) Notes: not written again when the same content already exists under the same IP.
  for (const [ip, notes] of Object.entries(file.notes)) {
    if (!graph.nodes.some((n) => n.ip === ip)) continue;
    const existingBodies = new Set((graph.notes[ip] ?? []).map((n) => n.body));
    for (const note of notes) {
      if (!note.body.trim() || existingBodies.has(note.body)) continue;
      graph = await api.addTopologyNote(taskId, ip, note.body);
      existingBodies.add(note.body);
      log(`Added note ${ip}`);
    }
  }

  return graph;
}

export function TopologyImportDialog({
  taskId,
  graph,
  onGraph,
  open,
  onOpenChange,
}: {
  taskId: string;
  graph: TopologyGraph;
  onGraph: (graph: TopologyGraph) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setLog([]);
    try {
      setText(await file.text());
    } catch (reason) {
      toast.error(`Failed to read file: ${errorText(reason)}`);
    }
  }

  async function handleImport() {
    let parsed: TopologyGraph;
    try {
      parsed = normalizeImport(text);
    } catch (reason) {
      toast.error(`Invalid file: ${errorText(reason)}`);
      return;
    }
    setBusy(true);
    setLog([]);
    try {
      const next = await rebuildFromGraph(taskId, parsed, graph, (line) => setLog((prev) => [...prev, line]));
      onGraph(next);
      toast.success(`Import complete: ${parsed.nodes.length} nodes, ${parsed.edges.length} connections`);
      onOpenChange(false);
    } catch (reason) {
      toast.error(`Import failed: ${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import JSON</DialogTitle>
          <DialogDescription>
            Reads the topology dataset from an artex-asset-graph file and rebuilds it via API calls. Existing groups are reused by name, nodes are updated by IP,
            connections and notes are deduplicated, and the existing graph is not cleared.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed p-3 text-sm">
            <FileUp className="text-muted-foreground size-4" />
            <span className="flex-1 truncate">{fileName || "Choose a JSON file"}</span>
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {log.length > 0 && (
            <pre className="bg-muted/50 max-h-40 overflow-auto rounded-md border p-2 text-[11px] leading-relaxed">
              {log.join("\n")}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleImport()} disabled={busy || !text}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Start import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
