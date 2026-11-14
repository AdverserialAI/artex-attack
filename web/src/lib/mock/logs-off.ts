// Empty stub replacing lib/mock/logs in production builds: next.config.mjs uses resolveAlias in non-MOCK builds
// to point "@/lib/mock/logs" at this module. Never reached at runtime (it only loads when MOCK is true,
// and that build does not apply this alias).
/**
 * Main functions/types:
 *   - MOCK_LOGS: empty log-array stub (replaces the mock/logs sample data)
 */
import type { LogLine } from "@/lib/types";

export const MOCK_LOGS: LogLine[] = [];
