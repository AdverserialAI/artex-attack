/**
 * prompt-template-manager.tsx: prompt template library management panel (list/create/edit/delete/set-default/test-render); deduplicated via an adapter serving planner and worker domains.
 * Main functions/types:
 *   - PromptTemplateManager: generic template management panel (adapter injects CRUD endpoints, variable catalog, and copy)
 *   - PlannerTemplateManager / WorkerTemplateManager: planner / worker domain entries, each bound to its adapter
 *   - PromptTemplateManagerAdapter: domain-difference injection interface
 */
"use client";

import * as React from "react";

import { LibraryIcon, PlayIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { PlannerTemplate } from "@/lib/types";
import { cn } from "@/lib/utils";

// PromptTemplate is the template library entry type; planner and worker templates share the shape (in lib/types.ts
// WorkerTemplate is an alias of PlannerTemplate).
type PromptTemplate = PlannerTemplate;

// PromptTemplateManagerAdapter injects all differences between the planner/worker template domains: CRUD endpoint wrappers,
// variable catalog, and copy (title/description/field hints/snapshot field name). The two management panels were previously identical line for line.
interface PromptTemplateManagerAdapter {
  // Valid variable catalog (same as the backend S11 test-render catalog).
  vars: readonly string[];
  title: string;
  description: string;
  // Form element id/htmlFor prefix (planner-template / worker-template).
  idPrefix: string;
  bodyLabel: string;
  // Additional note shown when built-in template names are read-only.
  builtinNameHint: string;
  builtinDeleteHint: string;
  // Name of the field the template body is snapshotted into on task creation (referenced by the delete confirmation copy).
  snapshotField: string;
  api: {
    list: () => Promise<PromptTemplate[]>;
    create: (input: { name: string; body: string }) => Promise<PromptTemplate>;
    update: (id: number, input: { name?: string; body?: string }) => Promise<PromptTemplate>;
    remove: (id: number) => Promise<unknown>;
    setDefault: (id: number) => Promise<PromptTemplate>;
    validate: (body: string) => Promise<{ ok: boolean }>;
  };
}

interface PromptTemplateDraft {
  name: string;
  body: string;
  isDefault: boolean;
}

interface PromptTemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adapter: PromptTemplateManagerAdapter;
}

const emptyDraft = (): PromptTemplateDraft => ({ name: "", body: "", isDefault: false });

function templateDraft(template: PromptTemplate): PromptTemplateDraft {
  return { name: template.name, body: template.body, isDefault: template.is_default };
}

// List ordering: built-in default first, then default templates, then backend updated_at DESC (guaranteed by sort stability).
function sortTemplates(list: PromptTemplate[]): PromptTemplate[] {
  return [...list].sort((a, b) => Number(b.builtin) - Number(a.builtin) || Number(b.is_default) - Number(a.is_default));
}

export function PromptTemplateManager({ open, onOpenChange, adapter }: PromptTemplateManagerProps) {
  const [templates, setTemplates] = React.useState<PromptTemplate[]>([]);
  const [selectedID, setSelectedID] = React.useState<number | null>(null); // null = new draft
  const [draft, setDraft] = React.useState<PromptTemplateDraft>(emptyDraft);
  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [validateErr, setValidateErr] = React.useState(""); // test-render 400 error details (with template line numbers) shown in red
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const wasOpen = React.useRef(false);

  // Refresh the list after save/delete (current selection and draft are untouched).
  const reload = React.useCallback(async () => {
    try {
      setTemplates(sortTemplates(await adapter.api.list()));
    } catch (error) {
      toast.error(`Failed to refresh the template list: ${(error as Error).message}`);
    }
  }, [adapter]);

  // On open: fetch the list and select the "default template" (or the first entry, usually the built-in default, when none is set).
  React.useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setValidateErr("");
    adapter.api
      .list()
      .then((list) => {
        const sorted = sortTemplates(list);
        setTemplates(sorted);
        const preferred = sorted.find((t) => t.is_default) ?? sorted[0];
        if (preferred) {
          setSelectedID(preferred.id);
          setDraft(templateDraft(preferred));
        } else {
          setSelectedID(null);
          setDraft(emptyDraft());
        }
      })
      .catch((error) => {
        setTemplates([]);
        toast.error(`Failed to load templates: ${(error as Error).message}`);
      });
  }, [open, adapter]);

  const selected = React.useMemo(() => templates.find((t) => t.id === selectedID) ?? null, [selectedID, templates]);
  // Built-in bodies are editable; names/nkeys keep their seed and scenario-reference identity, and delete protection is unchanged.
  const nameReadOnly = !!selected?.builtin;
  // Built-ins cannot be deleted (D11-c), defaults cannot be deleted (backend default-protected sentinel) — blocked in the frontend first, with the backend 409 as backstop.
  const deleteDisabled = !selected || selected.builtin || selected.is_default;

  const selectTemplate = (template: PromptTemplate) => {
    setSelectedID(template.id);
    setDraft(templateDraft(template));
    setValidateErr("");
  };

  const startNew = () => {
    const builtin = templates.find((t) => t.builtin);
    setSelectedID(null);
    setDraft({ name: "", body: builtin?.body ?? "", isDefault: false }); // use the built-in default body as the draft base
    setValidateErr("");
  };

  // Variable chip: inserts at the body cursor; built-in bodies are editable too.
  const insertVar = (v: string) => {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart ?? draft.body.length;
    const e = ta.selectionEnd ?? draft.body.length;
    setDraft((cur) => ({ ...cur, body: cur.body.slice(0, s) + v + cur.body.slice(e) }));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + v.length;
    });
  };

  // Test-render validation: calls the S11-v dry-run endpoint (no persistence); success toast, failure details (with template line numbers) in red.
  async function validate() {
    setValidating(true);
    setValidateErr("");
    try {
      await adapter.api.validate(draft.body);
      toast.success("Test render passed: syntax is valid and all variables are in the catalog");
    } catch (error) {
      setValidateErr((error as Error).message);
    } finally {
      setValidating(false);
    }
  }

  async function save() {
    const input = { name: draft.name.trim(), body: draft.body.trim() };
    if (!input.name || !input.body) {
      toast.error("Please fill in the template name and prompt body");
      return;
    }
    setSaving(true);
    try {
      let savedID = selectedID;
      if (selectedID == null) {
        const created = await adapter.api.create(input);
        savedID = created.id;
        if (draft.isDefault) await adapter.api.setDefault(created.id);
        toast.success(`Template \"${created.name}\" created`);
      } else {
        const updated = await adapter.api.update(selectedID, input);
        if (draft.isDefault && !updated.is_default) await adapter.api.setDefault(updated.id);
        toast.success(`Template \"${updated.name}\" saved`);
      }
      await reload();
      setSelectedID(savedID);
      setValidateErr("");
    } catch (error) {
      // S11 also test-renders on save: 400 error text carries the template line number (template: p:<line>:<col> …)
      toast.error(`Save failed: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (selectedID == null) return;
    const deletedID = selectedID;
    setDeleting(true);
    try {
      await adapter.api.remove(deletedID);
      const rest = templates.filter((t) => t.id !== deletedID);
      setTemplates(rest);
      const next = rest.find((t) => t.is_default) ?? rest[0];
      if (next) {
        setSelectedID(next.id);
        setDraft(templateDraft(next));
      } else {
        setSelectedID(null);
        setDraft({ name: "", body: "", isDefault: false });
      }
      setDeleteOpen(false);
      toast.success("Template deleted");
    } catch (error) {
      toast.error(`Delete failed: ${(error as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  let saveLabel = saving ? "Saving" : "Save changes";
  if (!saving && selectedID == null) saveLabel = "Create template";

  let deleteHint = "";
  if (selected?.builtin) deleteHint = adapter.builtinDeleteHint;
  else if (selected?.is_default) deleteHint = "The default template cannot be deleted — set another template as default first";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="grid h-full w-full! max-w-none! grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[48rem]! sm:max-w-[48rem]!">
          <SheetHeader className="border-b px-6 py-5">
            <SheetTitle>{adapter.title}</SheetTitle>
            <SheetDescription>{adapter.description}</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 overflow-y-auto lg:grid-cols-[15rem_minmax(0,1fr)] lg:overflow-hidden">
            <div className="flex min-h-0 flex-col border-b p-3 lg:border-r lg:border-b-0">
              <Button type="button" variant="outline" className="w-full" onClick={startNew}>
                <PlusIcon data-icon="inline-start" />
                New template
              </Button>
              <ScrollArea className="mt-2 max-h-44 lg:max-h-none lg:flex-1">
                <div className="flex flex-col gap-1 pr-2">
                  {templates.length === 0 && (
                    <p className="text-muted-foreground px-2 py-6 text-center text-sm">No templates</p>
                  )}
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={cn(
                        "min-w-0 rounded-md px-2.5 py-2 text-left transition-colors",
                        selectedID === template.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                      )}
                      onClick={() => selectTemplate(template)}
                    >
                      <span className="flex items-center gap-1.5">
                        <LibraryIcon className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        {template.builtin && (
                          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                            Built-in
                          </Badge>
                        )}
                        {template.is_default && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 bg-green-100 px-1.5 py-0 text-[10px] text-green-800"
                          >
                            Default
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        {template.body.split("\n", 1)[0]}
                      </span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <ScrollArea className="min-h-0">
              <FieldGroup className="p-6">
                <Field>
                  <FieldLabel htmlFor={`${adapter.idPrefix}-name`}>Template name</FieldLabel>
                  <Input
                    id={`${adapter.idPrefix}-name`}
                    value={draft.name}
                    maxLength={120}
                    placeholder="e.g. Internal lateral movement · cautious"
                    disabled={nameReadOnly}
                    onChange={(event) => setDraft((cur) => ({ ...cur, name: event.target.value }))}
                  />
                  <FieldDescription>
                    Names must be unique after normalization (prevents visually equivalent duplicates).
                    {nameReadOnly && adapter.builtinNameHint}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${adapter.idPrefix}-body`}>{adapter.bodyLabel}</FieldLabel>
                  <Textarea
                    id={`${adapter.idPrefix}-body`}
                    ref={bodyRef}
                    className="bg-muted/40 min-h-72 resize-y font-mono text-xs leading-relaxed"
                    value={draft.body}
                    onChange={(event) => setDraft((cur) => ({ ...cur, body: event.target.value }))}
                  />
                  {validateErr && <p className="text-destructive text-xs whitespace-pre-wrap">{validateErr}</p>}
                  <FieldDescription>
                    The code-owned tail rules (traffic tools / intermediate-output rules) are appended after rendering — not listed here and not overridable.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Variable catalog (click to insert at the body cursor)</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {adapter.vars.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVar(v)}
                        className="bg-accent hover:border-foreground cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[11px]"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <FieldDescription>
                    Only these five variables are available; referencing anything outside the catalog is rejected on save/test-render (400 with template line numbers).
                  </FieldDescription>
                </Field>
                <Field>
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`${adapter.idPrefix}-default`}
                      checked={draft.isDefault}
                      disabled={selected?.is_default} // the default cannot be unset here — setting another template as default takes over automatically
                      onCheckedChange={(v) => setDraft((cur) => ({ ...cur, isDefault: !!v }))}
                    />
                    <FieldLabel htmlFor={`${adapter.idPrefix}-default`} className="font-normal">
                      Set as default template
                    </FieldLabel>
                  </div>
                  <FieldDescription>Only one default per library; tasks created without a template choice start from the default template's body snapshot.</FieldDescription>
                </Field>
                <Field>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={validating}
                    onClick={() => void validate()}
                  >
                    {validating ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
                    {validating ? "Validating" : "Test-render validation"}
                  </Button>
                  <FieldDescription>
                    Dry-run against the render endpoint without saving: success shows a toast; failure shows template line numbers in red below the body.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </ScrollArea>
          </div>
          <SheetFooter className="border-t px-6 py-4 sm:flex-row sm:items-center">
            {selectedID != null && (
              <Button
                type="button"
                variant="destructive"
                className="sm:mr-auto"
                disabled={deleteDisabled}
                title={deleteHint || undefined}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete template
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
              {saveLabel}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template "{draft.name || "Untitled template"}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Tasks using it are unaffected — the template body was snapshotted into the task at creation ({adapter.snapshotField}). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {deleting && <Spinner data-icon="inline-start" />}
              {deleting ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── planner / worker adapters and fixed exports ──────────────────────────────────────────
// The two domains were previously two ~400-line twin components differing only in the following (CRUD endpoints, variable catalog, copy).

// Valid variable catalog = the five PlannerVars fields (agent/prompt.go#PlannerVars); same catalog as the backend S11 test-render.
const PLANNER_VARS = ["{{.Goal}}", "{{.Scope}}", "{{.AssetSummary}}", "{{.DataDir}}", "{{.Now}}"] as const;
// Valid variable catalog = the four WorkerVars fields (agent/prompt.go#WorkerVars); same catalog as the backend S11 test-render.
const WORKER_VARS = ["{{.WorkerName}}", "{{.ProxyAddr}}", "{{.DataDir}}", "{{.Now}}"] as const;

const plannerTemplateAdapter: PromptTemplateManagerAdapter = {
  vars: PLANNER_VARS,
  title: "Planner template management",
  description: "Templates store the planner prompt body; edits do not affect tasks already created (snapshot semantics).",
  idPrefix: "planner-template",
  bodyLabel: "Prompt body (Go template; replaces planner prompt section [A] in full)",
  builtinNameHint: "Built-in template names identify scenarios and cannot be changed; bodies can be edited and saved directly.",
  builtinDeleteHint: "Built-in templates cannot be deleted; bodies are editable",
  snapshotField: "planner_prompt_override",
  api: {
    list: () => api.plannerTemplates(),
    create: (input) => api.createPlannerTemplate(input),
    update: (id, input) => api.updatePlannerTemplate(id, input),
    remove: (id) => api.deletePlannerTemplate(id),
    setDefault: (id) => api.setDefaultPlannerTemplate(id),
    validate: (body) => api.validatePlannerTemplate(body),
  },
};

const workerTemplateAdapter: PromptTemplateManagerAdapter = {
  vars: WORKER_VARS,
  title: "Worker template management",
  description: "Templates store the Worker prompt body; edits do not affect tasks already created (snapshot semantics).",
  idPrefix: "worker-template",
  bodyLabel: "Prompt body (Go template; replaces Worker prompt section [A] in full)",
  builtinNameHint: "Built-in template bodies are editable directly; names and nkeys are kept for scenario identification.",
  builtinDeleteHint: "Built-in templates cannot be deleted; bodies are editable, names/nkeys are kept",
  snapshotField: "worker_prompt_override",
  api: {
    list: () => api.workerTemplates(),
    create: (input) => api.createWorkerTemplate(input),
    update: (id, input) => api.updateWorkerTemplate(id, input),
    remove: (id) => api.deleteWorkerTemplate(id),
    setDefault: (id) => api.setDefaultWorkerTemplate(id),
    validate: (body) => api.validateWorkerTemplate(body),
  },
};

export function PlannerTemplateManager(props: Omit<PromptTemplateManagerProps, "adapter">) {
  return <PromptTemplateManager {...props} adapter={plannerTemplateAdapter} />;
}

export function WorkerTemplateManager(props: Omit<PromptTemplateManagerProps, "adapter">) {
  return <PromptTemplateManager {...props} adapter={workerTemplateAdapter} />;
}
