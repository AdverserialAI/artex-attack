/**
 * layout.tsx: (auth) route-group layout; currently a pass-through shell that
 * only wraps the login/setup pages.
 * Main functions/types:
 *   - AuthLayout: renders children directly
 */
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
