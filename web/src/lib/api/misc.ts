// misc domain: tool execution history (commands), LLM call records, and per-model token aggregation.
/**
 * Main functions/types:
 *   - miscApi / MiscApi: misc-domain API aggregate object and its type
 *   - commands / commandStats: paged tool execution history and per-tool call counts
 *   - llmRecords/llmRecordDetail/llmTasks/llmRecordsDeleteTask/tokensByModel: LLM call records and per-model token aggregation
 */
import { del, get, post } from "@/lib/api/http";
import type {
  CommandRecord,
  LLMRecordDetail,
  LLMRecordItem,
  LLMTask,
  ModelTokenStat,
  ToolStat,
} from "@/lib/types";

export const miscApi = {
  // ---- commands (tool execution history, any tool) ----
  commands: (params?: { task?: string; q?: string; page?: number; size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.task) sp.set("task", params.task);
    if (params?.q) sp.set("q", params.q);
    sp.set("page", String(params?.page ?? 0));
    sp.set("size", String(params?.size ?? 50));
    return get<{ commands: CommandRecord[]; total: number }>(`/commands?${sp}`);
  },
  // Per-tool call counts; uses the same task/q filters as the list but covers the whole result set, not just the current page.
  commandStats: (params?: { task?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.task) sp.set("task", params.task);
    if (params?.q) sp.set("q", params.q);
    return get<{ stats: ToolStat[] }>(`/commands/stats?${sp}`);
  },

  // ---- LLM records ----
  llmRecords: (params?: { model?: string; session?: string; task?: string; page?: number; size?: number }) => {
    const sp = new URLSearchParams();
    if (params?.model) sp.set("model", params.model);
    if (params?.session) sp.set("session", params.session);
    if (params?.task) sp.set("task", params.task);
    if (params?.page !== undefined) sp.set("page", String(params.page));
    sp.set("size", String(params?.size ?? 50));
    return get<{ records: LLMRecordItem[]; total: number }>(`/llm/records?${sp}`);
  },
  llmRecordDetail: (id: number) => get<LLMRecordDetail>(`/llm/records/${id}`),
  llmTasks: () => get<{ tasks: LLMTask[] }>(`/llm/records/tasks`),
  llmRecordsDeleteTask: (task: string) => del<{ deleted: number }>(`/llm/records?task=${encodeURIComponent(task)}`),
  // Aggregate this task's token usage by model (from the always-on llm_usage metering ledger — exact per call,
  // covering per-agent bindings, polling, and interrupted consumption).
  tokensByModel: (task: string) =>
    get<{ models: ModelTokenStat[] }>(`/llm/records/by-model?task=${encodeURIComponent(task)}`),
};

export type MiscApi = typeof miscApi;
