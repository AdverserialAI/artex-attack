/**
 * topology-node-drawer.tsx: topology node detail drawer (property editing, incoming-edge management, notes, asset links).
 * Main functions/types:
 *   - TopologyNodeDrawer: main node detail drawer component
 *   - ColorPicker / COLOR_PRESETS: color picker shared by nodes/edges and its 8 presets
 *   - DetailRow: label-value display row (reused by other panels)
 */
"use client";

import * as React from "react";

import { ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { TopologyEdgeKind, TopologyGraph, TopologyGraphEdge, TopologyGraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AssetRefsSection, RawJSON, useIPAssetRefs } from "./asset-refs-section";
import { EDGE_KIND_META, EDGE_KIND_OPTIONS, ENTRY_STATUS_LABEL, nodeTitle } from "./graph-model";

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** Text color for entry status; unregistered statuses fall back to neutral. */
const ENTRY_TEXT_TONE: Record<string, string> = {
  confirmed: "text-emerald-600 dark:text-emerald-400",
  suspected: "text-amber-600 dark:text-amber-400",
};

/** Color presets covering common annotation needs, alongside the native color picker and a "Default" reset. */
export const COLOR_PRESETS = ["#1d4ed8", "#0e7490", "#047857", "#65a30d", "#b45309", "#dc2626", "#7c3aed", "#be185d"];

/**
 * Color picker shared by nodes/connections: 8 preset swatches + native picker + "Default" reset ("").
 * Exported for reuse by topology-edge-dialog to avoid another file.
 */
export function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLOR_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-label={`Color ${preset}`}
          disabled={disabled}
          onClick={() => onChange(preset)}
          className={cn(
            "size-5 rounded-full border border-black/10 transition-shadow disabled:cursor-not-allowed disabled:opacity-50",
            value === preset && "ring-2 ring-blue-500 ring-offset-1 ring-offset-background",
          )}
          style={{ backgroundColor: preset }}
        />
      ))}
      <label
        className="relative flex h-5 cursor-pointer items-center overflow-hidden rounded border border-black/10 disabled:cursor-not-allowed"
        title="Custom color"
      >
        <input
          type="color"
          value={value || "#666666"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-7 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!value || disabled}
        onClick={() => onChange("")}
        className="h-6 px-2 text-xs"
      >
        Default
      </Button>
    </div>
  );
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-start gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function EditableTextRow({
  label,
  value,
  pending,
  onSave,
}: {
  label: string;
  value: string;
  pending: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState(value);
  const dirty = draft !== value;
  React.useEffect(() => setDraft(value), [value]);
  return (
    <DetailRow label={label}>
      <div className="flex items-center gap-1.5">
        <Input value={draft} maxLength={255} onChange={(e) => setDraft(e.target.value)} disabled={pending} />
        <Button variant="outline" size="sm" disabled={pending || !dirty} onClick={() => void onSave(draft.trim())}>
          <Save className="size-3.5" />
          Save
        </Button>
      </div>
    </DetailRow>
  );
}

function EditableDescriptionRow({
  value,
  pending,
  onSave,
}: {
  value: string;
  pending: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState(value);
  const dirty = draft !== value;
  React.useEffect(() => setDraft(value), [value]);
  return (
    <DetailRow label="Node description">
      <div className="flex flex-col gap-1.5">
        <textarea
          className="min-h-16 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          value={draft}
          maxLength={500}
          placeholder="What this asset is (service/port/OS/container…); leave empty to hide"
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
        />
        <Button
          variant="outline"
          size="sm"
          className="self-end"
          disabled={pending || !dirty}
          onClick={() => void onSave(draft.trim())}
        >
          <Save className="size-3.5" />
          Save
        </Button>
      </div>
    </DetailRow>
  );
}

function KindSelect({
  value,
  onValueChange,
  className,
}: {
  value: TopologyEdgeKind;
  onValueChange: (kind: TopologyEdgeKind) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as TopologyEdgeKind)}>
      <SelectTrigger size="sm" className={cn("w-28", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EDGE_KIND_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IncomingEdgeRow({
  edge,
  disabled,
  onSave,
  onDelete,
}: {
  edge: TopologyGraphEdge;
  disabled: boolean;
  onSave: (edge: TopologyGraphEdge, patch: { label: string; kind: TopologyEdgeKind; color: string }) => void;
  onDelete: (edge: TopologyGraphEdge) => void;
}) {
  const [kind, setKind] = React.useState<TopologyEdgeKind>(edge.kind);
  const [label, setLabel] = React.useState(edge.label);
  const [color, setColor] = React.useState(edge.color);
  React.useEffect(() => {
    setKind(edge.kind);
    setLabel(edge.label);
    setColor(edge.color);
  }, [edge.kind, edge.label, edge.color]);
  const dirty = kind !== edge.kind || label !== edge.label || color !== edge.color;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-[11px]">Source</span>
        <span className="truncate font-mono text-xs">{edge.src_ip}</span>
        <span className={cn("ml-auto rounded border px-1.5 py-0.5 text-[10px]", EDGE_KIND_META[kind].chip)}>
          {EDGE_KIND_META[kind].label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <KindSelect value={kind} onValueChange={setKind} />
        <input
          value={label}
          maxLength={200}
          placeholder="Connection label, e.g. accessed via a shared ops terminal"
          onChange={(e) => setLabel(e.target.value)}
          className="border-input h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:border-blue-400"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Color</span>
        <ColorPicker value={color} onChange={setColor} disabled={disabled} />
      </div>
      <div className="flex items-center gap-2">
        {edge.evidence_ref ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {edge.evidence_ref}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-[10px]">No evidence reference</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !dirty}
            onClick={() => onSave(edge, { label, kind, color })}
          >
            <Save className="size-3.5" />
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDelete(edge)}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddEdgeForm({
  node,
  graph,
  disabled,
  onSubmit,
}: {
  node: TopologyGraphNode;
  graph: TopologyGraph;
  disabled: boolean;
  onSubmit: (edge: { src_ip: string; kind: TopologyEdgeKind; label: string }) => void;
}) {
  const others = graph.nodes.filter((n) => n.ip !== node.ip);
  const [src, setSrc] = React.useState(others[0]?.ip ?? "");
  const [kind, setKind] = React.useState<TopologyEdgeKind>("solid");
  const [label, setLabel] = React.useState("");

  if (others.length === 0) {
    return <p className="text-muted-foreground text-xs">This is the only node in the graph — add more nodes before creating connections.</p>;
  }

  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <Select value={src} onValueChange={setSrc}>
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue placeholder="Source node" />
          </SelectTrigger>
          <SelectContent>
            {others.map((n) => (
              <SelectItem key={n.ip} value={n.ip}>
                {nodeTitle(n)} · {n.ip}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <KindSelect value={kind} onValueChange={setKind} />
      </div>
      <div className="flex items-center gap-2">
        <input
          value={label}
          maxLength={200}
          placeholder="Connection label (optional)"
          onChange={(e) => setLabel(e.target.value)}
          className="border-input h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:border-blue-400"
        />
        <Button size="sm" disabled={disabled || !src} onClick={() => onSubmit({ src_ip: src, kind, label })}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

export function TopologyNodeDrawer({
  taskId,
  graph,
  ip,
  onGraph,
  onClose,
  onDeleted,
}: {
  taskId: string;
  graph: TopologyGraph;
  ip: string | null;
  onGraph: (graph: TopologyGraph) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const node = ip ? (graph.nodes.find((n) => n.ip === ip) ?? null) : null;
  const refs = useIPAssetRefs(taskId, node?.ip ?? null);
  const [pending, setPending] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [rawOpen, setRawOpen] = React.useState(false);

  // Selecting another node resets the note draft and the raw-data fold.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selecting another node intentionally resets the note draft.
  React.useEffect(() => {
    setNote("");
    setRawOpen(false);
  }, [ip]);

  const incoming = node ? graph.edges.filter((e) => e.dst_ip === node.ip) : [];
  const group = node?.group_id != null ? graph.groups.find((g) => g.id === node.group_id) : undefined;
  const notes = node ? (graph.notes[node.ip] ?? []) : [];

  async function run(task: () => Promise<TopologyGraph>, success?: string) {
    setPending(true);
    try {
      const next = await task();
      onGraph(next);
      if (success) toast.success(success);
      return next;
    } catch (reason) {
      toast.error(`Operation failed: ${errorText(reason)}`);
      return null;
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-xl">
        {node && (
          <>
            <SheetHeader className="border-b p-4">
              <SheetTitle className="pr-8 leading-tight">{nodeTitle(node)}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {node.ip}
                {node.display_label ? ` · ${node.display_label}` : ""}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex w-full min-w-0 flex-col gap-5 p-4">
                <section>
                  <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
                    <div className="mb-1 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Raw data</h3>
                      <CollapsibleTrigger asChild>
                        <Button size="sm" variant="ghost">
                          {rawOpen ? "Collapse" : "Expand"}
                          <ChevronDown className={cn("size-3.5 transition-transform", rawOpen && "rotate-180")} />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="flex flex-col gap-3">
                      <RawJSON value={node} />
                      <AssetRefsSection refs={refs} />
                      {!refs && (
                        <p className="text-muted-foreground text-xs">This IP is not registered in the current task's assets — no linked intents/findings.</p>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </section>

                <section>
                  <h3 className="mb-1 text-sm font-semibold">Host information</h3>
                  <DetailRow label="IP">{node.ip}</DetailRow>
                  <EditableTextRow
                    label="Hostname"
                    value={node.hostname}
                    pending={pending}
                    onSave={async (next) => {
                      await run(async () => api.patchTopologyNode(taskId, node.ip, { hostname: next }), "Hostname saved");
                    }}
                  />
                  <EditableTextRow
                    label="Display name"
                    value={node.display_label}
                    pending={pending}
                    onSave={async (next) => {
                      await run(
                        async () => api.patchTopologyNode(taskId, node.ip, { display_label: next }),
                        "Display name saved",
                      );
                    }}
                  />
                  <EditableDescriptionRow
                    value={node.description ?? ""}
                    pending={pending}
                    onSave={async (next) => {
                      await run(
                        async () => api.patchTopologyNode(taskId, node.ip, { description: next }),
                        "Node description saved",
                      );
                    }}
                  />
                  <DetailRow label="Entry status">
                    <span className={cn(ENTRY_TEXT_TONE[node.entry_status] ?? "text-muted-foreground")}>
                      {ENTRY_STATUS_LABEL[node.entry_status] ?? "Not an entry"}
                    </span>
                  </DetailRow>
                  <DetailRow label="Group">{group?.name ?? "Ungrouped"}</DetailRow>
                  <DetailRow label="Color">
                    <div className="flex items-center gap-2">
                      {node.color ? (
                        <span
                          className="size-3.5 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: node.color }}
                        />
                      ) : (
                        <span className="text-muted-foreground">Default</span>
                      )}
                      <ColorPicker
                        value={node.color}
                        disabled={pending}
                        onChange={(color) =>
                          void run(
                            () => api.patchTopologyNode(taskId, node.ip, { color }),
                            color ? "Color updated" : "Default color restored",
                          )
                        }
                      />
                    </div>
                  </DetailRow>
                  {node.entry_status === "suspected" && (
                    <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50/60 p-2 dark:bg-amber-950/40">
                      <p className="text-muted-foreground flex-1 text-xs">
                        This node is a suspected entry. Confirming it demotes all other nodes to regular hosts on the backend.
                      </p>
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void run(
                            () => api.patchTopologyNode(taskId, node.ip, { entry_status: "confirmed" }),
                            "Marked as entry",
                          )
                        }
                      >
                        Confirm entry
                      </Button>
                    </div>
                  )}
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    Connections
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                      {incoming.length} pointing at this node
                    </span>
                  </h3>
                  {incoming.length === 0 && <p className="text-muted-foreground text-xs">No other nodes point at it yet.</p>}
                  {incoming.map((edge) => (
                    <IncomingEdgeRow
                      key={edge.id}
                      edge={edge}
                      disabled={pending}
                      onSave={(target, patch) =>
                        void run(() => api.patchTopologyEdge(taskId, target.id, patch), "Connection updated")
                      }
                      onDelete={(target) => void run(() => api.deleteTopologyEdge(taskId, target.id), "Connection deleted")}
                    />
                  ))}
                  <AddEdgeForm
                    node={node}
                    graph={graph}
                    disabled={pending}
                    onSubmit={(edge) =>
                      void run(
                        () =>
                          api.addTopologyEdge(taskId, {
                            src_ip: edge.src_ip,
                            dst_ip: node.ip,
                            kind: edge.kind,
                            label: edge.label,
                          }),
                        "Connection added",
                      )
                    }
                  />
                </section>

                <section>
                  <h3 className="mb-1.5 text-sm font-semibold">Manual notes</h3>
                  <Textarea
                    value={note}
                    maxLength={4000}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Record manual judgments without altering the original evidence."
                    className="min-h-20"
                  />
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    disabled={pending || !note.trim()}
                    onClick={() =>
                      void run(async () => {
                        const next = await api.addTopologyNote(taskId, node.ip, note.trim());
                        setNote("");
                        return next;
                      }, "Note saved")
                    }
                  >
                    <Save className="size-3.5" />
                    Save note
                  </Button>
                  <div className="mt-3 flex flex-col gap-2">
                    {notes.length === 0 && <p className="text-muted-foreground text-xs">No manual notes yet.</p>}
                    {notes.map((item) => (
                      <div key={item.id} className="rounded-md border p-2.5 text-xs">
                        <p className="whitespace-pre-wrap">{item.body}</p>
                        <p className="text-muted-foreground mt-1.5">
                          {item.created_by || "Unknown source"} · {formatTime(item.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-t pt-3">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={pending}>
                        <Trash2 className="size-3.5" />
                        Delete node
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete node {node.ip}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Its connections are deleted too; orphaned nodes are demoted to suspected entries by the backend.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            void run(async () => {
                              const next = await api.deleteTopologyNode(taskId, node.ip);
                              onDeleted();
                              return next;
                            }, "Node deleted")
                          }
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
