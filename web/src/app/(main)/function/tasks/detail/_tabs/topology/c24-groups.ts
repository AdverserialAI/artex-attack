/**
 * c24-groups.ts: automatically group internal-topology nodes by /24 subnet.
 * Main functions:
 *   - c24Name: IPv4 → "a.b.c.0/24"; returns null for non-IPv4
 *   - planC24Groups: clusters ungrouped nodes by /24; returns subnets with ≥2 members sorted by name
 *   - isC24Grouped / markC24Grouped: safely read/write the one-time grouping marker
 *   - applyC24Grouping: creates/reuses same-named groups and moves members in; returns the latest full graph from the backend
 * Group creation geometry reuses nextGroupPlacement (placement to the right) + default frame size; member coordinates are then
 * written by autoLayout; grouping is done entirely on the frontend and does not touch backend fact edge-building logic.
 */
import { api } from "@/lib/api";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";
import type { TopologyGraph } from "@/lib/types";

import { GROUP_DEFAULT_H, GROUP_DEFAULT_W, nextGroupPlacement } from "./graph-model";

function c24GroupedKey(taskId: string): string {
  return `topology-c24-grouped-${taskId}`;
}

export function isC24Grouped(taskId: string): boolean {
  return getLocalStorageValue(c24GroupedKey(taskId)) === "1";
}

export function markC24Grouped(taskId: string): void {
  setLocalStorageValue(c24GroupedKey(taskId), "1");
}

export function c24Name(ip: string): string | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function planC24Groups(graph: TopologyGraph): Array<{ name: string; members: string[] }> {
  const bySubnet = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.group_id != null) continue;
    const name = c24Name(node.ip);
    if (!name) continue;
    const list = bySubnet.get(name) ?? [];
    list.push(node.ip);
    bySubnet.set(name, list);
  }
  return [...bySubnet.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([name, members]) => ({ name, members: members.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function applyC24Grouping(taskId: string, graph: TopologyGraph): Promise<TopologyGraph> {
  let current = graph;
  for (const { name, members } of planC24Groups(graph)) {
    let group = current.groups.find((g) => g.name === name);
    if (!group) {
      current = await api.addTopologyGroup(taskId, {
        name,
        ...nextGroupPlacement(current),
        width: GROUP_DEFAULT_W,
        height: GROUP_DEFAULT_H,
      });
      group = current.groups.find((g) => g.name === name);
    }
    if (!group) continue;
    for (const ip of members) {
      current = await api.patchTopologyNode(taskId, ip, { group_id: group.id, x: 0, y: 0 });
    }
  }
  return current;
}
