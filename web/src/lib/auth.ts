/**
 * auth.ts: frontend token storage and current-user resolution.
 * Main functions/types:
 *   - CurrentUser: shape of the current user for display
 *   - auth: namespace object with getToken/setToken/clearToken/getCurrentUser
 */
const TOKEN_KEY = "artex_token";
// Mirrors the backend access-token TTL (1 hour). The (main) layout refreshes the
// token well before expiry and rewrites this cookie; a 7-day cookie would keep
// the Next route guard passing long after the bearer token itself went stale.
const COOKIE_MAX_AGE = 60 * 60; // 1 hour (seconds)

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
}

export const auth = {
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    // Mock demo: no real login; returns a fake token so route guards allow entry straight into the main UI.
    return localStorage.getItem(TOKEN_KEY) ?? (process.env.NEXT_PUBLIC_MOCK === "1" ? "mock-demo" : null);
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    // Also write the cookie for Next.js middleware to read server-side
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
  },

  // Resolve the current user from the JWT payload sub field; display only, no signature verification.
  getCurrentUser(): CurrentUser | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      // base64url → base64
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      const username: string = payload.sub ?? "ARTEX";
      return { id: "1", name: "artex", username, email: "", avatar: "", role: "operator" };
    } catch {
      return null;
    }
  },
};
