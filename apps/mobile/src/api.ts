import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:3000";

const ACCESS_KEY = "pr_access";
const REFRESH_KEY = "pr_refresh";

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    await clearTokens();
    return false;
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  await saveTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retried = false,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried && (await refreshTokens())) {
    return api<T>(path, options, true);
  }
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const message =
      (body && ((body as { message?: { message?: string } | string }).message as
        | { message?: string }
        | string
        | undefined)) ?? res.statusText;
    const text =
      typeof message === "object" && message
        ? (message.message ?? JSON.stringify(message))
        : String(message);
    throw new ApiError(res.status, text);
  }
  return body as T;
}
