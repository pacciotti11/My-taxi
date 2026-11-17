import * as SecureStore from "expo-secure-store";
import { getApiUrl, TUNNEL_HEADERS } from "./server";

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

/** NestJS errors carry `message` as a string or as `{ message, errors }`. */
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("message" in body)) return undefined;
  const m = (body as { message: unknown }).message;
  if (typeof m === "string") return m;
  if (m && typeof m === "object" && "message" in m) {
    return String((m as { message: unknown }).message);
  }
  return m == null ? undefined : JSON.stringify(m);
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${await getApiUrl()}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", ...TUNNEL_HEADERS },
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
  const baseUrl = await getApiUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...TUNNEL_HEADERS,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, `Няма връзка със сървъра (${baseUrl})`);
  }
  if (res.status === 401 && !retried && (await refreshTokens())) {
    return api<T>(path, options, true);
  }
  let body: unknown = null;
  if (res.status !== 204) {
    const raw = await res.text();
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // A tunnel that is down answers with an HTML page, not JSON.
      throw new ApiError(
        res.status,
        `Сървърът върна неочакван отговор (${res.status}). Работи ли API-то и тунелът?`,
      );
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(body) ?? res.statusText);
  }
  return body as T;
}
