// Local sample logs for the system/logs page in MOCK builds (no backend SSE connection).
// Extracted from page.tsx: the page dynamically imports this module; non-MOCK builds
// replace it with the logs-off stub via next.config.mjs resolveAlias, keeping sample data out of the production bundle.
/**
 * Main functions/types:
 *   - MOCK_LOGS: local sample log lines for the system/logs page (replaces backend SSE in MOCK builds)
 */
import type { LogLine } from "@/lib/types";

export const MOCK_LOGS: LogLine[] = [
  { seq: 1, ts: "2026-07-26T03:55:00Z", level: "info", tag: "engine", text: "artex v0.1.0 backend listening on :8787 (workers=3)" },
  { seq: 2, ts: "2026-07-26T03:55:01Z", level: "info", tag: "config", text: "LLM configured from DB: anthropic / claude-opus-4-8" },
  { seq: 3, ts: "2026-07-26T03:56:10Z", level: "info", tag: "planner", text: "task t-acme-web: planning round 3, generated intent i-4" },
  { seq: 4, ts: "2026-07-26T03:57:00Z", level: "warn", tag: "guard", text: "block bash: target out of bounds — out.evil.example is not in scope" },
  { seq: 5, ts: "2026-07-26T03:57:30Z", level: "info", tag: "work#1", text: "report_finding: Default Credentials (high) persisted" },
  { seq: 6, ts: "2026-07-26T03:58:20Z", level: "error", tag: "work#3", text: "intercept: mysqldump matched a destructive rule, awaiting manual approval" },
];
