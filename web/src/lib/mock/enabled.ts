// Mock switch. Build-time injected public variable (only NEXT_PUBLIC_ prefixed vars are browser-readable).
// Setting NEXT_PUBLIC_MOCK=1 on Vercel puts the whole site in mock mode with no backend.
/**
 * Main functions/types:
 *   - MOCK: build-time boolean switch for mock demo mode
 */
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";
