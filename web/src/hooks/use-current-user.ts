/**
 * use-current-user.ts: hook that reads the currently logged-in user (with fallback defaults).
 * Main functions/types:
 *   - useCurrentUser: resolves the current user from auth; returns a built-in fallback user when logged out
 */
"use client";

import { useEffect, useState } from "react";

import { auth, type CurrentUser } from "@/lib/auth";

const FALLBACK: CurrentUser = { id: "1", name: "artex", username: "artex", email: "", avatar: "", role: "operator" };

export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>(FALLBACK);

  useEffect(() => {
    const u = auth.getCurrentUser();
    if (u) setUser(u);
  }, []);

  return user;
}
