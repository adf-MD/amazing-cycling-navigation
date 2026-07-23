import { useSyncExternalStore } from "react";
import { systemClock, type Clock } from "./clock.ts";

export interface LoggedError {
  context: string;
  message: string;
  timestampMs: number;
}

const MAX_ENTRIES = 20;

// Redacts values that look like coordinates or long API-key-shaped tokens
// from error messages before they're kept for the diagnostics screen.
const COORDINATE_PATTERN = /-?\d{1,3}\.\d{3,}/g;
const LONG_TOKEN_PATTERN = /\b[\w-]{20,}\b/g;

function redact(message: string): string {
  return message
    .replace(COORDINATE_PATTERN, "[coordinate]")
    .replace(LONG_TOKEN_PATTERN, "[token]");
}

let entries: LoggedError[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function logError(
  context: string,
  error: unknown,
  clock: Clock = systemClock,
): void {
  const rawMessage = error instanceof Error ? error.message : String(error);
  entries = [
    { context, message: redact(rawMessage), timestampMs: clock.now() },
    ...entries,
  ].slice(0, MAX_ENTRIES);
  notify();
}

export function getRecentErrors(): readonly LoggedError[] {
  return entries;
}

export function subscribeErrorLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearErrorLog(): void {
  entries = [];
  notify();
}

export function useRecentErrors(): readonly LoggedError[] {
  return useSyncExternalStore(subscribeErrorLog, getRecentErrors);
}
