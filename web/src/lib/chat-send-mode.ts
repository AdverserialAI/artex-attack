/**
 * chat-send-mode.ts: Enter / Ctrl+Enter send-key preference for the chat composer (localStorage only, never persisted server-side).
 * Main functions/types:
 *   - ChatSendMode and CHAT_SEND_MODE_* constants: key-binding values, storage key, default, and options
 *   - useChatSendMode / setChatSendMode / shouldSubmitOnKey: read/write the preference and decide key submission
 */
"use client";

import * as React from "react";

import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

// Send/newline key bindings for the chat composer. Purely a frontend preference: localStorage only, not persisted or synced with the account,
// so a new browser requires reconfiguration. See issue #39 — 0.3.2 changed Ctrl+Enter-to-send to Enter-to-send,
// and this brings the old binding back as an option.
export type ChatSendMode = "enter" | "ctrl-enter";

export const CHAT_SEND_MODE_KEY = "artex_chat_send_mode";
export const DEFAULT_CHAT_SEND_MODE: ChatSendMode = "enter";

export const CHAT_SEND_MODE_OPTIONS: { value: ChatSendMode; label: string }[] = [
  { value: "enter", label: "Enter to send, Shift+Enter for newline" },
  { value: "ctrl-enter", label: "Ctrl+Enter to send, Enter for newline" },
];

function parseMode(raw: string | null): ChatSendMode {
  return raw === "ctrl-enter" || raw === "enter" ? raw : DEFAULT_CHAT_SEND_MODE;
}

// Subscribers within the same tab. The localStorage storage event only fires in *other* tabs,
// so after changing the setting in this page, emit must notify composers in the same tab, otherwise a refresh is needed.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Returns a string literal; Object.is compares by value, so useSyncExternalStore does not loop.
function getSnapshot(): ChatSendMode {
  return parseMode(getLocalStorageValue(CHAT_SEND_MODE_KEY));
}

// The server has no localStorage: render the default first, then getSnapshot corrects it after hydration.
function getServerSnapshot(): ChatSendMode {
  return DEFAULT_CHAT_SEND_MODE;
}

export function useChatSendMode(): ChatSendMode {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setChatSendMode(mode: ChatSendMode) {
  setLocalStorageValue(CHAT_SEND_MODE_KEY, mode);
  for (const listener of listeners) listener();
}

// shouldSubmitOnKey decides whether a key press should submit.
// isComposing / keyCode 229 means an IME (e.g. Chinese input) is actively composing; must be allowed through, otherwise Enter-to-select would send by accident.
// enter mode only excludes Shift, matching 0.3.2 behavior exactly — users who never change the setting feel no difference.
// ctrl-enter mode accepts both Ctrl and Cmd (macOS).
export function shouldSubmitOnKey(e: React.KeyboardEvent, mode: ChatSendMode): boolean {
  if (e.key !== "Enter") return false;
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false;
  if (mode === "ctrl-enter") return e.ctrlKey || e.metaKey;
  return !e.shiftKey;
}
