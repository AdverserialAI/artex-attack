// llm-agents domain: runtime settings, finding IM notifications, reports and agent chat (with upload), LLM config/
// profiles/pool/retry, agents, conversations, agent prompts/wrapup/triggers/visibility, tool catalog, MCP,
// ScopeSentry asset sync, skills, and resource visibility.
/**
 * Main functions/types:
 *   - llmAgentsApi / LlmAgentsApi: llm-agents domain API aggregate object and its type
 *   - settings/testWebSearch: runtime settings and web-search testing
 *   - notify* family: finding IM channel CRUD, testing, and delivery records
 *   - llm·/agent·/conversation· method groups: LLM config/profiles/pool, agents, and conversation chat
 *   - tools/mcp·/asset-sync/skills/visibility method groups: tool catalog, MCP, asset sync, and resource visibility
 */

import { arr, del, get, getToken, http, patch, post, put, tq } from "@/lib/api/http";
import type { ChatMention } from "@/lib/chat-mentions";
import { MOCK } from "@/lib/mock/enabled";
import type {
  Activity,
  Agent,
  AgentDetail,
  AgentTrigger,
  ChatAttachment,
  Conversation,
  LLMPoolStatus,
  LLMProfile,
  LLMRetryOverride,
  LLMRetryPolicy,
  MCPServer,
  MCPTool,
  MissingSkill,
  NotificationChannel,
  NotificationDelivery,
  NotificationFilter,
  NotificationMeta,
  Settings,
  SkillCall,
  SkillItem,
  SSProject,
  SSTask,
  Tool,
} from "@/lib/types";

export const llmAgentsApi = {
  // ---- app settings (runtime toggles) ----
  settings: () => get<Settings>(`/settings`),
  setSettings: (patch: Partial<Settings>) => put<Settings>(`/settings`, patch),
  // Run a real "test" search with the given (or saved) config to verify it works.
  testWebSearch: (patch: {
    web_search_backend?: string;
    web_search_proxy?: string;
    brave_search_api_key?: string;
    tavily_search_api_key?: string;
  }) => post<{ ok: boolean; error?: string; count?: number; backend?: string }>(`/settings/web-search/test`, patch),

  // ---- Finding IM notifications ----
  // Channels are multi-instance resources (multiple bots of the same type, each with its own filters), so they form their own group
  // rather than being flattened into settings keys.
  notifyMeta: () => get<NotificationMeta>(`/notify/meta`),
  notifyChannels: () => get<{ channels: NotificationChannel[] }>(`/notify/channels`).then((r) => arr(r.channels)),
  notifyCreateChannel: (payload: {
    name: string;
    kind: string;
    enabled?: boolean;
    mode?: string;
    config: Record<string, unknown>;
    filter?: NotificationFilter;
    rate_per_min?: number;
  }) => post<{ id: number }>(`/notify/channels`, payload),
  // PATCH semantics: only changed fields are submitted. Masked values in config are sent back verbatim to mean "keep the original".
  notifyUpdateChannel: (
    id: number,
    payload: {
      name?: string;
      kind?: string;
      enabled?: boolean;
      mode?: string;
      config?: Record<string, unknown>;
      filter?: NotificationFilter;
      rate_per_min?: number;
    },
  ) => patch<{ id: number }>(`/notify/channels/${id}`, payload),
  notifyDeleteChannel: (id: number) => del<{ ok: boolean }>(`/notify/channels/${id}`),
  // Sends a test message synchronously; on failure the backend returns the channel's raw error for troubleshooting.
  notifyTestChannel: (id: number) => post<{ ok: boolean; latency_ms: number }>(`/notify/channels/${id}/test`),
  notifyDeliveries: (q: { channelId?: number; state?: string; page?: number; pageSize?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.channelId) p.set("channel_id", String(q.channelId));
    if (q.state) p.set("state", q.state);
    p.set("page", String(q.page ?? 1));
    p.set("page_size", String(q.pageSize ?? 50));
    return get<{ deliveries: NotificationDelivery[]; total: number; page: number; page_size: number }>(
      `/notify/deliveries?${p.toString()}`,
    ).then((r) => ({ ...r, deliveries: arr(r.deliveries) }));
  },
  notifyRetryDelivery: (id: number) => post<{ ok: boolean }>(`/notify/deliveries/${id}/retry`),
  report: async (task?: string) => {
    // The env var must be checked directly so webpack DefinePlugin can fold away the dynamic import;
    // Turbopack instead replaces it with an empty stub via next.config.mjs resolveAlias.
    if (process.env.NEXT_PUBLIC_MOCK === "1") return (await import("@/lib/mock/report")).mockReport(task);
    const token = getToken();
    const r = await fetch(`/api/report${tq(task)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(`report: ${r.status}`);
    return r.text();
  },
  chatMentions: (kind: string, query: string, signal?: AbortSignal, cursor = "") =>
    http<{ items: ChatMention[]; next_cursor?: string }>(
      `/chat/mentions?${new URLSearchParams({ kind, q: query, cursor })}`,
      { signal },
    ),
  chat: (message: string, task?: string, attachments?: ChatAttachment[], seg?: number) =>
    post<{ reply: string; mode: string }>(`/chat${tq(task)}`, { message, attachments, seg }),
  chatStatus: (taskId: string) => get<{ running: boolean }>(`/tasks/${taskId}/chat/status`),
  // Method 1 file upload: stored under the session/task workdir uploads/; returns a relative path the agent can Read.
  chatUpload: async (scope: "task" | "session" | "staging", id: string, files: File[]) => {
    if (MOCK)
      return {
        attachments: files.map((f) => ({
          name: f.name,
          path: `uploads/${f.name}`,
          size: f.size,
          abs: `/mock/${f.name}`,
        })),
      };
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    const token = getToken();
    const r = await fetch(`/api/chat/upload?scope=${scope}&id=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: fd,
    });
    if (!r.ok) throw new Error(`Upload failed: ${r.status} ${await r.text()}`);
    return r.json() as Promise<{ attachments: ChatAttachment[] }>;
  },
  stopChat: (taskId: string) => post<{ status: string }>(`/tasks/${taskId}/chat/stop`, {}),

  // ---- LLM ----
  setLLM: (
    provider: string,
    model: string,
    base_url: string,
    api_key: string,
    rate_per_second = 0,
    rate_per_minute = 0,
    proxy = "",
    context_window_k = 0,
  ) => post("/llm", { provider, model, base_url, proxy, api_key, rate_per_second, rate_per_minute, context_window_k }),
  testLLM: (
    provider: string,
    model: string,
    base_url: string,
    api_key: string,
    proxy = "",
    thinking_type = "",
    reasoning_effort = "",
    profile_id?: number,
    streaming = true, // test with the profile's real streaming mode so "streaming works but non-streaming doesn't" can't slip into sessions
    session_header_key = "", // non-empty = test requests also carry this custom session header (value = one-off session id)
  ) =>
    // reply = the model's actual reply (truncated); profiles that return nothing are failed by the backend
    post<{ ok: boolean; error?: string; latency_ms?: number; model?: string; reply?: string }>("/llm/test", {
      provider,
      model,
      base_url,
      proxy,
      api_key,
      thinking_type,
      reasoning_effort,
      profile_id,
      streaming,
      session_header_key,
    }),
  llmProfiles: () => get<{ profiles: LLMProfile[] }>("/llm/profiles").then((r) => arr(r.profiles)),
  saveLLMProfile: (p: {
    id?: number; // omit/0 = create; set = update that profile
    name: string;
    format: string;
    model: string;
    base_url?: string;
    proxy?: string;
    api_key?: string; // blank on update keeps the existing key
    rate_per_second?: number;
    rate_per_minute?: number;
    context_window_k?: number;
    thinking_type?: string; // ""(not sent)|"disabled"|"enabled"
    reasoning_effort?: string; // ""(not sent)|"low"|"medium"|"high"|"xhigh"|"max"
    priority?: number; // poll order — higher values are tried first
    pool_exclude?: boolean; // true = not used as a failover target
    streaming?: boolean; // true (default) = streaming | false = non-streaming
    max_tokens?: number; // per-response output cap; 0 = not sent, server default applies
    max_tokens_field?: string; // "" = max_tokens (default) | "max_completion_tokens" (openai format only)
    session_header_key?: string; // non-empty = each request carries this HTTP header with the current session id; "" = not sent
    retry?: LLMRetryOverride; // per-profile retry overrides; 0 for any field = follow the global retry policy
  }) => post<{ id: number }>("/llm/profiles", p),
  deleteLLMProfile: (id: string) => del<{ deleted: number }>(`/llm/profiles/${id}`),
  activateLLMProfile: (id: string) => post<{ ok: boolean }>("/llm/profiles/active", { id: Number(id) }),
  // The actual poll-chain order plus each profile's circuit-breaker state.
  llmPool: () => get<LLMPoolStatus>("/llm/pool"),
  // Clear circuit breakers so the next call retries the profile immediately; omitting id = clear all.
  resetLLMPool: (id?: string) => post<LLMPoolStatus>("/llm/pool/reset", { id: id ? Number(id) : 0 }),
  // Global retry policy (attempts + interval for each of the five layers). All zeros = built-in defaults everywhere.
  llmRetryPolicy: () => get<LLMRetryPolicy>("/llm/retry-policy"),
  saveLLMRetryPolicy: (p: LLMRetryPolicy) => post<LLMRetryPolicy>("/llm/retry-policy", p),
  fetchLLMModels: (provider: string, base_url: string, api_key: string, proxy = "", profile_id?: number) =>
    post<{ ok: boolean; error?: string; models?: string[] }>("/llm/models", {
      provider,
      base_url,
      api_key,
      proxy,
      profile_id,
    }),

  // ---- agents ----
  agents: () => get<{ agents: Agent[] }>("/agents").then((r) => arr(r.agents)),
  getAgent: (key: string) => get<AgentDetail>(`/agents/${key}`),
  createAgent: (key: string, name: string, description = "") => post<Agent>("/agents", { key, name, description }),
  deleteAgent: (key: string) => del<{ deleted: string }>(`/agents/${key}`),

  // ---- conversations (chat page) ----
  conversations: () => get<{ conversations: Conversation[] }>("/conversations").then((r) => arr(r.conversations)),
  createConversation: (agent_key: string, title = "", llm_profile_id?: number | null) =>
    post<Conversation>("/conversations", { agent_key, title, llm_profile_id: llm_profile_id ?? null }),
  updateConversation: (id: number, input: { title?: string; pinned?: boolean }) =>
    patch<Conversation>(`/conversations/${id}`, input),
  renameConversation: (id: number, title: string) => patch<Conversation>(`/conversations/${id}`, { title }),
  pinConversation: (id: number, pinned: boolean) => patch<Conversation>(`/conversations/${id}`, { pinned }),
  updateConversationProfile: (id: number, llm_profile_id: number | null) =>
    patch<{ ok: boolean }>(`/conversations/${id}/profile`, { llm_profile_id }),
  deleteConversation: (id: number) => del<{ deleted: number }>(`/conversations/${id}`),
  deleteConversations: (ids: number[]) =>
    post<{ items: { id: number; ok: boolean; error?: string }[] }>("/conversations/delete/batch", { ids }),
  // Incremental tail: steps after `since` (id ASC) — live poll + post-send fetch.
  conversationMessages: (id: number, since = 0) =>
    get<{ items: Activity[]; cursor: number; running: boolean }>(`/conversations/${id}/messages?since=${since}`).then(
      (r) => ({ items: arr(r.items), cursor: r.cursor ?? 0, running: !!r.running }),
    ),
  // Reverse pagination: the latest `limit` steps (before=0) or the page of older
  // steps ending before id `before`. hasMore = still-older steps exist.
  conversationHistory: (id: number, before = 0, limit = 200) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before > 0) q.set("before", String(before));
    return get<{ items: Activity[]; cursor: number; running: boolean; hasMore: boolean }>(
      `/conversations/${id}/messages?${q.toString()}`,
    ).then((r) => ({ items: arr(r.items), cursor: r.cursor ?? 0, running: !!r.running, hasMore: !!r.hasMore }));
  },
  conversationMsgDetail: (id: number, seq: number) =>
    get<{ detail: string }>(`/conversations/${id}/messages/${seq}`).then((r) => r.detail ?? ""),
  sendConversationMessage: (id: number, message: string, attachments?: ChatAttachment[]) =>
    post<{ status: string }>(`/conversations/${id}/messages`, { message, attachments }),
  stopConversation: (id: number) => post<{ status: string }>(`/conversations/${id}/stop`, {}),
  saveAgentPrompt: (key: string, template: string, note = "") =>
    put<{ version: number }>(`/agents/${key}/prompt`, { template, note }),
  resetAgentPrompt: (key: string) => post<{ version: number }>(`/agents/${key}/prompt/reset`, {}),
  // Wrap-up prompt (settlement prompt on timeout/step-budget exhaustion); empty prompt = clear the override and use the built-in default;
  // max_turns omitted = unchanged; 0 = use the built-in default turn count
  saveAgentWrapup: (key: string, prompt: string, maxTurns?: number) =>
    put<{ ok: boolean }>(`/agents/${key}/wrapup`, { prompt, max_turns: maxTurns }),
  resetAgentWrapup: (key: string) =>
    post<{ ok: boolean; wrapup_default: string; wrapup_max_turns_default: number }>(`/agents/${key}/wrapup/reset`, {}),
  // Task-level timeout wrap-up prompt (worker/planner only); empty prompt = clear, use built-in default
  saveAgentTaskTimeoutWrapup: (key: string, prompt: string, maxTurns?: number) =>
    put<{ ok: boolean }>(`/agents/${key}/wrapup/task-timeout`, { prompt, max_turns: maxTurns }),
  resetAgentTaskTimeoutWrapup: (key: string) =>
    post<{ ok: boolean; task_timeout_wrapup_default: string; task_timeout_wrapup_max_turns_default: number }>(
      `/agents/${key}/wrapup/task-timeout/reset`,
      {},
    ),
  // P3 triggers (custom agents only)
  agentTriggers: (key: string) =>
    get<{ triggers: AgentTrigger[] }>(`/agents/${key}/triggers`).then((r) => arr(r.triggers)),
  createTrigger: (key: string, t: Omit<AgentTrigger, "id" | "agent_key" | "last_fire">) =>
    post<AgentTrigger>(`/agents/${key}/triggers`, t),
  updateTrigger: (id: number, t: Omit<AgentTrigger, "id" | "agent_key" | "last_fire">) =>
    patch<{ ok: boolean }>(`/triggers/${id}`, t),
  deleteTrigger: (id: number) => del<{ deleted: number }>(`/triggers/${id}`),
  saveAgentConfig: (
    key: string,
    patch: {
      llm_profile_id?: number | null; // number = bind; null = unbind (follow task/global); omitted = unchanged
      max_turns?: number;
      run_seconds?: number;
      web_search?: boolean;
      interactive_shell?: boolean;
      trigger_run_mode?: "serial" | "parallel";
      trigger_merge_mode?: "by_task" | "all" | "none";
      trigger_max_parallel?: number;
      executor_key?: string; // [fork P-EXEC U1] executor key passthrough (empty string = clear; custom agents only, K18)
      // [fork P-FINTENT U1] begin — first-intent gating (false must be submitted explicitly, not omitted; custom agents only)
      planner_controlled?: boolean;
      // [fork P-FINTENT U1] end
    },
  ) => put<{ ok: boolean }>(`/agents/${key}/config`, patch),
  previewAgentPrompt: (key: string, template: string, sample?: Record<string, string>) =>
    post<{ rendered: string; error?: string }>(`/agents/${key}/prompt/preview`, { template, sample }),
  setAgentVisibility: (key: string, mcp: number[], skill: string[]) =>
    put<{ ok: boolean }>(`/agents/${key}/visibility`, { mcp, skill }),

  // ---- tools (built-in tool catalog) ----
  tools: () => get<{ tools: Tool[] }>("/tools").then((r) => arr(r.tools)),
  saveTool: (key: string, patch: Pick<Tool, "description" | "schema" | "agents" | "enabled">) =>
    put<{ ok: boolean }>(`/tools/${key}`, patch),
  resetTool: (key: string) => post<{ ok: boolean }>(`/tools/${key}/reset`, {}),
  // custom tools (user-defined tools)
  createCustomTool: (
    t: Pick<Tool, "key" | "description" | "schema" | "agents" | "enabled" | "kind" | "exec" | "deferred">,
  ) => post<{ key: string }>("/tools/custom", t),
  updateCustomTool: (
    key: string,
    t: Pick<Tool, "description" | "schema" | "agents" | "enabled" | "kind" | "exec" | "deferred">,
  ) => put<{ ok: boolean }>(`/tools/custom/${key}`, t),
  deleteCustomTool: (key: string) => del<{ deleted: string }>(`/tools/custom/${key}`),
  testCustomTool: (body: { kind: string; exec: Record<string, unknown>; params: Record<string, unknown> }) =>
    post<{ output: string; is_error: boolean }>("/tools/custom/test", body),
  detectPython: () => post<{ python_interpreter: string }>("/settings/python/detect", {}),

  // ---- mcp ----
  mcpServers: () => get<{ servers: MCPServer[] }>("/mcp").then((r) => arr(r.servers)),
  saveMcpServer: (m: Partial<MCPServer>) => post<{ id: number }>("/mcp", m),
  deleteMcpServer: (id: number) => del<{ deleted: number }>(`/mcp/${id}`),
  mcpTools: (id: number) => get<{ tools: MCPTool[] }>(`/mcp/${id}/tools`).then((r) => arr(r.tools)),
  refreshMcpServer: (id: number) => post<{ tools: MCPTool[] }>(`/mcp/${id}/refresh`, {}).then((r) => arr(r.tools)),

  // ---- Asset sync (ScopeSentry data source) ----
  ssStatus: () =>
    get<{ exists: boolean; configured: boolean; enabled: boolean; reachable: boolean; url?: string; tools: string[] }>(
      "/sync/scopesentry/status",
    ),
  ssDatasource: (body: { url?: string; api_key?: string }) =>
    post<{ id: number; enabled: boolean }>("/sync/scopesentry/datasource", body),
  ssProjects: (page = 1, size = 50, search = "") =>
    get<{ projects: SSProject[]; tag: Record<string, number> }>(
      `/sync/scopesentry/projects?page=${page}&size=${size}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ).then((r) => ({ projects: arr(r.projects), tag: r.tag ?? {} })),
  ssTasks: (page = 1, size = 50, search = "") =>
    get<{ tasks: SSTask[] }>(
      `/sync/scopesentry/tasks?page=${page}&size=${size}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ).then((r) => arr(r.tasks)),
  ssSync: (body: {
    dimension: "project" | "task";
    targets: string[];
    asset_types: string[];
    create_company?: boolean;
    page_size?: number;
  }) =>
    post<{
      synced: Record<string, number>;
      companies: string[] | null;
      warnings: string[] | null;
      errors: string[] | null;
    }>("/sync/scopesentry/sync", body),

  // ---- skills (filesystem) ----
  skills: () => get<{ skills: SkillItem[] }>("/skills").then((r) => arr(r.skills)),
  createSkill: (s: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    mcps?: string[];
    instructions?: string;
  }) => post<{ name: string }>("/skills", s),
  // uploadSkill installs a skill from a .zip (multipart). Surfaces the backend
  // error text (e.g. already exists / missing SKILL.md) so the UI can show a precise message.
  uploadSkill: async (file: File, overwrite = false): Promise<{ name: string; files: number }> => {
    if (MOCK) return { name: file.name.replace(/\.zip$/i, ""), files: 1 };
    const fd = new FormData();
    fd.append("file", file);
    const token = getToken();
    const r = await fetch(`/api/skills/upload${overwrite ? "?overwrite=true" : ""}`, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.error || `Upload failed (${r.status})`);
    return body;
  },
  deleteSkill: (name: string) => del<{ deleted: string }>(`/skills/${name}`),
  updateSkillMeta: (
    name: string,
    meta: { mcps?: string[]; description?: string; license?: string; compatibility?: string },
  ) => put<{ ok: boolean }>(`/skills/${name}/meta`, meta),
  createSkillDir: (skill: string, path: string) => post<{ dir: string }>(`/skills/${skill}/dirs`, { path }),
  readSkillFile: (name: string, file: string) =>
    get<{ content: string; file: string }>(`/skills/${name}/files/${file}`).then((r) => r.content ?? ""),
  writeSkillFile: (name: string, file: string, content: string) =>
    put<{ ok: boolean }>(`/skills/${name}/files/${file}`, { content }),
  deleteSkillPath: (skill: string, path: string) => del<{ deleted: string }>(`/skills/${skill}/files/${path}`),
  skillUsage: (name: string, limit = 50) =>
    get<{ calls: SkillCall[] }>(`/skills/${name}/usage?limit=${limit}`).then((r) => arr(r.calls)),
  missingSkills: (limit = 20) =>
    get<{ missing: MissingSkill[] }>(`/skills/missing?limit=${limit}`).then((r) => arr(r.missing)),

  // ---- visibility (MCP resource side) ---- (agent ids are strings per spec)
  resourceVisibility: (kind: string, id: number) =>
    get<{ agents: string[] }>(`/visibility/${kind}/${id}`).then((r) => arr(r.agents)),
  toggleVisibility: (agentId: string, kind: string, resourceId: number, visible: boolean) =>
    post<{ ok: boolean }>("/visibility/toggle", { agent_id: agentId, kind, resource_id: resourceId, visible }),

  // ---- visibility (Skill, by name) ----
  skillVisibility: (name: string) => get<{ agents: string[] }>(`/visibility/skill/${name}`).then((r) => arr(r.agents)),
  toggleSkillVisibility: (agentId: string, skillName: string, visible: boolean) =>
    post<{ ok: boolean }>("/visibility/skill/toggle", { agent_id: agentId, skill_name: skillName, visible }),
};

export type LlmAgentsApi = typeof llmAgentsApi;
