/**
 * topology-tab.tsx: asset coverage/topology entry panel; switches between coverage view and topology edit view and remembers the choice.
 * Main functions/types:
 *   - TopologyTab: main view-switch component (ToggleGroup + sub-panels).
 *   - storedView / View: read/write of the locally stored view preference.
 */
"use client";

import * as React from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

import { CoverageGraphTab } from "./coverage-graph-tab";
import { TopologyEditor } from "./topology/topology-editor";

const VIEW_KEY = "artex-topology-view";

type View = "topology" | "coverage";

function storedView(): View {
  // The entry point is the "Asset coverage graph" tab, defaulting to the coverage view; topology is a switchable mode within the tab.
  return getLocalStorageValue(VIEW_KEY) === "topology" ? "topology" : "coverage";
}

/**
 * Contents of the "Asset coverage graph" tab: top toggle between "Asset coverage" (read-only force graph) and "Internal topology" (writable editor).
 * Both views share the asset raw-data section in the node drawer (useIPAssetRefs / useAssetRefs).
 */
export function TopologyTab({ taskId, coverageEnabled = true }: { taskId: string; coverageEnabled?: boolean }) {
  const [view, setView] = React.useState<View>(storedView);

  function changeView(next: string) {
    if (next !== "topology" && next !== "coverage") return;
    setView(next);
    setLocalStorageValue(VIEW_KEY, next);
  }

  return (
    <div className="flex flex-col gap-3">
      <ToggleGroup type="single" value={view} onValueChange={changeView} variant="outline" size="sm" spacing={0}>
        <ToggleGroupItem value="coverage">Asset coverage</ToggleGroupItem>
        <ToggleGroupItem value="topology">Internal topology</ToggleGroupItem>
      </ToggleGroup>
      {view === "topology" ? (
        <div className="flex h-[calc(100vh-310px)] min-h-[560px] flex-col">
          <TopologyEditor taskId={taskId} />
        </div>
      ) : (
        <CoverageGraphTab taskId={taskId} coverageEnabled={coverageEnabled} />
      )}
    </div>
  );
}
