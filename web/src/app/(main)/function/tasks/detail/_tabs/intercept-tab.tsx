/**
 * intercept-tab.tsx: intercept records panel; wraps ApprovalRecords to show a task's manual approval records.
 * Main functions/types:
 *   - InterceptTab: thin wrapper rendering ApprovalRecords by taskId.
 */
"use client";

import { ApprovalRecords } from "@/components/approval-records";

export function InterceptTab({ taskId }: { taskId: string }) {
  return <ApprovalRecords key={taskId} taskId={taskId} />;
}
