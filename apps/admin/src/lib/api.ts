"use client";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem("pr_admin_token");
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem("pr_admin_token", token);
    else localStorage.removeItem("pr_admin_token");
  } catch {
    /* storage unavailable */
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    setToken(null);
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const message =
      (body && (body.message?.message ?? body.message)) ?? res.statusText;
    throw new ApiError(res.status, String(message));
  }
  return body as T;
}

export function formatMoney(minor: number | null | undefined, currency = "BGN"): string {
  if (minor == null) return "—";
  return `${(minor / 100).toFixed(2)} ${currency}`;
}
