export function backendBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_AOS_BACKEND_URL ?? "http://localhost:8080";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, { ...init, method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, {
    ...init,
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${backendBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
  }

  return (await response.json()) as T;
}

