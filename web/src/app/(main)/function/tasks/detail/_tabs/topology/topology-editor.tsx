/**
 * topology-editor.tsx: topology editor state owner; orchestrates the canvas, node drawer, toolbar, and dialogs.
 * Main functions/types:
 *   - TopologyEditor: owns the whole-graph state; every write replaces local state with the graph returned by the backend
 *   - groupBody / errorText: group-update request body construction and error-text helpers
 */
"use client";

import * as React from "react";

import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { TopologyGraph, TopologyGraphGroup, TopologyGraphNode } from "@/lib/types";

import { applyC24Grouping, isC24Grouped, markC24Grouped, planC24Groups } from "./c24-groups";
import { autoLayout } from "./graph-model";
import { type BoxSelectRect, type NodeMovePayload, TopologyCanvas } from "./topology-canvas";
import { type ConnPair, CreateEdgeDialog } from "./topology-edge-dialog";
import { TopologyNodeDrawer } from "./topology-node-drawer";
import { AddGroupDialog, type BoxGroupPrefill, type TopologyRun, TopologyToolbar } from "./topology-toolbar";

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function groupBody(
  group: TopologyGraphGroup,
  overrides: Partial<{ name: string; x: number; y: number; width: number; height: number }> = {},
) {
  return {
    name: overrides.name ?? group.name,
    x: overrides.x ?? group.x,
    y: overrides.y ?? group.y,
    width: overrides.width ?? group.width,
    height: overrides.height ?? group.height,
    color: group.color,
  };
}

/**
 * Topology editor state owner.
 * Every write replaces local state with the backend-returned graph; the frontend does not infer entry/orphan relationships.
 */
export function TopologyEditor({ taskId }: { taskId: string }) {
  const [graph, setGraph] = React.useState<TopologyGraph | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [selectedIP, setSelectedIP] = React.useState<string | null>(null);
  const [connectMode, setConnectMode] = React.useState(false);
  const [connectFrom, setConnectFrom] = React.useState<string | null>(null);
  const [connPair, setConnPair] = React.useState<ConnPair | null>(null);
  const [renamingGroup, setRenamingGroup] = React.useState<TopologyGraphGroup | null>(null);
  const [boxSelectMode, setBoxSelectMode] = React.useState(false);
  const [boxGroup, setBoxGroup] = React.useState<BoxGroupPrefill | null>(null);

  // Auto layout/group on first load: nodes written by fact-based auto edge creation have no coordinates (DB default 0,0),
  // so they all pile up at the origin. Layout runs once when coordinates overlap; /24 grouping runs only when it has never run before
  // (marker in localStorage); nodes are never forced back after the user drags them out or dissolves groups — nodes are not
  // required to sit inside frames. No intervention when any group already exists.
  const maybeAutoLayout = React.useCallback(
    async (g: TopologyGraph) => {
      if (g.groups.length > 0) return;
      const alreadyGrouped = isC24Grouped(taskId);
      const ungrouped = g.nodes.filter((n) => n.group_id == null);
      const stacked = ungrouped.length >= 2 && ungrouped.every((n) => n.x === 0 && n.y === 0);
      if (!stacked && (alreadyGrouped || planC24Groups(g).length === 0)) return;
      try {
        let current = alreadyGrouped ? g : await applyC24Grouping(taskId, g);
        const groupCount = current.groups.length;
        const plan = autoLayout(current);
        for (const [id, box] of plan.groupBoxes) {
          const group = current.groups.find((gg) => gg.id === id);
          if (!group) continue;
          current = await api.patchTopologyGroup(taskId, id, {
            name: group.name,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            color: group.color,
          });
        }
        for (const [ip, pos] of plan.positions) {
          current = await api.patchTopologyNode(taskId, ip, { x: pos.x, y: pos.y });
        }
        markC24Grouped(taskId);
        setGraph(current);
        toast.success(`Auto-laid out ${plan.positions.size} nodes and ${groupCount} subnet groups`);
      } catch (reason) {
        toast.error(`Auto layout failed: ${errorText(reason)}`);
      }
    },
    [taskId],
  );

  const load = React.useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const next = await api.taskTopology(taskId);
        setGraph(next);
        setLoadError(null);
        if (!silent) void maybeAutoLayout(next);
      } catch (reason) {
        setLoadError(errorText(reason));
        if (silent) toast.error(`Refresh failed: ${errorText(reason)}`);
      } finally {
        setLoading(false);
      }
    },
    [taskId, maybeAutoLayout],
  );

  React.useEffect(() => {
    setGraph(null);
    setSelectedIP(null);
    setConnectMode(false);
    setConnectFrom(null);
    setConnPair(null);
    setBoxSelectMode(false);
    setBoxGroup(null);
    void load();
  }, [load]);

  const run: TopologyRun = React.useCallback(async (task, success, options) => {
    setBusy(true);
    try {
      const next = await task();
      setGraph(next);
      if (success) toast.success(success);
      return next;
    } catch (reason) {
      if (options?.rethrowOnError) throw reason;
      toast.error(`Operation failed: ${errorText(reason)}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    if (!connectMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (connectFrom) setConnectFrom(null);
      else setConnectMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectMode, connectFrom]);

  // Box-select grouping: Esc exits; once nodes are selected the dialog takes over.
  React.useEffect(() => {
    if (!boxSelectMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setBoxSelectMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boxSelectMode]);

  const handleNodeClick = React.useCallback(
    (ip: string) => {
      if (!connectMode) {
        setSelectedIP(ip);
        return;
      }
      if (!connectFrom) {
        setConnectFrom(ip);
        return;
      }
      if (connectFrom === ip) {
        setConnectFrom(null);
        return;
      }
      setConnPair({ src: connectFrom, dst: ip });
      setConnectFrom(null);
      setConnectMode(false);
    },
    [connectMode, connectFrom],
  );

  const handleNodeMoved = React.useCallback(
    (payload: NodeMovePayload) => {
      if (!graph) return;
      const node = graph.nodes.find((n) => n.ip === payload.ip);
      if (!node) return;
      const sameGroup = (node.group_id ?? null) === payload.groupID;
      if (sameGroup && Math.round(node.x) === payload.x && Math.round(node.y) === payload.y) return;
      void run(() =>
        api.patchTopologyNode(taskId, payload.ip, {
          x: payload.x,
          y: payload.y,
          ...(sameGroup ? {} : { group_id: payload.groupID }),
        }),
      );
    },
    [graph, run, taskId],
  );

  const handleGroupMoved = React.useCallback(
    (group: TopologyGraphGroup, position: { x: number; y: number }) => {
      if (group.x === position.x && group.y === position.y) return;
      void run(() => api.patchTopologyGroup(taskId, group.id, groupBody(group, position)), "Group position saved");
    },
    [run, taskId],
  );

  const handleGroupResized = React.useCallback(
    (group: TopologyGraphGroup, params: { x: number; y: number; width: number; height: number }) => {
      const next = {
        x: Math.round(params.x),
        y: Math.round(params.y),
        width: Math.round(params.width),
        height: Math.round(params.height),
      };
      if (group.x === next.x && group.y === next.y && group.width === next.width && group.height === next.height)
        return;
      void run(() => api.patchTopologyGroup(taskId, group.id, groupBody(group, next)), "Group size saved");
    },
    [run, taskId],
  );

  // NodeToolbar's "Delete group" on a selected group: the toolbar already confirmed twice, so execute directly.
  const handleGroupDelete = React.useCallback(
    (group: TopologyGraphGroup) => {
      void run(() => api.deleteTopologyGroup(taskId, group.id), "Group deleted; members kept on the canvas");
    },
    [run, taskId],
  );

  const handleBoxSelect = React.useCallback((rect: BoxSelectRect, members: TopologyGraphNode[]) => {
    if (members.length === 0) {
      toast.info("No nodes in the selected area");
      return;
    }
    // Entering the group-creation flow exits box-select mode; the dialog takes over further interaction.
    setBoxSelectMode(false);
    setBoxGroup({ rect, members });
  }, []);

  if (loading) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading topology…
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">Failed to load topology: {loadError ?? "unknown error"}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <TopologyToolbar
        taskId={taskId}
        graph={graph}
        run={run}
        onGraph={setGraph}
        connectMode={connectMode}
        onToggleConnect={() => {
          setConnectFrom(null);
          setConnectMode((prev) => !prev);
        }}
        boxSelectMode={boxSelectMode}
        onToggleBoxSelect={() => setBoxSelectMode((prev) => !prev)}
        renamingGroup={renamingGroup}
        onCloseRename={() => setRenamingGroup(null)}
      />
      <TopologyCanvas
        graph={graph}
        taskId={taskId}
        selectedIP={selectedIP}
        connectMode={connectMode}
        connectFrom={connectFrom}
        busy={busy}
        boxSelectMode={boxSelectMode}
        onBoxSelect={handleBoxSelect}
        onNodeClick={handleNodeClick}
        onGroupRename={setRenamingGroup}
        onGroupDelete={handleGroupDelete}
        onGroupMoved={handleGroupMoved}
        onGroupResized={handleGroupResized}
        onNodeMoved={handleNodeMoved}
        onPaneClick={() => {
          setConnectFrom(null);
          setConnectMode(false);
          setSelectedIP(null);
        }}
      />
      <TopologyNodeDrawer
        taskId={taskId}
        graph={graph}
        ip={selectedIP}
        onGraph={setGraph}
        onClose={() => setSelectedIP(null)}
        onDeleted={() => setSelectedIP(null)}
      />
      <AddGroupDialog
        taskId={taskId}
        graph={graph}
        run={run}
        open={boxGroup !== null}
        onOpenChange={(open) => {
          if (!open) setBoxGroup(null);
        }}
        prefill={boxGroup}
      />
      <CreateEdgeDialog taskId={taskId} pair={connPair} run={run} onClose={() => setConnPair(null)} />
    </div>
  );
}
