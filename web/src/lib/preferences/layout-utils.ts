/**
 * layout-utils.ts: applies layout preference values to the DOM (root-element data-* attributes).
 * Main functions/types:
 *   - applyContentLayout / applyNavbarStyle: content width and top-bar style
 *   - applySidebarVariant / applySidebarCollapsible: sidebar variant and collapse mode
 *   - applyFont: switches font variables
 */
export function applyContentLayout(value: "centered" | "full-width") {
  const root = document.documentElement;
  root.setAttribute("data-content-layout", value);
}

export function applyNavbarStyle(value: "sticky" | "scroll") {
  const root = document.documentElement;
  root.setAttribute("data-navbar-style", value);
}

export function applySidebarVariant(value: string) {
  const root = document.documentElement;
  root.setAttribute("data-sidebar-variant", value);
}

export function applySidebarCollapsible(value: string) {
  const root = document.documentElement;
  root.setAttribute("data-sidebar-collapsible", value);
}

export function applyFont(value: string) {
  const root = document.documentElement;
  root.setAttribute("data-font", value);
}
