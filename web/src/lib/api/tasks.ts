// tasks domain: health/auth, task CRUD/review/categories/three template kinds, stats and topology, goals and constraints,
// task-level asset intercept rules, scope, workspace files, assets and companies, exploration (findings/traffic evidence/
// activity/conversations), and audit/traffic observation endpoints.
/**
 * Main functions/types:
 *   - tasksApi / TasksApi: tasks-domain API aggregate object and its type
 *   - auth/health: login and health check
 *   - tasks/stats method group: task CRUD, review, categories, three template kinds, stats, and topology
 *   - goals/constraints/task-level asset intercept rule method groups: overview management endpoints
 *   - scope/workspace/assets/companies/exploration/traffic/audit method groups: asset scope, workspace files, assets/companies, exploration sessions, and observation endpoints
 */

import { arr, del, findingFilterParams, get, getToken, http, patch, post, put, tq } from "@/lib/api/http";
import { MOCK } from "@/lib/mock/enabled";
import type {
  ActiveFindingRetest,
  Activity,
  ArchiveBatchItem,
  Asset,
  AssetHostRow,
  AssetInterceptRule,
  AssetInterceptRuleInput,
  Audit,
  BatchCategoryItem,
  BatchControlItem,
  Company,
  CompanyScopeMutation,
  CompanyScopeRule,
  ConvTokenSummary,
  CoverageAssetRefs,
  CoverageGraphData,
  DeleteTaskOptions,
  DeleteTaskResult,
  Edge,
  EvidenceBodyPreview,
  ExplorationNodePage,
  ExplorationNodeQuery,
  Finding,
  FindingAssetTree,
  FindingDeepenResponse,
  FindingGroupsPage,
  FindingQuery,
  FindingRetest,
  FindingStats,
  FindingStatus,
  FindingsPage,
  FindingTraffic,
  FindingTrafficDetail,
  IntentAsset,
  PlannerTemplate,
  ReviewMessage,
  ReviewProposedIntent,
  SessionTokenUsage,
  Severity,
  Stats,
  Task,
  TaskArchive,
  TaskArchivePage,
  TaskAssetScopeMutation,
  TaskCategory,
  TaskConstraint,
  TaskGoal,
  TaskLLMResolutions,
  TaskNode,
  TaskScopeRow,
  TaskTemplate,
  TokenTotal,
  TokenUsage,
  TopologyEdgeInput,
  TopologyEdgePatch,
  TopologyGraph,
  TopologyGroupInput,
  TopologyNodeInput,
  TopologyNodePatch,
  TrafficDetail,
  TrafficEvidenceRef,
  TrafficEvidenceRole,
  TrafficHost,
  TrafficResp,
  UsageStats,
  WorkerTemplate,
  WorkspaceFile,
  WorkspaceListing,
} from "@/lib/types";

export const tasksApi = {
  // Backend application version (injected via ldflags at release; defaults to the current version).
  health: () => get<{ ok: boolean; service: string; version: string }>("/health"),

  // ---- auth ----
  authStatus: () => get<{ initialized: boolean }>("/auth/status"),
  login: (username: string, password: string) => post<{ token: string }>("/auth/login", { username, password }),
  initPassword: (password: string) => post<{ token: string }>("/auth/init", { password }),
  // A password change revokes every previously issued token; the response carries
  // a fresh token so the calling device stays signed in.
  changePassword: (oldPassword: string, newPassword: string) =>
    post<{ ok: boolean; token?: string; expires_in?: number }>("/auth/change-password", {
      old_password: oldPassword,
      new_password: newPassword,
    }),
  // Rotates the 1-hour access token (absolute session cap enforced server-side).
  refresh: () => post<{ token: string; expires_in: number }>("/auth/refresh"),

  // ---- tasks ----
  tasks: () =>
    get<{ tasks: Task[]; active: string }>("/tasks").then((r) => ({ tasks: arr(r.tasks), active: r.active ?? "" })),
  task: (id: string) => get<Task>(`/tasks/${encodeURIComponent(id)}`),
  createTask: (input: {
    name?: string;
    categoryId?: number;
    description: string;
    goal: string;
    llmProfileIds?: number[];
    sourceTaskIds?: string[];
    companyIds?: number[];
    timeoutSeconds?: number;
    seedFirstIntent?: boolean;
    planHeartbeatSeconds?: number;
    coverageEnabled?: boolean;
    interceptRules?: AssetInterceptRuleInput[];
    // [fork P-INTENT U1] begin — createTask passthrough of the four new fields (vol 00 S7)
    preAgent?: string; // preselected executor_key for the seed intent (works with seedFirstIntent)
    plannerPrompt?: string; // full planner prompt snapshot (≤32KB; takes precedence over plannerTemplateId, K22)
    plannerTemplateId?: number; // template id only: the backend snapshots its body (vol 03 S13)
    workerPrompt?: string; // full Worker prompt snapshot; takes precedence over workerTemplateId
    workerTemplateId?: number; // Worker template id: body snapshot saved at creation
    workerCount?: number; // task-level worker pool: 0 = follow global, 1–16 dedicated
    reviewEnabled?: boolean; // [fork P-REVIEW D2c] task-level intent review master switch (m03934; default off)
    assetMode?: string; // [fork P-REVIEW D12] asset graph mode (m04039; empty = inherited from category)
    // [fork P-INTENT U1] end
  }) =>
    post<Task>("/tasks", {
      name: input.name ?? "",
      category_id: input.categoryId ?? null,
      description: input.description,
      goal: input.goal,
      llm_profile_ids: input.llmProfileIds ?? [],
      source_task_ids: input.sourceTaskIds ?? [],
      company_ids: input.companyIds ?? [],
      timeout_seconds: input.timeoutSeconds ?? 0,
      seed_first_intent: input.seedFirstIntent ?? false,
      plan_heartbeat_seconds: input.planHeartbeatSeconds ?? 0, // 0 = backend normalizes to the 600s (10min) default
      coverage_enabled: input.coverageEnabled ?? true, // default on; false disables the asset-coverage feature
      intercept_rules: input.interceptRules ?? [], // task-level asset intercept rules
      // [fork P-INTENT U1] passthrough of the four new fields (vol 00 S7)
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      pre_agent: input.preAgent || undefined,
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      planner_prompt: input.plannerPrompt || undefined,
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      planner_template_id: input.plannerTemplateId || undefined,
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      worker_prompt: input.workerPrompt || undefined,
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      worker_template_id: input.workerTemplateId || undefined,
      worker_count: input.workerCount ?? 0,
      review_enabled: input.reviewEnabled ?? false, // [fork P-REVIEW D2c]
      // biome-ignore lint/nursery/useNullishCoalescing: empty strings must normalize to undefined (field omitted); ?? would keep them.
      asset_mode: input.assetMode || undefined, // [fork P-REVIEW D12]
    }),
  // [fork P-INTENT U1] begin — the five review endpoints (vol 00 U1; vol 01 S6)
  reviewProposed: (taskId: string) =>
    get<{ intents: ReviewProposedIntent[] }>(`/tasks/${taskId}/review/proposed`).then((r) => arr(r.intents)),
  reviewApprove: (taskId: string, intentId: number, expectedVersion?: number) =>
    // Review flow PR3/§8: the executor is no longer chosen from the approval panel (preselected at submit/revise time, promoted by the backend on approval);
    // expected_version uses the content_version returned by the list for CAS; undefined = no check (legacy behavior).
    post<{ ok: boolean }>(`/tasks/${taskId}/review/${intentId}/approve`, {
      expected_version: expectedVersion ?? null,
    }),
  reviewReject: (taskId: string, intentId: number, reason: string, expectedVersion?: number) =>
    post<{ ok: boolean }>(`/tasks/${taskId}/review/${intentId}/reject`, {
      reason,
      expected_version: expectedVersion ?? null,
    }),
  reviewChat: (taskId: string, message: string) =>
    post<{ accepted: boolean }>(`/tasks/${taskId}/review/chat`, { message }),
  reviewMessages: (taskId: string) =>
    get<{ messages: ReviewMessage[] }>(`/tasks/${taskId}/review/messages`).then((r) => arr(r.messages)),
  // [fork P-INTENT U1] end
  taskCategories: () => get<{ categories: TaskCategory[] }>("/task-categories").then((r) => arr(r.categories)),
  updateTask: (
    id: string,
    input: { name?: string; pinned?: boolean; review_auto?: boolean; review_enabled?: boolean },
  ) => patch<Task>(`/tasks/${id}`, input),
  renameTask: (id: string, name: string) => patch<Task>(`/tasks/${id}`, { name }),
  pinTask: (id: string, pinned: boolean) => patch<Task>(`/tasks/${id}`, { pinned }),
  createTaskCategory: (name: string) => post<TaskCategory>("/task-categories", { name }),
  renameTaskCategory: (
    id: number,
    input:
      | string
      | {
          name?: string;
          default_review_enabled?: boolean;
          default_planner_template_id?: number;
          default_worker_template_id?: number;
          asset_mode?: string;
          default_description?: string;
          seed_first_intent?: boolean;
          seed_executor?: string;
        },
  ) =>
    // [fork P-REVIEW D12] accepts both a string (rename only) and an object (rename + preset bundle, m04039)
    patch<TaskCategory>(`/task-categories/${id}`, typeof input === "string" ? { name: input } : input),
  deleteTaskCategory: (id: number) => del<{ deleted: number }>(`/task-categories/${id}`),
  updateTaskCategory: (taskId: string, categoryId?: number) =>
    patch<Task>(`/tasks/${taskId}/category`, { category_id: categoryId ?? null }),
  // categoryId omitted/undefined = remove from the category (the backend receives null)
  updateTasksCategory: (taskIds: string[], categoryId?: number) =>
    post<{ items: BatchCategoryItem[]; category: TaskCategory | null }>("/tasks/category/batch", {
      task_ids: taskIds,
      category_id: categoryId ?? null,
    }),
  taskTemplates: () => get<{ templates: TaskTemplate[] }>("/task-templates").then((r) => arr(r.templates)),
  createTaskTemplate: (
    input: Pick<TaskTemplate, "name" | "description" | "goal" | "category_id" | "intercept_rules">,
  ) => post<TaskTemplate>("/task-templates", input),
  updateTaskTemplate: (
    id: number,
    input: Partial<Pick<TaskTemplate, "name" | "description" | "goal" | "category_id" | "intercept_rules">>,
  ) => patch<TaskTemplate>(`/task-templates/${id}`, input),
  deleteTaskTemplate: (id: number) => del<{ deleted: number }>(`/task-templates/${id}`),
  // [fork P-TPL U1] begin — six planner template library wrappers (vol 03 S11 five endpoints + S11-v test-render dry run)
  plannerTemplates: () => get<{ templates: PlannerTemplate[] }>("/planner-templates").then((r) => arr(r.templates)),
  createPlannerTemplate: (input: { name: string; body: string }) => post<PlannerTemplate>("/planner-templates", input),
  updatePlannerTemplate: (id: number, input: { name?: string; body?: string }) =>
    patch<PlannerTemplate>(`/planner-templates/${id}`, input),
  deletePlannerTemplate: (id: number) => del<{ deleted: number }>(`/planner-templates/${id}`),
  setDefaultPlannerTemplate: (id: number) => post<PlannerTemplate>(`/planner-templates/${id}/default`, {}),
  validatePlannerTemplate: (body: string) => post<{ ok: boolean }>("/planner-templates/validate", { body }),
  workerTemplates: () => get<{ templates: WorkerTemplate[] }>("/worker-templates").then((r) => arr(r.templates)),
  createWorkerTemplate: (input: { name: string; body: string }) => post<WorkerTemplate>("/worker-templates", input),
  updateWorkerTemplate: (id: number, input: { name?: string; body?: string }) =>
    patch<WorkerTemplate>(`/worker-templates/${id}`, input),
  deleteWorkerTemplate: (id: number) => del<{ deleted: number }>(`/worker-templates/${id}`),
  setDefaultWorkerTemplate: (id: number) => post<WorkerTemplate>(`/worker-templates/${id}/default`, {}),
  validateWorkerTemplate: (body: string) => post<{ ok: boolean }>("/worker-templates/validate", { body }),
  // [fork P-TPL U1] end
  updateTaskLLMProfiles: (id: string, llmProfileIds: number[], activeLLMProfileId?: number) =>
    put<{
      id: string;
      llm_profile_ids: number[];
      active_llm_profile_id?: number;
      llm_failover_state: string;
      reopened_intents: number;
      switch_event?: Activity;
    }>(`/tasks/${id}/llm`, {
      llm_profile_ids: llmProfileIds,
      active_llm_profile_id: activeLLMProfileId ?? null,
    }),
  deleteTask: (id: string, options: DeleteTaskOptions) => del<DeleteTaskResult>(`/tasks/${id}`, options),
  controlTask: (id: string, action: "pause" | "resume") =>
    post<{ id: string; paused: boolean; queued: boolean; status: string }>(`/tasks/${id}/control`, { action }),
  controlTasksBatch: (taskIds: string[], action: "pause" | "resume") =>
    post<{ items: BatchControlItem[] }>("/tasks/control/batch", { task_ids: taskIds, action }),
  taskArchives: (input?: { page?: number; size?: number; q?: string; state?: string }) => {
    const query = new URLSearchParams();
    query.set("page", String(input?.page ?? 1));
    query.set("size", String(input?.size ?? 20));
    if (input?.q) query.set("q", input.q);
    if (input?.state) query.set("state", input.state);
    return get<TaskArchivePage>(`/task-archives?${query.toString()}`).then((response) => ({
      ...response,
      items: arr(response.items),
    }));
  },
  taskArchive: (id: number) => get<TaskArchive>(`/task-archives/${id}`),
  archiveTask: (id: string) => post<TaskArchive>(`/tasks/${id}/archive`),
  archiveTasks: (taskIds: string[]) =>
    post<{ items: ArchiveBatchItem[] }>("/tasks/archive/batch", { task_ids: taskIds }),
  restoreTaskArchive: (id: number) => post<TaskArchive>(`/task-archives/${id}/restore`),
  restoreTaskArchives: (archiveIds: number[]) =>
    post<{ items: ArchiveBatchItem[] }>("/task-archives/restore/batch", { archive_ids: archiveIds }),
  deleteTaskArchive: (id: number) => del<TaskArchive>(`/task-archives/${id}`),
  deleteTaskArchives: (archiveIds: number[]) =>
    post<{ items: ArchiveBatchItem[] }>("/task-archives/delete/batch", { archive_ids: archiveIds }),
  controlIntent: (
    taskId: string,
    intentId: string,
    action: "pause" | "resume" | "cancel",
    reason?: string,
    // cancel only: soft (default — soft delete, intent marked deleted with a reason) | hard (real delete, cascading removal of exclusively owned descendants).
    mode?: "soft" | "hard",
  ) =>
    post<{
      id: number;
      state: "paused" | "open" | "proposed" | "deleted" | "";
      deleted?: { intents: number; facts: number; findings: number; activities: number };
    }>(`/tasks/${taskId}/intents/${intentId}/control`, { action, reason: reason ?? "", mode: mode ?? "soft" }),
  sendWorkerMessage: (taskId: string, intentId: string, message: string, requestId: string) =>
    post<{
      id: number;
      state: "running";
      accepted: true;
      request_id: string;
    }>(`/tasks/${taskId}/intents/${intentId}/messages`, { message, request_id: requestId }),
  taskLLMResolution: (id: string) => get<TaskLLMResolutions>(`/tasks/${id}/llm/resolution`),
  // Rerun a failed intent (blocked/exhausted/stopped): the server resets it to open/proposed per executor for reclaiming.
  rerunIntent: (taskId: string, intentId: string) =>
    post<{ id: string; reopened: number }>(`/tasks/${taskId}/intents/${intentId}/rerun`),
  // Batch-rerun all recoverable intents of this task (blocked/exhausted/stopped).
  rerunRecoverable: (taskId: string) => post<{ id: string; reopened: number }>(`/tasks/${taskId}/intents/rerun-recoverable`),
  setActive: (id: string) => post<{ active: string }>("/active", { id }),
  // ---- stats ----
  stats: (task?: string) => get<Stats>(`/stats${tq(task)}`),
  // Asset test coverage (rough estimate, for reference): share of in-scope assets touched by facts + total/tested counts by type.
  taskCoverage: (id: string) =>
    get<{
      enabled: boolean; // whether asset coverage is enabled; other fields are zero when false
      scope_rows: number;
      denominator: number;
      tested: number;
      pct: number | null;
      by_type: { type: string; total: number; tested: number }[];
    }>(`/tasks/${id}/coverage`),
  // Asset coverage graph: all in-scope assets + root-domain/company connector nodes, with tested/in_scope.
  taskCoverageGraph: (id: string) => get<CoverageGraphData>(`/tasks/${id}/coverage-graph`),
  taskTopology: (id: string) => get<TopologyGraph>(`/tasks/${id}/topology`),
  // Add node: {node, first_edge}. When first_edge is null/omitted, the backend auto-links a dashed "discovery method unconfirmed" edge to the entry.
  addTopologyNode: (id: string, node: TopologyNodeInput, firstEdge: TopologyEdgeInput | null) =>
    post<TopologyGraph>(`/tasks/${id}/topology/nodes`, { node, first_edge: firstEdge }),
  patchTopologyNode: (id: string, ip: string, body: TopologyNodePatch) =>
    patch<TopologyGraph>(`/tasks/${id}/topology/nodes/${encodeURIComponent(ip)}`, body),
  deleteTopologyNode: (id: string, ip: string) =>
    del<TopologyGraph>(`/tasks/${id}/topology/nodes/${encodeURIComponent(ip)}`),
  addTopologyEdge: (id: string, edge: TopologyEdgeInput) => post<TopologyGraph>(`/tasks/${id}/topology/edges`, edge),
  patchTopologyEdge: (id: string, edgeId: number, body: TopologyEdgePatch) =>
    patch<TopologyGraph>(`/tasks/${id}/topology/edges/${edgeId}`, body),
  deleteTopologyEdge: (id: string, edgeId: number) => del<TopologyGraph>(`/tasks/${id}/topology/edges/${edgeId}`),
  addTopologyGroup: (id: string, group: TopologyGroupInput) =>
    post<TopologyGraph>(`/tasks/${id}/topology/groups`, group),
  patchTopologyGroup: (id: string, groupId: number, group: TopologyGroupInput) =>
    patch<TopologyGraph>(`/tasks/${id}/topology/groups/${groupId}`, group),
  deleteTopologyGroup: (id: string, groupId: number) => del<TopologyGraph>(`/tasks/${id}/topology/groups/${groupId}`),
  addTopologyNote: (id: string, nodeIP: string, body: string) =>
    post<TopologyGraph>(`/tasks/${id}/topology/notes`, { node_ip: nodeIP, body }),
  // One-time seed: generate the initial topology from task assets (internal IPs); only adds, never overwrites.
  seedTopology: (id: string) => post<TopologyGraph>(`/tasks/${id}/topology/seed`),
  // Global llm_usage aggregation (dashboard's new token view): totals by profile + daily buckets.
  usageStats: (days = 365) => get<UsageStats>(`/tokens/usage?days=${days}`),
  // ---- Goal management (overview) ----
  // All goals of this task (text/vulnclass/state).
  taskGoals: (id: string) =>
    get<{ goals: TaskGoal[] | null }>(`/tasks/${id}/goals`).then((response) => ({ goals: arr(response.goals) })),
  // Manually add a goal: writes to the graph, notifies the planner, and revives the task.
  addGoal: (id: string, text: string, vulnclass?: string) =>
    post<TaskGoal>(`/tasks/${id}/goals`, { text, vulnclass: vulnclass ?? "" }),
  // Manually edit goal text (and vulnclass): notifies the planner "old became new" and revives the task.
  updateGoal: (id: string, goalId: string, text: string, vulnclass?: string) =>
    patch<TaskGoal>(`/tasks/${id}/goals/${goalId}`, { text, vulnclass: vulnclass ?? "" }),
  // Manually delete a goal (hard delete): notifies the planner; deletion does not revive the task.
  deleteGoal: (id: string, goalId: string) => del<{ ok: boolean }>(`/tasks/${id}/goals/${goalId}`),

  // ---- Operational constraint management (overview) ----
  // All operational constraints of this task (allow/deny).
  taskConstraints: (id: string) =>
    get<{ constraints: TaskConstraint[] | null }>(`/tasks/${id}/constraints`).then((response) => ({
      constraints: arr(response.constraints),
    })),
  // Add a constraint (the planner is not notified; it simply reads it on the next planning round).
  addConstraint: (id: string, text: string, kind: TaskConstraint["kind"]) =>
    post<TaskConstraint>(`/tasks/${id}/constraints`, { text, kind }),
  // Edit a constraint (text + allow/deny).
  updateConstraint: (id: string, constraintId: string, text: string, kind: TaskConstraint["kind"]) =>
    patch<TaskConstraint>(`/tasks/${id}/constraints/${constraintId}`, { text, kind }),
  // Delete a constraint.
  deleteConstraint: (id: string, constraintId: string) =>
    del<{ ok: boolean }>(`/tasks/${id}/constraints/${constraintId}`),

  // ---- Task-level asset block/allow rules (overview) ----
  taskInterceptRules: (id: string) =>
    get<{ rules: AssetInterceptRule[] | null }>(`/tasks/${id}/intercept-rules`).then((r) => arr(r.rules)),
  createTaskInterceptRule: (id: string, rule: AssetInterceptRuleInput) =>
    post<AssetInterceptRule>(`/tasks/${id}/intercept-rules`, rule),
  updateTaskInterceptRule: (id: string, ruleId: number, rule: AssetInterceptRuleInput) =>
    put<AssetInterceptRule>(`/tasks/${id}/intercept-rules/${ruleId}`, rule),
  deleteTaskInterceptRule: (id: string, ruleId: number) =>
    del<{ deleted: boolean }>(`/tasks/${id}/intercept-rules/${ruleId}`),
  toggleTaskInterceptRule: (id: string, ruleId: number, enabled: boolean) =>
    post<{ ok: boolean; enabled: boolean }>(`/tasks/${id}/intercept-rules/${ruleId}/toggle`, { enabled }),

  // This task's test-scope list (including scopes inherited from source tasks).
  taskScope: (id: string) => get<{ scope: TaskScopeRow[] }>(`/tasks/${id}/scope`),
  // Manually add a test-scope entry (kind=company/root_domain/subdomain/ip/cidr).
  addTaskScope: (id: string, kind: string, value: string, reason?: string) =>
    post<TaskScopeRow>(`/tasks/${id}/scope`, { kind, value, reason }),
  // Delete one of this task's test-scope entries.
  deleteTaskScope: (id: string, scopeId: number) => del<{ ok: boolean }>(`/tasks/${id}/scope/${scopeId}`),
  // Intents / facts / findings linked to an asset within this task (used by the coverage node drawer).
  taskAssetRefs: (id: string, assetId: number) => get<CoverageAssetRefs>(`/tasks/${id}/asset-refs?asset_id=${assetId}`),

  // ---- workspace file manager (workDir) ----
  workspaceList: (path = "") => get<WorkspaceListing>(`/workspace/list?path=${encodeURIComponent(path)}`),
  workspaceRead: (path: string) => get<WorkspaceFile>(`/workspace/read?path=${encodeURIComponent(path)}`),
  workspaceWrite: (path: string, content: string) =>
    post<{ ok: boolean; path: string }>(`/workspace/write`, { path, content }),
  workspaceMkdir: (path: string) => post<{ ok: boolean; path: string }>(`/workspace/mkdir`, { path }),
  workspaceDelete: (path: string) => del<{ ok: boolean }>(`/workspace/delete?path=${encodeURIComponent(path)}`),
  workspaceUpload: async (dir: string, files: File[]) => {
    if (MOCK) return { uploaded: files.length };
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    const token = getToken();
    const r = await fetch(`/api/workspace/upload?path=${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    });
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
    return r.json() as Promise<{ uploaded: number }>;
  },
  workspaceDownload: async (path: string) => {
    let blob: Blob;
    if (MOCK) {
      blob = new Blob([`(demo) Example download content for ${path}.`], { type: "text/plain" });
    } else {
      const token = getToken();
      const r = await fetch(`/api/workspace/download?path=${encodeURIComponent(path)}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!r.ok) throw new Error(`Download failed: ${r.status}`);
      blob = await r.blob();
    }
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = path.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  },

  // ---- assets ----
  // Server-side paginated: pass limit/offset, get back the page + full match total.
  assets: (type = "", limit = 50, offset = 0) =>
    get<{ count: number; total: number; assets: Asset[] }>(`/assets?type=${type}&limit=${limit}&offset=${offset}`).then(
      (r) => ({ assets: r?.assets ?? [], total: r?.total ?? r?.count ?? 0 }),
    ),
  hostAssets: (dsl = "", companyID = "", limit = 50, offset = 0) => {
    const p = new URLSearchParams({ type: "host", limit: String(limit), offset: String(offset) });
    if (dsl) p.set("dsl", dsl);
    if (companyID) p.set("company_id", companyID);
    return get<{ count: number; total: number; hosts: AssetHostRow[] }>(`/assets?${p.toString()}`).then((r) => ({
      hosts: r?.hosts ?? [],
      total: r?.total ?? r?.count ?? 0,
    }));
  },
  searchAssets: (dsl: string, type = "", limit = 50, offset = 0) =>
    get<{ count: number; total: number; assets: Asset[] }>(
      `/assets?dsl=${encodeURIComponent(dsl)}${type ? `&type=${encodeURIComponent(type)}` : ""}&limit=${limit}&offset=${offset}`,
    ).then((r) => ({ assets: r?.assets ?? [], total: r?.total ?? r?.count ?? 0 })),
  assetCounts: (taskId = "") =>
    get<Record<string, number>>(`/assets/counts${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ""}`),
  deleteAssets: (ids: number[]) =>
    http<{ deleted: number }>("/assets", { method: "DELETE", body: JSON.stringify({ ids }) }),
  // task-scoped view of the same endpoint — server-side paginated like `assets`
  taskAssets: (taskId: string, type = "", limit = 50, offset = 0) =>
    get<{ count: number; total: number; assets: Asset[] }>(
      `/assets?task_id=${encodeURIComponent(taskId)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`,
    ).then((r) => ({ assets: r?.assets ?? [], total: r?.total ?? r?.count ?? 0 })),
  // DSL search scoped to a task — the backend forces the task_id filter, so it
  // always stays within that task's assets (same DSL grammar as `searchAssets`).
  searchTaskAssets: (taskId: string, dsl: string, type = "", limit = 50, offset = 0) =>
    get<{ count: number; total: number; assets: Asset[] }>(
      `/assets?task_id=${encodeURIComponent(taskId)}&dsl=${encodeURIComponent(dsl)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`,
    ).then((r) => ({ assets: r?.assets ?? [], total: r?.total ?? r?.count ?? 0 })),
  registerTaskAssetScopes: (taskId: string, scope: CompanyScopeRule[]) =>
    post<TaskAssetScopeMutation>(`/tasks/${taskId}/assets`, { scope }),
  detachTaskAsset: (taskId: string, assetId: number) => del<{ detached: number }>(`/tasks/${taskId}/assets/${assetId}`),
  taskIntentAssets: (taskId: string) =>
    get<{ assets: IntentAsset[] }>(`/tasks/${taskId}/intent-assets`).then((r) => arr(r.assets)),

  // ---- companies (companies + asset scope; single source of ownership) ----
  companies: () => get<Company[]>("/companies").then(arr),
  createCompany: (name: string, scope: CompanyScopeRule[]) =>
    post<{ id: number; created: boolean; scope_added?: number; scope_invalid?: number; scope_errors?: string[] }>(
      "/companies",
      {
        name,
        scope,
      },
    ),
  addCompanyScope: (id: number, scope: CompanyScopeRule[], reason = "") =>
    post<CompanyScopeMutation>(`/companies/${id}/scope`, {
      scope,
      reason,
    }),
  updateCompanyScope: (id: number, scope: CompanyScopeRule[], reason = "") =>
    post<CompanyScopeMutation>(`/companies/${id}/scope`, {
      scope,
      reason,
      reset: true,
    }),
  deleteCompany: (id: number, deleteAssets = false) =>
    http<{ deleted: number; assets_deleted: number }>(`/companies/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ delete_assets: deleteAssets }),
    }),

  // ---- exploration (per task) ----
  frontier: (task?: string) => get<TaskNode[]>(`/exploration/frontier${tq(task)}`).then(arr),
  findings: (task?: string) => get<Finding[]>(`/exploration/findings${tq(task)}`).then(arr),
  findingsPage: (q: FindingQuery) => {
    const p = findingFilterParams(q);
    p.set("page", String(q.page));
    p.set("limit", String(q.pageSize));
    return get<FindingsPage>(`/exploration/findings?${p.toString()}`);
  },
  findingGroups: (q: FindingQuery) => {
    const p = findingFilterParams(q);
    p.set("page", String(q.page));
    p.set("limit", String(q.pageSize));
    return get<FindingGroupsPage>(`/exploration/findings/groups?${p.toString()}`);
  },
  // findingAssetTree returns the left-hand tree of the "by asset" view: only assets with findings and their ancestors,
  // nodes carry subtree-aggregated counts. Not paged — the tree is a navigation structure fetched in full.
  findingAssetTree: (q: Omit<FindingQuery, "page" | "pageSize">) =>
    get<FindingAssetTree>(`/exploration/findings/asset-tree?${findingFilterParams(q).toString()}`),
  findingStats: () => get<FindingStats>("/exploration/findings/stats"),
  // exportFindings triggers a findings-page export and downloads the file. scope=selected passes ids (finding_id list);
  // scope=filtered passes the current filters (FindingQuery fields); scope=all ignores filters.
  exportFindings: async (opts: {
    format: "md-single" | "md-zip" | "csv" | "json";
    scope: "filtered" | "all" | "selected";
    filters?: Omit<FindingQuery, "page" | "pageSize">;
    ids?: string[];
  }) => {
    const p = new URLSearchParams({ format: opts.format, scope: opts.scope });
    if (opts.scope === "selected") {
      p.set("ids", (opts.ids ?? []).join(","));
    } else if (opts.scope === "filtered" && opts.filters) {
      for (const [k, v] of findingFilterParams(opts.filters)) p.set(k, v);
    }
    const token = getToken();
    const r = await fetch(`/api/exploration/findings/export?${p.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(`export: ${r.status}`);
    const blob = await r.blob();
    // The filename prefers the backend Content-Disposition, falling back to the default name.
    const disp = r.headers.get("Content-Disposition") ?? "";
    const m = disp.match(/filename="?([^"]+)"?/);
    const filename = m?.[1] ?? `findings-export`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  getFinding: (id: string, contextTaskId?: string) =>
    get<Finding>(
      `/exploration/findings/${id}${contextTaskId ? `?context_task=${encodeURIComponent(contextTaskId)}` : ""}`,
    ),
  findingTraffic: (id: string, contextTask?: string) =>
    get<FindingTraffic>(
      `/exploration/findings/${id}/traffic${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
    ),
  bindFindingTraffic: (id: string, traffic_refs: TrafficEvidenceRef[], contextTask?: string) =>
    post<FindingTraffic>(
      `/exploration/findings/${id}/traffic${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
      { traffic_refs },
    ),
  editFindingTraffic: (
    id: string,
    bindingId: string,
    version: number,
    fields: { role: TrafficEvidenceRole; note: string },
    contextTask?: string,
  ) =>
    patch<FindingTraffic>(
      `/exploration/findings/${id}/traffic/${bindingId}${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
      { version, ...fields },
    ),
  removeFindingTraffic: (id: string, bindingId: string, version: number, contextTask?: string) =>
    del<FindingTraffic>(
      `/exploration/findings/${id}/traffic/${bindingId}${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
      { version },
    ),
  orderFindingTraffic: (id: string, binding_ids: string[], version: number, contextTask?: string) =>
    http<FindingTraffic>(
      `/exploration/findings/${id}/traffic/order${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
      { method: "PUT", body: JSON.stringify({ binding_ids, version }) },
    ),
  findingTrafficDetail: (id: string, bindingId: string, contextTask?: string) =>
    get<FindingTrafficDetail>(
      `/exploration/findings/${id}/traffic/${bindingId}${contextTask ? `?context_task=${encodeURIComponent(contextTask)}` : ""}`,
    ),
  findingTrafficBody: (
    id: string,
    bindingId: string,
    side: "request" | "response",
    offset: number,
    contextTask?: string,
  ) =>
    get<EvidenceBodyPreview>(
      `/exploration/findings/${id}/traffic/${bindingId}/body?side=${side}&offset=${offset}${contextTask ? `&context_task=${encodeURIComponent(contextTask)}` : ""}`,
    ),
  downloadFindingTrafficBody: async (
    id: string,
    bindingId: string,
    side: "request" | "response",
    contextTask?: string,
  ) => {
    const token = getToken();
    const response = await fetch(
      `/api/exploration/findings/${id}/traffic/${bindingId}/body?side=${side}&download=1${contextTask ? `&context_task=${encodeURIComponent(contextTask)}` : ""}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Download failed" }));
      throw new Error(error.error ?? "Download failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-${bindingId}-${side}.bin`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  // Finding lineage: the subgraph from this finding's node back to the task's initial node (nodes + relations).
  findingLineage: (id: string) => get<{ nodes: TaskNode[]; edges: Edge[] }>(`/exploration/findings/${id}/lineage`),
  setFindingStatus: (id: string, status: FindingStatus) => patch<Finding>(`/exploration/findings/${id}`, { status }),
  setFindingSeverity: (id: string, severity: Severity) => patch<Finding>(`/exploration/findings/${id}`, { severity }),
  // Save a finding's name/class/severity in one call (for inline editing in the findings list); only present fields are sent.
  updateFinding: (
    id: string,
    fields: { name?: string; vulnclass?: string; severity?: Severity; status?: FindingStatus },
  ) => patch<Finding>(`/exploration/findings/${id}`, fields),
  // Delete a finding: removes the findings record + its origin exploration node (disappears from the findings list, task findings tab, and exploration graph).
  deleteFinding: (id: string) => del<{ deleted: boolean; id: number }>(`/exploration/findings/${id}`),
  findingRetests: (id: string) =>
    get<{ retests: FindingRetest[] }>(`/exploration/findings/${encodeURIComponent(id)}/retests`).then((r) =>
      arr(r.retests),
    ),
  activeFindingRetests: () =>
    get<{ retests: ActiveFindingRetest[] }>("/exploration/findings/retests/active").then((r) => arr(r.retests)),
  startFindingRetest: (id: string, notes: string) =>
    post<{ retest: FindingRetest; created: boolean }>(`/exploration/findings/${encodeURIComponent(id)}/retests`, {
      notes,
    }),
  deepenFinding: (id: string, description: string) =>
    post<FindingDeepenResponse>(`/exploration/findings/${id}/deepen`, { description }),
  intents: (task?: string) => get<TaskNode[]>(`/exploration/intents${tq(task)}`).then(arr),
  tokenStats: (task?: string) =>
    get<{ workers: TokenUsage[]; sessions: SessionTokenUsage[]; total: TokenTotal }>(
      `/exploration/tokens${tq(task)}`,
    ).then((r) => ({
      workers: arr(r.workers),
      sessions: arr(r.sessions),
      total: r.total,
    })),
  conversationTokens: () =>
    get<ConvTokenSummary[]>("/tokens/conversations")
      .then(arr)
      .catch(() => [] as ConvTokenSummary[]),
  explorationGraph: (task?: string) => get<{ nodes: TaskNode[]; edges: Edge[] }>(`/exploration/graph${tq(task)}`),
  // Broadcast board: exploration nodes paged by creation order on the server (newest first by default).
  explorationNodes: (task: string, query: ExplorationNodeQuery = {}) => {
    const q = new URLSearchParams();
    if (task) q.set("task", task);
    q.set("page", String(query.page ?? 1));
    q.set("size", String(query.size ?? 20));
    if (query.kinds?.length) q.set("kind", query.kinds.join(","));
    if (query.states?.length) q.set("state", query.states.join(","));
    if (query.q?.trim()) q.set("q", query.q.trim());
    if (query.order === "asc") q.set("order", "asc");
    return get<ExplorationNodePage>(`/exploration/nodes?${q.toString()}`).then((r) => ({
      items: arr(r.items),
      total: r.total ?? 0,
      page: r.page ?? 1,
      size: r.size ?? query.size ?? 20,
      edges: arr(r.edges),
      refs: r.refs ?? {},
      assets: r.assets ?? {},
    }));
  },
  activity: (task?: string, opts?: { intent?: string; since?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (task) q.set("task", task);
    if (opts?.intent) q.set("intent", opts.intent);
    if (opts?.since) q.set("since", String(opts.since));
    if (opts?.limit) q.set("limit", String(opts.limit));
    return get<{ items: Activity[]; cursor: number }>(`/exploration/activity?${q.toString()}`).then((r) => ({
      items: arr(r.items),
      cursor: r.cursor ?? 0,
    }));
  },
  activityDetail: (id: number, task?: string) => get<{ detail: string }>(`/exploration/activity/${id}${tq(task)}`),
  // Reverse-paginated session history. session = "main" | "plan" | "intent:<id>".
  // before=0 → latest page; before=<id> → the older page ending before that id.
  // snapshotCursor is the TASK-level max id at query time — open the task SSE at
  // since=snapshotCursor so history (id≤cursor) and the live tail (id>cursor) meet
  // gap-free. hasMore = still-older steps exist (drives scroll-up loading).
  activityHistory: (task: string, session: string, before = 0, limit = 200) => {
    const q = new URLSearchParams({ session, limit: String(limit) });
    if (task) q.set("task", task);
    if (before > 0) q.set("before", String(before));
    return get<{ items: Activity[]; snapshot_cursor: number; earliest_cursor: number; has_more: boolean }>(
      `/exploration/activity/history?${q.toString()}`,
    ).then((r) => ({
      items: arr(r.items),
      snapshotCursor: r.snapshot_cursor ?? 0,
      earliestCursor: r.earliest_cursor ?? 0,
      hasMore: !!r.has_more,
    }));
  },
  // Paged worker (intent) session list — reaches past the legacy fixed 300 cap.
  // before=0 → newest page; before=<id> → older page. has_more = older intents exist.
  intentsPage: (task: string, before = 0, limit = 300) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (task) q.set("task", task);
    q.set("before", String(before > 0 ? before : 0));
    q.set("page", "1"); // marker so the backend returns the paged {items,has_more} shape
    return get<{ items: TaskNode[]; has_more: boolean }>(`/exploration/intents?${q.toString()}`).then((r) => ({
      items: arr(r.items),
      hasMore: !!r.has_more,
    }));
  },

  // Main-agent conversation segments of a task. Each segment is a resettable session
  // (clean transcript/context) over the same task; `current` is the writable one.
  mainSessions: (task: string) =>
    get<{ sessions: { seq: number; created_at: string }[]; current: number }>(
      `/exploration/main-sessions${tq(task)}`,
    ).then((r) => ({ sessions: arr(r.sessions), current: r.current ?? 0 })),
  // Start a fresh main-agent session segment (does not touch the task's graph/assets/goal).
  newMainSession: (task: string) =>
    post<{ seq: number; created_at: string; current: number }>(`/exploration/main-session/new${tq(task)}`),

  // ---- traffic / audit / report / chat ----
  audit: (task?: string) => get<Audit>(`/audit${tq(task)}`),
  traffic: (
    page = 0,
    size = 100,
    host = "",
    method = "",
    q = "",
    opts: {
      body?: string;
      path?: string;
      status?: string;
      respMin?: string;
      respMax?: string;
      sort?: string;
      order?: string;
    } = {},
  ) =>
    get<TrafficResp>(
      `/traffic?page=${page}&size=${size}` +
        (host ? `&host=${encodeURIComponent(host)}` : "") +
        (method && method !== "all" ? `&method=${encodeURIComponent(method)}` : "") +
        (q ? `&q=${encodeURIComponent(q)}` : "") +
        (opts.body ? `&body=${encodeURIComponent(opts.body)}` : "") +
        (opts.path ? `&path=${encodeURIComponent(opts.path)}` : "") +
        (opts.status && opts.status !== "all" ? `&status=${encodeURIComponent(opts.status)}` : "") +
        (opts.respMin ? `&resp_min=${encodeURIComponent(opts.respMin)}` : "") +
        (opts.respMax ? `&resp_max=${encodeURIComponent(opts.respMax)}` : "") +
        (opts.sort ? `&sort=${encodeURIComponent(opts.sort)}` : "") +
        (opts.order ? `&order=${encodeURIComponent(opts.order)}` : ""),
    ),
  trafficExchange: (id: string) => get<TrafficDetail>(`/traffic/exchange?id=${encodeURIComponent(id)}`),
  trafficHosts: () => get<{ hosts: TrafficHost[] }>(`/traffic/hosts`),
  trafficDeleteHost: (host: string) => del<{ deleted: number }>(`/traffic?host=${encodeURIComponent(host)}`),
  trafficDeleteHosts: (hosts: string[]) => del<{ deleted: number }>(`/traffic/hosts`, { hosts }),
  // Purges every exchange and compacts the index; `reclaimed` is the bytes of
  // index handed back to the filesystem. Evidence bound to findings is kept.
  trafficDeleteAll: () => del<{ deleted: number; reclaimed: number }>(`/traffic/all`),
};

export type TasksApi = typeof tasksApi;
