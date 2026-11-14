/**
 * page.tsx: Agent management page — card grid, create dialog, and edit drawer.
 * Main functions/types:
 *   - AgentsPage: default-exported page component; loads the agent list and manages the edit Sheet / template library panel
 *   - AgentGridCard: clickable agent tile (with delete button and template library entry)
 *   - CreateAgentDialog: dialog for creating an agent
 */
"use client";

import * as React from "react";

import { Bot, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { AgentEditor } from "@/components/agent-editor";
// [fork P-TPL U8] begin
import { PlannerTemplateManager, WorkerTemplateManager } from "@/components/prompt-template-manager";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";

// [fork P-TPL U8] end

// [fork P-TPL U8 AgentGridCard planner tile entry chip]
// Feature: AgentGridCard takes an optional onOpenPlannerTemplates prop — passed only by the planner tile,
//           rendering a "Prompts: template library →" chip in the stats row that opens the planner template management Sheet (U8-c)

// AgentGridCard is one clickable tile opening the agent's editor drawer. Custom
// (non-builtin) agents get a delete button.
function AgentGridCard({
  agent,
  onOpen,
  onDeleted,
  onOpenPlannerTemplates, // [fork P-TPL U8] planner tile only: opens the planner template management panel
  onOpenWorkerTemplates,
}: {
  agent: Agent;
  onOpen: () => void;
  onDeleted: () => void;
  onOpenPlannerTemplates?: () => void; // [fork P-TPL U8]
  onOpenWorkerTemplates?: () => void;
}) {
  async function del() {
    try {
      await api.deleteAgent(agent.key);
      toast.success(`Agent \"${agent.name}\" deleted`);
      onDeleted();
    } catch (e) {
      toast.error("Delete failed: " + (e as Error).message);
    }
  }
  return (
    <div className="hover:border-primary/50 group relative flex flex-col gap-2 rounded-lg border p-4 transition-colors">
      <button type="button" onClick={onOpen} className="flex flex-col gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">{agent.name}</span>
          <span className="text-muted-foreground font-mono text-xs">{agent.key}</span>
          {agent.builtin ? (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              Built-in
            </Badge>
          ) : (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              Custom
            </Badge>
          )}
          {!agent.enabled && (
            <Badge variant="outline" className="text-destructive px-1.5 py-0 text-[10px]">
              Disabled
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground line-clamp-2 min-h-8 text-xs">{agent.description || "(no description)"}</p>
        <div className="text-muted-foreground flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded border px-1.5 py-0.5">MCP {agent.mcp_count ?? 0}</span>
          <span className="rounded border px-1.5 py-0.5">Skill {agent.skill_count ?? 0}</span>
          <span className="rounded border px-1.5 py-0.5">Tools: {agent.tool_count ?? 0}</span>
          {/* [fork P-TPL U8] begin — "Prompts: template library →" chip opens the planner template Sheet (span, not <a>/<button>: no interactive elements nested in a button) */}
          {onOpenPlannerTemplates && (
            <span
              className="hover:border-foreground cursor-pointer rounded border px-1.5 py-0.5"
              title="Planner prompts are managed by the template library; pick a template when creating a task, otherwise the default template is used"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPlannerTemplates();
              }}
            >
              Prompts: template library →
            </span>
          )}
          {onOpenWorkerTemplates && (
            <span
              className="hover:border-foreground cursor-pointer rounded border px-1.5 py-0.5"
              title="Worker prompts are managed by the template library; pick a template when creating a task, otherwise the default template is used"
              onClick={(e) => {
                e.stopPropagation();
                onOpenWorkerTemplates();
              }}
            >
              Prompts: template library →
            </span>
          )}
          {/* [fork P-TPL U8] end */}
        </div>
      </button>
      {!agent.builtin && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Agent "{agent.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Its prompts, variables, visibility, and tool bindings are deleted too. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={del}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CreateAgentDialog({ onCreated }: { onCreated: (key: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    setBusy(true);
    try {
      const a = await api.createAgent(key.trim(), name.trim(), description.trim());
      toast.success(`Agent \"${a.name}\" created`);
      setOpen(false);
      setKey("");
      setName("");
      setDescription("");
      onCreated(a.key);
    } catch (e) {
      toast.error("Create failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const keyOk = /^[a-z][a-z0-9_]*$/.test(key.trim());
  const canCreate = keyOk && name.trim().length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> New Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom Agent</DialogTitle>
          <DialogDescription>
            Create a conversational assistant. The key is an internal identifier and cannot be changed after creation; name and description are for identification.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-key">Key</Label>
            <Input
              id="agent-key"
              placeholder="e.g. research_helper"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="font-mono"
            />
            {key.length > 0 && !keyOk && (
              <span className="text-destructive text-xs">Starts with a lowercase letter; lowercase letters, digits, and underscores only</span>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input id="agent-name" placeholder="e.g. Research assistant" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Textarea
              id="agent-desc"
              placeholder="One sentence about what this Agent does"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={!canCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [editKey, setEditKey] = React.useState<string | null>(null);
  // [fork P-TPL U8] begin —— planner template panel open state (template data is managed by PlannerTemplateManager itself; this page does not fetch the list)
  const [plannerTplMgrOpen, setPlannerTplMgrOpen] = React.useState(false);
  const [workerTplMgrOpen, setWorkerTplMgrOpen] = React.useState(false);
  // [fork P-TPL U8] end

  const reload = React.useCallback(() => {
    api
      .agents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const editing = agents.find((a) => a.key === editKey) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agent</h1>
          <p className="text-muted-foreground text-sm">Prompts/configuration of built-in Agents, plus creation and management of custom conversational Agents</p>
        </div>
        <CreateAgentDialog
          onCreated={(key) => {
            reload();
            setEditKey(key);
          }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent inventory</CardTitle>
          <CardDescription>{agents.length} total</CardDescription>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">(no Agents)</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((a) => (
                <AgentGridCard
                  key={a.key}
                  agent={a}
                  onOpen={() => setEditKey(a.key)}
                  onDeleted={reload}
                  // [fork P-TPL U8] begin
                  onOpenPlannerTemplates={a.key === "planner" ? () => setPlannerTplMgrOpen(true) : undefined}
                  onOpenWorkerTemplates={a.key === "worker" ? () => setWorkerTplMgrOpen(true) : undefined}
                  // [fork P-TPL U8] end
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* [fork P-TPL U8] begin —— planner template management Sheet opened via the planner tile's "Prompts: template library →" chip */}
      <PlannerTemplateManager open={plannerTplMgrOpen} onOpenChange={setPlannerTplMgrOpen} />
      <WorkerTemplateManager open={workerTplMgrOpen} onOpenChange={setWorkerTplMgrOpen} />
      {/* [fork P-TPL U8] end */}

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditKey(null)}>
        <SheetContent
          side="right"
          className="flex flex-col gap-0 p-0 data-[side=right]:w-[45vw] data-[side=right]:sm:max-w-[45vw]"
        >
          {editing && (
            <>
              <SheetHeader className="px-4">
                <SheetTitle className="flex items-center gap-2">
                  {editing.name}
                  <span className="text-muted-foreground font-mono text-xs">{editing.key}</span>
                  {!editing.builtin && (
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      Custom
                    </Badge>
                  )}
                </SheetTitle>
                <SheetDescription>{editing.description || "Prompts, configuration, visible resources, and tool bindings"}</SheetDescription>
              </SheetHeader>
              <AgentEditor agentKey={editing.key} onSaved={reload} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
