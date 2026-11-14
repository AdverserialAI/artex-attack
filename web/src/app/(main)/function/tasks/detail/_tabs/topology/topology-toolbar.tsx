/**
 * topology-toolbar.tsx: topology toolbar (auto layout, grouping, import/export, connect/box-select toggles) and group dialogs.
 * Main functions/types:
 *   - TopologyToolbar: main toolbar component; TopologyRun: unified write executor (request + toast + graph refresh)
 *   - AddGroupDialog / RenameGroupDialog: create (with box-select prefill) and rename group dialogs
 *   - BoxGroupPrefill: prefill geometry and members for box-select grouping
 */
"use client";

import * as React from "react";

import { BoxSelect, Download, Group, LayoutGrid, Link2, Loader2, Sparkles, Upload } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { TopologyGraph, TopologyGraphGroup, TopologyGraphNode } from "@/lib/types";

import { applyC24Grouping, markC24Grouped } from "./c24-groups";
import { exportDrawIO, exportGraphML } from "./export-formats";
import {
  autoLayout,
  buildExportPayload,
  downloadJSON,
  GROUP_DEFAULT_H,
  GROUP_DEFAULT_W,
  nextGroupPlacement,
} from "./graph-model";
import { TopologyImportDialog } from "./topology-import-dialog";

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

export type TopologyRun = (
  task: () => Promise<TopologyGraph>,
  success?: string,
  options?: { rethrowOnError?: boolean },
) => Promise<TopologyGraph | null>;

/** Prefill geometry and members for box-select grouping (from the canvas's onBoxSelect). */
export type BoxGroupPrefill = {
  rect: { x: number; y: number; width: number; height: number };
  members: TopologyGraphNode[];
};

export function AddGroupDialog({
  taskId,
  graph,
  run,
  open,
  onOpenChange,
  prefill = null,
}: {
  taskId: string;
  graph: TopologyGraph;
  run: TopologyRun;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: BoxGroupPrefill | null;
}) {
  const [name, setName] = React.useState("");

  // Clear the name draft on open (box-select prefill leaves the name empty for the user to fill).
  React.useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function handleSubmit() {
    const groupName = name.trim();
    if (!groupName) {
      toast.error("Please enter a group name");
      return;
    }
    // Box-select prefill: group geometry comes from the selection rect (with a minimum-size fallback); otherwise auto-place to the right.
    const geometry = prefill
      ? {
          x: Math.round(prefill.rect.x),
          y: Math.round(prefill.rect.y),
          width: Math.max(Math.round(prefill.rect.width), 160),
          height: Math.max(Math.round(prefill.rect.height), 100),
        }
      : { ...nextGroupPlacement(graph), width: GROUP_DEFAULT_W, height: GROUP_DEFAULT_H };
    const next = await run(async () => {
      let current = await api.addTopologyGroup(taskId, { name: groupName, ...geometry });
      if (prefill && prefill.members.length > 0) {
        // The backend only returns the full graph: locate the new group by name + geometry, then move members in one by one.
        const created = current.groups.find(
          (group) =>
            group.name === groupName &&
            group.x === geometry.x &&
            group.y === geometry.y &&
            group.width === geometry.width &&
            group.height === geometry.height,
        );
        if (created) {
          for (const member of prefill.members) {
            current = await api.patchTopologyNode(taskId, member.ip, { group_id: created.id });
          }
        }
      }
      return current;
    }, "Group added");
    if (next) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add group</DialogTitle>
          <DialogDescription>
            {prefill
              ? `The ${prefill.members.length} nodes in the selection will be added to this group.`
              : "Drag nodes into the frame to group them; the frame itself can be dragged as a whole."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="topology-group-name">Group name</Label>
          <Input
            id="topology-group-name"
            value={name}
            maxLength={120}
            placeholder="e.g. Ops subnet"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameGroupDialog({
  taskId,
  group,
  run,
  onClose,
}: {
  taskId: string;
  group: TopologyGraphGroup | null;
  run: TopologyRun;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    setName(group?.name ?? "");
  }, [group]);

  async function handleSubmit() {
    if (!group) return;
    const next = await run(
      () =>
        api.patchTopologyGroup(taskId, group.id, {
          name: name.trim() || group.name,
          x: group.x,
          y: group.y,
          width: group.width,
          height: group.height,
          color: group.color,
        }),
      "Group updated",
    );
    if (next) onClose();
  }

  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  // Reset confirmation state during render on group switch (React's recommended derive-state pattern, avoids effect-dependency warnings).
  const [confirmingFor, setConfirmingFor] = React.useState<number | null>(null);
  if ((group?.id ?? null) !== confirmingFor) {
    setConfirmingFor(group?.id ?? null);
    setConfirmingDelete(false);
  }

  async function handleDelete() {
    if (!group) return;
    const next = await run(() => api.deleteTopologyGroup(taskId, group.id), "Group deleted; members kept on the canvas");
    if (next) onClose();
  }

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="topology-group-rename">Group name</Label>
          <Input
            id="topology-group-rename"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {confirmingDelete ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
              title="Member nodes stay on the canvas (leaving the group)"
            >
              Confirm delete? Members kept
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmingDelete(true)}>
              Delete group
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TopologyToolbar({
  taskId,
  graph,
  run,
  onGraph,
  connectMode,
  onToggleConnect,
  boxSelectMode,
  onToggleBoxSelect,
  renamingGroup,
  onCloseRename,
}: {
  taskId: string;
  graph: TopologyGraph;
  run: TopologyRun;
  onGraph: (graph: TopologyGraph) => void;
  connectMode: boolean;
  onToggleConnect: () => void;
  boxSelectMode: boolean;
  onToggleBoxSelect: () => void;
  renamingGroup: TopologyGraphGroup | null;
  onCloseRename: () => void;
}) {
  const [addGroupOpen, setAddGroupOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [exporting, setExporting] = React.useState(false);

  async function runWithBusy(operation: () => Promise<TopologyGraph>, action: string) {
    // React state commits asynchronously; the synchronous lock prevents rapid double-clicks from starting a second write.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await run(operation, undefined, { rethrowOnError: true });
    } catch (reason) {
      toast.error(`${action} failed: ${errorText(reason)}; some changes may have taken effect — reloading topology`);
      try {
        onGraph(await api.taskTopology(taskId));
      } catch (reloadReason) {
        toast.error(`Failed to reload topology: ${errorText(reloadReason)}`);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Layout and grouping are decoupled: auto arrange only repositions coordinates and never forces nodes into frames;
  // use "Group by /24" when subnet grouping is wanted. busy is covered by the outer layer for the whole write flow.
  async function layoutGraph(working: TopologyGraph) {
    const plan = autoLayout(working);
    if (plan.positions.size === 0 && plan.groupBoxes.size === 0) {
      toast.info("No nodes to auto arrange");
      return working;
    }
    let current = working;
    for (const [id, box] of plan.groupBoxes) {
      const group = current.groups.find((g) => g.id === id);
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
    toast.success(`Rearranged ${plan.positions.size} nodes and ${plan.groupBoxes.size} group frames`);
    return current;
  }

  async function handleAutoLayout() {
    await runWithBusy(() => layoutGraph(graph), "Auto arrange");
  }

  async function handleC24Group() {
    await runWithBusy(async () => {
      const working = await applyC24Grouping(taskId, graph);
      const current = await layoutGraph(working);
      markC24Grouped(taskId);
      return current;
    }, "Group by /24");
  }

  async function handleExportJSON() {
    setExporting(true);
    try {
      const coverage = await api.taskCoverageGraph(taskId).catch(() => null);
      const payload = buildExportPayload(taskId, graph, coverage);
      downloadJSON(`artex-asset-graph-${taskId}.json`, payload);
      toast.success("JSON exported");
    } finally {
      setExporting(false);
    }
  }

  function downloadText(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportGraphML() {
    downloadText(`artex-topology-${taskId}.graphml`, exportGraphML(graph), "application/graphml+xml");
    toast.success("GraphML exported (open and edit with yEd/Gephi/draw.io)");
  }

  function handleExportDrawIO() {
    downloadText(`artex-topology-${taskId}.drawio`, exportDrawIO(graph), "application/xml");
    toast.success("draw.io file exported (open and edit with diagrams.net)");
  }

  const emptyGraph = graph.nodes.length === 0;

  async function handleSeed() {
    const next = await run(() => api.seedTopology(taskId), "Initial topology generated from task assets");
    if (next) onGraph(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={connectMode ? "default" : "outline"}
        onClick={onToggleConnect}
        aria-pressed={connectMode}
      >
        <Link2 className="size-3.5" />
        Add connection
      </Button>
      <Button size="sm" variant="outline" onClick={() => setAddGroupOpen(true)}>
        <Group className="size-3.5" />
        Add group
      </Button>
      <Button
        size="sm"
        variant={boxSelectMode ? "default" : "outline"}
        onClick={onToggleBoxSelect}
        aria-pressed={boxSelectMode}
        title="Drag a selection rectangle on empty canvas to group the nodes inside it"
      >
        <BoxSelect className="size-3.5" />
        Box-select & group
      </Button>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <Button size="sm" variant="outline" onClick={() => void handleAutoLayout()} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LayoutGrid className="size-3.5" />}
        Auto arrange
      </Button>
      <Button size="sm" variant="outline" onClick={() => void handleC24Group()} disabled={busy}>
        <Group className="size-3.5" />Group by /24
      </Button>
      <Separator orientation="vertical" className="mx-1 h-6" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={exporting}>
            <Download className="size-3.5" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void handleExportJSON()}>JSON (artex format, re-importable)</DropdownMenuItem>
          <DropdownMenuItem onSelect={handleExportGraphML}>GraphML（yEd / Gephi / draw.io）</DropdownMenuItem>
          <DropdownMenuItem onSelect={handleExportDrawIO}>draw.io（diagrams.net）</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
        <Upload className="size-3.5" />
        Import JSON
      </Button>
      {emptyGraph && (
        <>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Button size="sm" onClick={() => void handleSeed()} disabled={busy}>
            <Sparkles className="size-3.5" />
            Generate initial topology from assets
          </Button>
        </>
      )}

      <AddGroupDialog taskId={taskId} graph={graph} run={run} open={addGroupOpen} onOpenChange={setAddGroupOpen} />
      <RenameGroupDialog taskId={taskId} group={renamingGroup} run={run} onClose={onCloseRename} />
      <TopologyImportDialog
        taskId={taskId}
        graph={graph}
        onGraph={onGraph}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  );
}
