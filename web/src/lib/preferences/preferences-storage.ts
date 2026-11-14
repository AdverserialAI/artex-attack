/**
 * preferences-storage.ts: writes preference values to cookies or localStorage per configuration.
 * Main functions/types:
 *   - persistPreference: persists the value of a given key according to PREFERENCE_PERSISTENCE
 */
"use client";

import { setClientCookie } from "../cookie.client";
import { setLocalStorageValue } from "../local-storage.client";
import { PREFERENCE_PERSISTENCE, type PreferenceKey } from "./preferences-config";

export async function persistPreference(key: PreferenceKey, value: string) {
  const mode = PREFERENCE_PERSISTENCE[key];

  switch (mode) {
    case "none":
      return;

    // Static export has no Node server, so server-cookie degrades to a browser cookie (equivalent write semantics).
    case "server-cookie":
    case "client-cookie":
      setClientCookie(key, value);
      return;

    case "localStorage":
      setLocalStorageValue(key, value);
      return;

    default:
      return;
  }
}
