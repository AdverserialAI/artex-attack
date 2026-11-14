/**
 * task-assets.ts: display-label mappings for task asset types and sources.
 * Main functions/types:
 *   - taskAssetTypeLabel / taskAssetSourceLabel: get display labels for asset type and source
 */
import type { NewAssetType } from "@/lib/types";

const ASSET_TYPE_LABELS: Record<NewAssetType, string> = {
  app: "App",
  endpoint: "Endpoint",
  ip: "IP",
  root_domain: "Root domain",
  service: "Service",
  subdomain: "Subdomain",
};

const TASK_ASSET_SOURCE_LABELS: Record<string, string> = {
  agent: "Agent-discovered",
  anchor: "Blackboard anchor",
  api: "Asset API",
  company: "Company-linked",
  legacy: "Legacy link",
  manual: "Manually added",
  system: "System-linked",
  task: "Task initialization",
};

export function taskAssetTypeLabel(type: NewAssetType): string {
  return ASSET_TYPE_LABELS[type];
}

export function taskAssetSourceLabel(source: string): string {
  return TASK_ASSET_SOURCE_LABELS[source] ?? source;
}
