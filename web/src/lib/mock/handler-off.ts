// Empty implementation replacing lib/mock/handler in production builds: next.config.mjs uses
// turbopack resolveAlias in non-MOCK builds to point "@/lib/mock/handler" at this module; together with lib/api/http.ts's
// dynamic import, this keeps the 6800-line demo data entirely out of the production bundle (Turbopack does not dead-code-fold
// on unset NEXT_PUBLIC_* variables, so an if branch alone cannot eliminate the import() dependency).
// Never reached at runtime: it only loads when MOCK is true, and that build does not apply this alias.
/**
 * Main functions/types:
 *   - mockHandle: empty implementation that never returns (throws as a placeholder)
 */
export async function mockHandle(): Promise<never> {
  throw new Error("mock handler is only available in NEXT_PUBLIC_MOCK=1 builds");
}
