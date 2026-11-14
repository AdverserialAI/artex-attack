/**
 * asset-refs-section.tsx: hooks and display components for asset-related data (intents/facts/findings).
 * Main functions/types:
 *   - useAssetRefs / useIPAssetRefs: fetch in-task asset-related data by asset_id / IP
 *   - AssetRefsSection: three sections for intents/facts/findings; not rendered when empty
 *   - RawJSON: collapsible raw JSON block
 */
"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Asset, CoverageAssetRef, CoverageAssetRefs } from "@/lib/types";

/**
 * Intents/facts/findings linked to the asset within this task.
 * Shared by the coverage drawer and the topology node drawer to keep the data-fetching logic from drifting apart.
 */
export function useAssetRefs(taskId: string, assetId: number | null | undefined): CoverageAssetRefs | null {
  const [refs, setRefs] = React.useState<CoverageAssetRefs | null>(null);

  React.useEffect(() => {
    setRefs(null);
    if (!assetId) return;
    let cancelled = false;
    api
      .taskAssetRefs(taskId, assetId)
      .then((r) => {
        if (!cancelled) setRefs(r);
      })
      .catch(() => {
        /* no links or an error: do not show this section */
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, assetId]);

  return refs;
}

/**
 * Topology nodes only have an IP, no asset_id. First find the matching asset in task assets by `ip==…`, then fetch related data.
 * Returns null when not found (or the asset is not in this task); the drawer then shows only raw graph data.
 */
export function useIPAssetRefs(taskId: string, ip: string | null): CoverageAssetRefs | null {
  const [assetId, setAssetId] = React.useState<number | null>(null);

  React.useEffect(() => {
    setAssetId(null);
    if (!ip) return;
    let cancelled = false;
    api
      .searchTaskAssets(taskId, `ip==${ip}`, "ip", 1, 0)
      .then((r) => {
        if (cancelled) return;
        const hit = (r.assets ?? []).find((a: Asset) => a.ip === ip) ?? (r.assets ?? [])[0];
        setAssetId(hit?.id ?? null);
      })
      .catch(() => {
        /* ignore: no matching asset */
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, ip]);

  return useAssetRefs(taskId, assetId);
}

function RefList({ title, items }: { title: string; items: CoverageAssetRef[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-muted-foreground mb-1 text-xs font-medium">
        {title}（{items.length}）
      </h4>
      <div className="flex flex-col gap-1">
        {items.map((r) => (
          <div
            key={`${r.kind}-${r.id}`}
            className="bg-muted/50 flex flex-wrap items-start gap-2 rounded-md px-2 py-1.5 text-xs"
          >
            <span className="text-muted-foreground shrink-0 font-mono">#{r.id}</span>
            {r.state && <span className="text-muted-foreground shrink-0">{r.state}</span>}
            <span className="text-foreground min-w-32 flex-1 break-words">{r.summary || "—"}</span>
            {r.inherited && r.source_task_id && (
              <Badge variant="outline" className="shrink-0">
                Source #{r.source_task_id} · Read-only
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Three sections for linked intents/facts/findings; the whole block is not rendered when empty. */
export function AssetRefsSection({ refs }: { refs: CoverageAssetRefs | null }) {
  if (!refs) return null;
  if (refs.intents.length === 0 && refs.facts.length === 0 && refs.findings.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <RefList title="Linked intents" items={refs.intents} />
      <RefList title="Linked facts" items={refs.facts} />
      <RefList title="Linked findings" items={refs.findings} />
    </div>
  );
}

/** Collapsible raw JSON block. */
export function RawJSON({ value }: { value: unknown }) {
  return (
    <pre className="bg-muted/50 text-foreground max-w-full overflow-hidden rounded-md border p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
