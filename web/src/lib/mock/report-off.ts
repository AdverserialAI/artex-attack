// Empty stub replacing lib/mock/report in production builds: next.config.mjs uses resolveAlias in non-MOCK builds
// to point "@/lib/mock/report" at this module. Never reached at runtime (it only loads when MOCK is true,
// and that build does not apply this alias).
/**
 * Main functions/types:
 *   - mockReport: empty stub for non-MOCK builds (throws when called)
 */
export function mockReport(): string {
  throw new Error("mock report is only available in NEXT_PUBLIC_MOCK=1 builds");
}
