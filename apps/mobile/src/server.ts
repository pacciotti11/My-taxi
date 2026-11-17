import * as SecureStore from "expo-secure-store";

const SERVER_KEY = "pr_server_url";

/** Build-time default, e.g. EXPO_PUBLIC_API_URL=https://abc.ngrok-free.app */
export const DEFAULT_API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * Test builds may let the tester point the app at another server (a free
 * ngrok URL changes on every restart). Store builds must leave this off:
 * a user-editable server address in production is a phishing vector.
 */
export const SERVER_OVERRIDE_ALLOWED =
  process.env.EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE === "1";

let cached: string | null = null;

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    throw new Error("Адресът трябва да започва с http:// или https://");
  }
  return trimmed;
}

export async function getApiUrl(): Promise<string> {
  if (cached) return cached;
  if (SERVER_OVERRIDE_ALLOWED) {
    const stored = await SecureStore.getItemAsync(SERVER_KEY);
    if (stored) {
      cached = stored;
      return stored;
    }
  }
  cached = DEFAULT_API_URL;
  return cached;
}

export async function setApiUrl(url: string | null): Promise<void> {
  if (!SERVER_OVERRIDE_ALLOWED) return;
  if (url) {
    const normalized = normalizeServerUrl(url);
    await SecureStore.setItemAsync(SERVER_KEY, normalized);
    cached = normalized;
  } else {
    await SecureStore.deleteItemAsync(SERVER_KEY);
    cached = DEFAULT_API_URL;
  }
}

/** Free ngrok tunnels serve an HTML warning page unless this header is set. */
export const TUNNEL_HEADERS = { "ngrok-skip-browser-warning": "1" } as const;
