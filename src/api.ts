import type { AllRecords, RecordKind } from "../shared/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录");
  }
}

export const api = {
  login: (password: string) =>
    request<{ ok: true }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),

  logout: () => request<{ ok: true }>("/api/logout", { method: "POST" }),

  me: () => request<{ ok: true }>("/api/me"),

  fetchRecords: () => request<AllRecords>("/api/records"),

  create: <T>(kind: RecordKind, payload: Record<string, unknown>) =>
    request<T>(`/api/${kind}`, { method: "POST", body: JSON.stringify(payload) }),

  update: <T>(kind: RecordKind, id: number, payload: Record<string, unknown>) =>
    request<T>(`/api/${kind}/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  remove: (kind: RecordKind, id: number) =>
    request<{ ok: true }>(`/api/${kind}/${id}`, { method: "DELETE" }),
};
