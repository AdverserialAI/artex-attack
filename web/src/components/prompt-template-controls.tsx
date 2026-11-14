/**
 * prompt-template-controls.tsx: prompt template picker + inline override controls; deduplicated via an adapter serving both planner and worker domains.
 * Main functions/types:
 *   - PromptTemplateControls: generic template picker (adapter injects list endpoint and copy)
 *   - PlannerTemplateControls / WorkerTemplateControls: planner / worker domain entries, each bound to its adapter
 *   - PromptTemplateControlsAdapter: domain-difference injection interface
 */
"use client";

import * as React from "react";

import { LibraryIcon, Settings2Icon } from "lucide-react";
import { toast } from "sonner";

import { PlannerTemplateManager, WorkerTemplateManager } from "@/components/prompt-template-manager";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { PlannerTemplate } from "@/lib/types";

// PromptTemplateControlsAdapter injects the domain differences of the planner/worker template controls: list endpoint,
// inline management panel component, and all copy. The two domains' control logic was previously identical line for line.
interface PromptTemplateControlsAdapter {
  // Template list loading endpoint.
  list: () => Promise<PlannerTemplate[]>;
  // Toast prefix for load failures (e.g. "Failed to load planner templates").
  loadErrorPrefix: string;
  // Template picker label / id / empty state / description.
  pickerLabel: string;
  pickerId: string;
  emptyText: string;
  pickerDescription: string;
  // Prompt-override input label / id / placeholder / description.
  overrideLabel: string;
  overrideId: string;
  overridePlaceholder: string;
  overrideDescription: string;
  // Template management panel component opened inline.
  Manager: React.ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;
}

interface PromptTemplateControlsProps {
  templateID: number | null; // selected template; null = follow the library default
  onTemplateIDChange: (id: number | null) => void;
  prompt: string; // prompt override; '' = no override (template body is auto-filled on selection and can be edited)
  onPromptChange: (v: string) => void;
  adapter: PromptTemplateControlsAdapter;
  portalContainer?: React.RefObject<HTMLDivElement | null>; // Combobox popover mount point (scroll container inside a Sheet)
  // Extension area: extra controls injected by the host (e.g. planner's Worker count input), rendered after the override box and before the management panel.
  children?: React.ReactNode;
}

export function PromptTemplateControls({
  templateID,
  onTemplateIDChange,
  prompt,
  onPromptChange,
  adapter,
  portalContainer,
  children,
}: PromptTemplateControlsProps) {
  const [templates, setTemplates] = React.useState<PlannerTemplate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inputValue, setInputValue] = React.useState("");
  // [fork P-TPL U9] begin — template management panel open state (managed inline, no page jump)
  const [mgrOpen, setMgrOpen] = React.useState(false);
  // [fork P-TPL U9] end

  const loadTemplates = React.useCallback(() => {
    adapter
      .list()
      .then(setTemplates)
      .catch((e) => {
        setTemplates([]);
        toast.error(adapter.loadErrorPrefix + "：" + (e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [adapter]);

  React.useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const selectedTemplate = React.useMemo(
    () => templates.find((t) => t.id === templateID) ?? null,
    [templateID, templates],
  );

  React.useEffect(() => {
    setInputValue(selectedTemplate?.name ?? "");
  }, [selectedTemplate]);

  // Selecting a template = body filled into the override box (template as base, editable; manual edits win on submit — K22);
  // Clearing the selection = only unlink; the filled text is kept (the user may already be tweaking it).
  const chooseTemplate = (tpl: PlannerTemplate | null) => {
    if (!tpl) {
      setInputValue("");
      onTemplateIDChange(null);
      return;
    }
    setInputValue(tpl.name);
    onTemplateIDChange(tpl.id);
    onPromptChange(tpl.body);
    toast.success(`Template \"${tpl.name}\" loaded — tweak it below`);
  };

  let pickerPlaceholder = loading ? "Loading templates" : adapter.emptyText;
  if (!loading && templates.length > 0) pickerPlaceholder = "Default: follow the template library default";

  return (
    <>
      {/* Control 1: template picker + inline management entry */}
      <Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel htmlFor={adapter.pickerId}>{adapter.pickerLabel}</FieldLabel>
          {/* [fork P-TPL U9] begin — open the template panel inline (previously a two-step jump to /system/agents then chip click); list refreshes on close so new templates are immediately selectable */}
          <Button type="button" variant="ghost" size="sm" onClick={() => setMgrOpen(true)}>
            <Settings2Icon data-icon="inline-start" />
            Manage
          </Button>
          {/* [fork P-TPL U9] end */}
        </div>
        <Combobox
          items={templates}
          itemToStringLabel={(t) => t.name}
          itemToStringValue={(t) => String(t.id)}
          inputValue={inputValue}
          onInputValueChange={(value) => setInputValue(value)}
          value={selectedTemplate}
          onValueChange={chooseTemplate}
        >
          <ComboboxInput
            id={adapter.pickerId}
            className="w-full"
            placeholder={pickerPlaceholder}
            disabled={loading || templates.length === 0}
            showClear
          />
          <ComboboxContent portalContainer={portalContainer}>
            <ComboboxEmpty>No matching templates</ComboboxEmpty>
            <ComboboxList>
              {(t) => (
                <ComboboxItem key={t.id} value={t}>
                  <LibraryIcon />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t.name}
                      {t.is_default ? " (default)" : ""}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{t.body}</p>
                  </div>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <FieldDescription>{adapter.pickerDescription}</FieldDescription>
      </Field>

      {/* Control 2: prompt override (monospace Textarea with variable hints) */}
      <Field>
        <FieldLabel htmlFor={adapter.overrideId}>{adapter.overrideLabel}</FieldLabel>
        <Textarea
          id={adapter.overrideId}
          className="bg-muted/40 min-h-32 resize-y font-mono text-xs leading-relaxed"
          placeholder={adapter.overridePlaceholder}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
        />
        <FieldDescription>{adapter.overrideDescription}</FieldDescription>
      </Field>

      {/* Extension area (e.g. planner's Worker count control) */}
      {children}

      {/* [fork P-TPL U9] begin — template management panel (a Sheet within a Sheet via portal, no interference); list refreshes on close */}
      <adapter.Manager
        open={mgrOpen}
        onOpenChange={(o) => {
          setMgrOpen(o);
          if (!o) loadTemplates();
        }}
      />
      {/* [fork P-TPL U9] end */}
    </>
  );
}

// ── planner / worker adapters and fixed exports ──────────────────────────────────────────
// planner's Worker count input goes through the children extension area; everything else is identical across domains.

const plannerControlsAdapter: PromptTemplateControlsAdapter = {
  list: () => api.plannerTemplates(),
  loadErrorPrefix: "Failed to load planner templates",
  pickerLabel: "Planner template (planner)",
  pickerId: "planner-template-picker",
  emptyText: "No planner templates",
  pickerDescription:
    "Choose a planning-style template for the planner; its body is auto-filled into \"Planner prompt override\" below and can be edited. Precedence: manual override > selected template > default template.",
  overrideLabel: "Planner prompt override (optional)",
  overrideId: "planner-prompt-override",
  overridePlaceholder:
    "Empty = use the selected/default template text above; auto-filled on selection and editable here (Go template; variables {{.Goal}} {{.Scope}} {{.AssetSummary}} {{.DataDir}} {{.Now}} available)",
  overrideDescription:
    "Replaces the planner prompt body (section [A]) for this task only; the code-owned tail rules (traffic tools / intermediate-output rules) cannot be overridden.",
  Manager: PlannerTemplateManager,
};

const workerControlsAdapter: PromptTemplateControlsAdapter = {
  list: () => api.workerTemplates(),
  loadErrorPrefix: "Failed to load Worker templates",
  pickerLabel: "Worker template (worker)",
  pickerId: "worker-template-picker",
  emptyText: "No Worker templates",
  pickerDescription:
    "Choose an execution prompt template for the Worker; its body is auto-filled into \"Worker prompt override\" below and can be edited. Precedence: manual override > selected template > default template.",
  overrideLabel: "Worker prompt override (optional)",
  overrideId: "worker-prompt-override",
  overridePlaceholder:
    "Empty = use the selected/default template text above; auto-filled on selection and editable here (Go template; variables {{.WorkerName}} {{.ProxyAddr}} {{.DataDir}} {{.Now}} available)",
  overrideDescription:
    "Replaces the Worker prompt body for this task only; the code-owned tail rules (traffic tools / intermediate-output rules) cannot be overridden.",
  Manager: WorkerTemplateManager,
};

interface PlannerTemplateControlsProps {
  plannerTemplateID: number | null; // selected planner template; null = follow library default
  onPlannerTemplateIDChange: (id: number | null) => void;
  plannerPrompt: string; // planner prompt override; '' = no override (auto-filled on selection, editable)
  onPlannerPromptChange: (v: string) => void;
  workerCount: string; // input string; '' = 0 = follow global default
  onWorkerCountChange: (v: string) => void;
  portalContainer?: React.RefObject<HTMLDivElement | null>; // Combobox popover mount point (scroll container inside a Sheet)
}

export function PlannerTemplateControls({
  plannerTemplateID,
  onPlannerTemplateIDChange,
  plannerPrompt,
  onPlannerPromptChange,
  workerCount,
  onWorkerCountChange,
  portalContainer,
}: PlannerTemplateControlsProps) {
  return (
    <PromptTemplateControls
      templateID={plannerTemplateID}
      onTemplateIDChange={onPlannerTemplateIDChange}
      prompt={plannerPrompt}
      onPromptChange={onPlannerPromptChange}
      adapter={plannerControlsAdapter}
      portalContainer={portalContainer}
    >
      {/* Control 3: Worker count (0–16, 0 = follow global) */}
      <Field>
        <FieldLabel htmlFor="worker-count">Worker count</FieldLabel>
        <Input
          id="worker-count"
          type="number"
          min={0}
          max={16}
          className="w-40"
          placeholder="0 = follow global"
          value={workerCount}
          onChange={(e) => onWorkerCountChange(e.target.value)}
        />
        <FieldDescription>
          Number of workers running in parallel for this task (1–16); 0/empty = global default. Multiple workers suit broad scanning tasks; a single worker
          suits careful exploitation.
        </FieldDescription>
      </Field>
    </PromptTemplateControls>
  );
}

interface WorkerTemplateControlsProps {
  workerTemplateID: number | null; // selected Worker template; null = follow library default
  onWorkerTemplateIDChange: (id: number | null) => void;
  workerPrompt: string; // Worker prompt override; '' = no override (auto-filled on selection, editable)
  onWorkerPromptChange: (v: string) => void;
  portalContainer?: React.RefObject<HTMLDivElement | null>; // Combobox popover mount point (scroll container inside a Sheet)
}

export function WorkerTemplateControls({
  workerTemplateID,
  onWorkerTemplateIDChange,
  workerPrompt,
  onWorkerPromptChange,
  portalContainer,
}: WorkerTemplateControlsProps) {
  return (
    <PromptTemplateControls
      templateID={workerTemplateID}
      onTemplateIDChange={onWorkerTemplateIDChange}
      prompt={workerPrompt}
      onPromptChange={onWorkerPromptChange}
      adapter={workerControlsAdapter}
      portalContainer={portalContainer}
    />
  );
}
