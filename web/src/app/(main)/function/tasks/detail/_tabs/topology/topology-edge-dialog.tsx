/**
 * topology-edge-dialog.tsx: dialog for creating topology edges (line type, label, color selection).
 * Main functions/types:
 *   - CreateEdgeDialog: form dialog that submits a new edge to the backend; ConnPair: source/target IP pair to connect
 */
"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { TopologyEdgeInput, TopologyEdgeKind } from "@/lib/types";

import { EDGE_KIND_META, EDGE_KIND_OPTIONS } from "./graph-model";
import { ColorPicker } from "./topology-node-drawer";
import type { TopologyRun } from "./topology-toolbar";

export type ConnPair = { src: string; dst: string };

export function CreateEdgeDialog({
  taskId,
  pair,
  run,
  onClose,
}: {
  taskId: string;
  pair: ConnPair | null;
  run: TopologyRun;
  onClose: () => void;
}) {
  const [kind, setKind] = React.useState<TopologyEdgeKind>("solid");
  const [label, setLabel] = React.useState("");
  const [color, setColor] = React.useState("");

  // A new pair resets the form.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pair intentionally resets the form.
  React.useEffect(() => {
    setKind("solid");
    setLabel("");
    setColor("");
  }, [pair]);

  async function handleSubmit() {
    if (!pair) return;
    const body: TopologyEdgeInput = {
      src_ip: pair.src,
      dst_ip: pair.dst,
      kind,
      label: label.trim(),
    };
    if (color) body.color = color;
    const next = await run(() => api.addTopologyEdge(taskId, body), "Connection added");
    if (next) onClose();
  }

  return (
    <Dialog
      open={pair !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription className="font-mono text-xs">{pair ? `${pair.src} → ${pair.dst}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topology-edge-kind">Connection type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as TopologyEdgeKind)}>
              <SelectTrigger id="topology-edge-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDGE_KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label} · {EDGE_KIND_META[opt.value].hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="topology-edge-label">Connection label</Label>
            <Input
              id="topology-edge-label"
              value={label}
              maxLength={200}
              placeholder="Leave empty to use the default name for the type"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
            <p className="text-muted-foreground text-xs">Evidence references are written by Agents; manually added connections are shown with the selected type first.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color (optional)</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pair === null} onClick={() => void handleSubmit()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
