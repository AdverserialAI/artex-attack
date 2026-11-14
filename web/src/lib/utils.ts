/**
 * utils.ts: shared utility functions.
 * Main functions/types:
 *   - cn: class-name merging via clsx + tailwind-merge
 *   - radixOverlayWasOpenAtPointerDown: helper for outside-click close decisions while an overlay is open inside a drawer
 *   - copyText / getInitials / fmtBytes / fmtTokens / fmtTime: copy, name-initial, and formatting helpers
 *   - statusTone: maps HTTP status codes to Tailwind text colors
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper for onInteractOutside close decisions in drawers/dialogs (Sheet/Dialog).
//
// Background: Radix overlays inside a drawer (Select dropdowns, DropdownMenu, Popover, etc.) portal outside the drawer.
// When a popover is open and you click the overlay/outside to dismiss it, that pointerdown is processed by both Select and Sheet
// DismissableLayers; Select closes first and, being a discrete event, React flushes synchronously, so
// by the time Sheet's handler runs, the popover's data-state has already flipped to closed — checking whether an overlay is open "right now"
// is inherently unreliable (verified experimentally).
//
// The correct approach: Radix listens for pointerdown in the bubble phase; we record
// "is any overlay open right now" in the capture phase (earlier), and onInteractOutside reads that record to decide whether to allow closing.
function isRadixOverlayOpenNow(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector(
    [
      "[data-slot='select-trigger'][data-state='open']",
      "[data-slot='select-content'][data-state='open']",
      "[role='listbox'][data-state='open']",
      "[data-radix-popper-content-wrapper]",
      "[aria-expanded='true'][data-state='open']",
    ].join(","),
  );
}

let overlayOpenAtLastPointerDown = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      overlayOpenAtLastPointerDown = isRadixOverlayOpenNow();
    },
    true, // capture: record before Radix's bubble-phase pointerdown handler runs
  );
}

// radixOverlayWasOpenAtPointerDown returns whether a Radix overlay was open at the most recent pointerdown.
// Drawers/dialogs use it so that clicking the overlay with a popover open only dismisses the popover, not themselves.
export function radixOverlayWasOpenAtPointerDown(): boolean {
  return overlayOpenAtLastPointerDown;
}

// copyText writes text to the clipboard and returns whether it succeeded.
// Background: navigator.clipboard is only available in secure contexts (HTTPS / localhost); over IP + HTTP
// it is undefined, so fall back to execCommand("copy").
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // continue with the fallback
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const getInitials = (str: string): string => {
  if (typeof str !== "string" || !str.trim()) return "?";

  return (
    str
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"
  );
};

// fmtBytes renders a human file size: ≥1 MiB → "x.x MB", ≥1 KiB → "x.x KB", otherwise "N B".
// Shared by attachment chips, upload lists, etc.; variants needing GB or empty-value semantics (e.g. the traffic page) keep local implementations.
export function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}

// fmtTokens renders a compact token count (1234 → 1.2k, 2_000_000 → 2M)。
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

// fmtTime formats backend timestamps as en-US month/day hour:minute:second (shared by list and detail views).
export function fmtTime(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// statusTone returns Tailwind text-color classes by HTTP status code (shared by asset/traffic/message views).
export function statusTone(status: number) {
  if (status >= 500) return "text-red-500";
  if (status >= 400) return "text-amber-500";
  if (status >= 300) return "text-blue-500";
  if (status >= 200) return "text-emerald-500";
  return "text-muted-foreground";
}
