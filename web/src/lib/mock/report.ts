// mockReport returns a canned Markdown report for the demo.
// Extracted from lib/api/llm-agents.ts: report() dynamically imports this module; non-MOCK builds
// replace it with the report-off stub via next.config.mjs resolveAlias, keeping the demo report out of the production bundle.
/**
 * Main functions/types:
 *   - mockReport: returns the preset Markdown penetration-test report text
 */
export function mockReport(_task?: string): string {
  return `# artex Penetration Test Report — Acme Corp

## Overview
- Scope: acme.com (including www / admin / api / shop / vpn subdomains)
- Confirmed findings: 6 (high 3 · medium 3 · low 2)
- Engine mode: exploring

## Key findings
1. **[High] Default admin credentials** admin.acme.com admin/admin123 → full admin-panel takeover.
2. **[High] SQL injection** www.acme.com/search?q= → can read the acme_prod database.
3. **[High] IDOR** api.acme.com/v1/orders?id= → can read other users' orders (including phone numbers/addresses).
4. **[Medium] Reflected XSS**, **exposed .git source**, **no login rate limit**.

## Recommendations
- Force an admin password change + enable MFA; block default credentials.
- Parameterized queries and output encoding for the search endpoint.
- Add object-level authorization checks (IDOR) to the API; rotate to a strong JWT key.

> (demo) This report is generated from mock data for UI demonstration only.`;
}
